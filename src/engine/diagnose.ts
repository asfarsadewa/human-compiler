// Turns measurements plus lexical facts into a report. Deterministic: the same
// inputs always produce the same report.

import type { Mode } from "./modes";
import { CHOICES, NOULS, SCORES, noulSpecsFor } from "./questions";
import { DEAD_UNIT_THRESHOLD, deadUnits, makeContext, resolveLevel, rulesFor, unreachableParagraphs } from "./rules";
import { LEVEL_ORDER, type Diagnostic, type DistributionRow, type Flags, type Lexed, type MeasurementRow, type Measurements, type Optimized, type Report, type ScoreRow } from "./types";
import { VERSION } from "./version";

export interface CompileInput {
  lexed: Lexed;
  measurements: Measurements;
  mode: Mode;
  flags: Flags;
  model: string;
  questionCount: number;
  usage: { input_tokens: number; output_tokens: number };
  timings: { lex_ms: number; analyze_ms: number; emit_ms?: number };
}

const r2 = (n: number): number => Math.round(n * 100) / 100;

/** Non-headline measurements shown in the table, at most. */
export const MAX_NOTABLE_ROWS = 6;
const r1 = (n: number): number => Math.round(n * 10) / 10;

export function sortDiagnostics(list: Diagnostic[]): Diagnostic[] {
  const rank = (d: Diagnostic): number => LEVEL_ORDER.indexOf(d.level);
  const global = list.filter((d) => !d.span).sort((a, b) => rank(a) - rank(b) || a.code.localeCompare(b.code));
  const local = list
    .filter((d) => d.span)
    .sort((a, b) => {
      const sa = a.span as NonNullable<Diagnostic["span"]>;
      const sb = b.span as NonNullable<Diagnostic["span"]>;
      return sa.line - sb.line || sa.col - sb.col || a.code.localeCompare(b.code);
    });
  return [...global, ...local];
}

export function runRules(lexed: Lexed, measurements: Measurements, mode: Mode, flags: Flags): Diagnostic[] {
  const ctx = makeContext(lexed, measurements, mode, flags);
  const out: Diagnostic[] = [];
  for (const rule of rulesFor(mode)) {
    for (const fired of rule.run(ctx)) {
      const level = resolveLevel(rule, fired, mode, flags);
      if (level === null) continue;
      out.push({
        code: rule.code,
        level,
        message: fired.message,
        span: fired.span,
        label: fired.label,
        notes: fired.notes ?? [],
        help: fired.help ?? [],
      });
    }
  }
  return sortDiagnostics(out);
}

/** 0 to 10. Weighted from the worst measurements, information content, and diagnostic load. */
export function severity(measurements: Measurements, mode: Mode, counts: { errors: number; warnings: number }): number {
  const presence = new Set(NOULS.filter((n) => n.presence).map((n) => n.id));
  const negatives = noulSpecsFor(mode)
    .filter((n) => !presence.has(n.id))
    .map((n) => measurements.nouls[n.id])
    .filter((v): v is number => typeof v === "number")
    .sort((a, b) => b - a);
  const top = negatives.slice(0, 3);
  const worst = top.length ? top.reduce((a, b) => a + b, 0) / top.length : 0;
  const info = measurements.nouls.actual_information ?? 0.5;
  const load = Math.min(1, (counts.errors * 2 + counts.warnings) / 8);
  return r1(10 * (0.45 * worst + 0.25 * (1 - info) + 0.3 * load));
}

export function measurementRows(measurements: Measurements, mode: Mode): MeasurementRow[] {
  const specs = noulSpecsFor(mode);
  const headline = specs.filter((s) => s.headline);
  const rest = specs
    .filter((s) => !s.headline)
    .map((s) => ({ spec: s, value: measurements.nouls[s.id] }))
    .filter((x): x is { spec: (typeof specs)[number]; value: number } => typeof x.value === "number" && x.value >= 0.5)
    .sort((a, b) => b.value - a.value || a.spec.id.localeCompare(b.spec.id))
    .slice(0, MAX_NOTABLE_ROWS);
  const rows: MeasurementRow[] = [];
  for (const s of headline) {
    const v = measurements.nouls[s.id];
    if (typeof v === "number") rows.push({ id: s.id, label: s.label, value: r2(v) });
  }
  for (const { spec, value } of rest) rows.push({ id: spec.id, label: spec.label, value: r2(value) });
  return rows;
}

export function scoreRows(measurements: Measurements): ScoreRow[] {
  const rows: ScoreRow[] = [];
  for (const [id, spec] of Object.entries(SCORES)) {
    const s = measurements.scores[id];
    if (!s) continue;
    const max = spec.criteria.length - 1;
    const level = Math.min(max, Math.max(0, Math.round(s.score)));
    rows.push({ id, label: spec.label, score: r1(s.score), max, legend: spec.criteria[level] });
  }
  return rows;
}

export function distributionRows(measurements: Measurements): DistributionRow[] {
  const rows: DistributionRow[] = [];
  for (const [id, spec] of Object.entries(CHOICES)) {
    const c = measurements.choices[id];
    if (!c) continue;
    const probabilities = Object.entries(c.probabilities)
      .map(([option, p]) => ({ option, p: r2(p) }))
      .sort((a, b) => b.p - a.p || a.option.localeCompare(b.option));
    rows.push({ id, label: spec.label, choice: c.choice, confidence: r2(c.confidence), probabilities });
  }
  return rows;
}

export function optimize(lexed: Lexed, measurements: Measurements, flags: Flags): Optimized {
  const ctx = { lexed, m: measurements, thLow: (_id: string, def: number) => def + (flags.wall ? 0.1 : 0) };
  const dead = new Set(deadUnits(ctx));
  if (lexed.unitKind === "paragraph") {
    for (const i of unreachableParagraphs(lexed)) if (i < lexed.units.length) dead.add(i);
  }
  const kept = lexed.units.filter((u) => !dead.has(u.index)).map((u) => u.text);
  const text = kept.join(lexed.unitKind === "paragraph" ? "\n\n" : " ");
  const before = lexed.chars;
  const after = text.length;
  return {
    text,
    removedUnits: [...dead].sort((a, b) => a - b),
    unitKind: lexed.unitKind,
    before,
    after,
    percent: before > 0 ? Math.round((1 - after / before) * 100) : 0,
  };
}

export function compile(input: CompileInput): Report {
  const { lexed, measurements, mode, flags } = input;
  const diagnostics = runRules(lexed, measurements, mode, flags);
  const counts = {
    errors: diagnostics.filter((d) => d.level === "error").length,
    warnings: diagnostics.filter((d) => d.level === "warning").length,
    notes: diagnostics.filter((d) => d.level === "note").length,
    helps: diagnostics.filter((d) => d.level === "help").length,
  };
  return {
    version: VERSION,
    mode: mode.id,
    flags: { ...flags },
    input: {
      lines: lexed.lines.length,
      paragraphs: lexed.paragraphs.length,
      sentences: lexed.sentences.length,
      words: lexed.words,
      chars: lexed.chars,
    },
    model: input.model,
    questionCount: input.questionCount,
    usage: { ...input.usage },
    timings: { lex_ms: input.timings.lex_ms, analyze_ms: input.timings.analyze_ms, emit_ms: input.timings.emit_ms ?? 0 },
    measurements: measurementRows(measurements, mode),
    scores: scoreRows(measurements),
    distributions: distributionRows(measurements),
    diagnostics,
    counts,
    severity: severity(measurements, mode, counts),
    optimized: flags.o2 ? optimize(lexed, measurements, flags) : null,
    exitCode: counts.errors > 0 ? 1 : 0,
  };
}

export { DEAD_UNIT_THRESHOLD };
