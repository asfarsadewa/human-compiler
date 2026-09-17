// Plain-text rendering of a report, in the style of rustc.

import type { Diagnostic, Report } from "./types";

export const FILENAME = "input.txt";

export function bar(value: number, width = 10): string {
  const filled = Math.max(0, Math.min(width, Math.round(value * width)));
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function ms(n: number): string {
  if (n < 0.05) return "<0.1ms";
  return n >= 100 ? `${Math.round(n)}ms` : `${n.toFixed(1)}ms`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function flagString(report: Report): string {
  const parts = [report.requested === "auto" ? `--mode auto=${report.mode}` : `--mode ${report.mode}`];
  if (report.flags.wall) parts.push("-Wall");
  if (report.flags.werror) parts.push("-Werror");
  if (report.flags.o2) parts.push("-O2");
  return parts.join(" ");
}

export interface Windowed {
  text: string;
  /** 1-based column of the span inside `text`. */
  col: number;
  /** How many characters of the span are visible inside the window. */
  visible: number;
}

/** Trims a long source line to a window around the span, keeping the column valid. */
export function windowLine(src: string, col: number, length: number, maxWidth: number): Windowed {
  const spanStart = Math.max(0, col - 1);
  if (maxWidth <= 0 || src.length <= maxWidth) {
    return { text: src, col, visible: Math.max(0, Math.min(length, src.length - spanStart)) };
  }
  const ell = "...";
  const inner = Math.max(8, maxWidth - 2 * ell.length);
  const wanted = Math.min(length, inner);
  let start = Math.max(0, spanStart - Math.floor((inner - wanted) / 2));
  let end = Math.min(src.length, start + inner);
  start = Math.max(0, end - inner);
  end = Math.min(src.length, start + inner);
  const prefix = start > 0 ? ell : "";
  const suffix = end < src.length ? ell : "";
  const visible = Math.max(0, Math.min(spanStart + length, end) - Math.max(spanStart, start));
  return { text: prefix + src.slice(start, end) + suffix, col: col - start + prefix.length, visible };
}

export interface SpanBlock {
  arrow: string;
  gutter: string;
  source: string;
  carets: string;
  /** The label on its own line, when it would not fit after the carets. */
  labelLine?: string;
}

/** The lines under a diagnostic header: location, gutter, source, carets, and sometimes a label line. */
export function spanBlock(d: Diagnostic, lines: readonly string[], filename = FILENAME, maxWidth = 0): SpanBlock | null {
  if (!d.span) return null;
  const width = String(d.span.line).length;
  const pad = " ".repeat(width);
  const raw = lines[d.span.line - 1] ?? "";
  const { text, col, visible } = windowLine(raw, d.span.col, d.span.length, maxWidth);
  const indent = " ".repeat(Math.max(0, col - 1));
  const run = indent + "^".repeat(Math.max(1, visible));
  const block: SpanBlock = {
    arrow: `${pad} --> ${filename}:${d.span.line}:${d.span.col}`,
    gutter: `${pad} |`,
    source: `${String(d.span.line).padStart(width)} | ${text}`,
    carets: `${pad} | ${run}${d.label ? ` ${d.label}` : ""}`,
  };
  if (d.label && maxWidth > 0 && run.length + 1 + d.label.length > maxWidth) {
    block.carets = `${pad} | ${run}`;
    const fits = indent.length + d.label.length <= maxWidth;
    block.labelLine = `${pad} | ${fits ? indent : ""}${d.label}`;
  }
  return block;
}

export function renderDiagnostic(d: Diagnostic, lines: readonly string[], filename = FILENAME, maxWidth = 0): string {
  const out: string[] = [`${d.level}[${d.code}]: ${d.message}`];
  const block = spanBlock(d, lines, filename, maxWidth);
  if (block && d.span) {
    const pad = " ".repeat(String(d.span.line).length);
    out.push(block.arrow, block.gutter, block.source, block.carets);
    if (block.labelLine) out.push(block.labelLine);
    if (d.notes.length || d.help.length) out.push(block.gutter);
    for (const n of d.notes) out.push(`${pad} = note: ${n}`);
    for (const h of d.help) out.push(`${pad} = help: ${h}`);
  } else {
    for (const n of d.notes) out.push(`  = note: ${n}`);
    for (const h of d.help) out.push(`  = help: ${h}`);
  }
  return out.join("\n");
}

export function summaryLine(report: Report, filename = FILENAME): string {
  const { errors, warnings } = report.counts;
  if (errors > 0) {
    const w = warnings > 0 ? `; ${plural(warnings, "warning")} emitted` : "";
    return `error: could not compile \`${filename}\` due to ${errors} previous error${errors === 1 ? "" : "s"}${w}`;
  }
  if (warnings > 0) return `warning: \`${filename}\` generated ${plural(warnings, "warning")}`;
  return `\`${filename}\` compiled without diagnostics`;
}

export function headerLines(report: Report, filename = FILENAME): [string, string, string] {
  const { input } = report;
  return [
    `   Compiling ${filename} (${flagString(report)})`,
    `      Lexing ${ms(report.timings.lex_ms).padStart(7)}  ${plural(input.paragraphs, "paragraph")}, ${plural(input.sentences, "sentence")}, ${plural(input.words, "word")}`,
    `   Analyzing ${ms(report.timings.analyze_ms).padStart(7)}  ${report.model}, ${plural(report.questionCount, "question")}, ${report.usage.input_tokens + report.usage.output_tokens} tokens`,
  ];
}

export function optimizedLine(report: Report): string | null {
  const o = report.optimized;
  if (!o) return null;
  return `-O2: removed ${plural(o.removedUnits.length, `dead ${o.unitKind}`)}, ${o.before} -> ${o.after} chars (-${o.percent}%)`;
}

export function renderText(report: Report, lines: readonly string[], filename = FILENAME): string {
  const out: string[] = [...headerLines(report, filename), ""];

  const labelWidth = Math.max(...report.measurements.map((m) => m.label.length), 20);
  for (const m of report.measurements) {
    out.push(`${m.label.padEnd(labelWidth)}  ${bar(m.value)}  ${m.value.toFixed(2)}`);
  }
  out.push("");

  for (const s of report.scores) {
    out.push(`${s.label.padEnd(labelWidth)}  ${s.score.toFixed(1)} / ${s.max}  ${s.legend.toLowerCase()}`);
  }
  out.push("");

  for (const d of report.distributions) {
    out.push(`${d.label}`);
    for (const p of d.probabilities) out.push(`  ${p.option.padEnd(labelWidth)}  ${p.p.toFixed(2)}`);
    out.push("");
  }

  for (const d of report.diagnostics) {
    out.push(renderDiagnostic(d, lines, filename));
    out.push("");
  }

  const opt = optimizedLine(report);
  if (opt && report.optimized) {
    out.push(opt);
    if (report.optimized.text) {
      out.push("");
      out.push(report.optimized.text);
    }
    out.push("");
  }

  out.push(`severity: ${report.severity.toFixed(1)} / 10`);
  out.push(summaryLine(report, filename));
  out.push(`exit code: ${report.exitCode}`);
  return out.join("\n");
}
