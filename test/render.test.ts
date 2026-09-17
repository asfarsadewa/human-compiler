import { describe, expect, it } from "vitest";
import { DEFAULT_FLAGS, bar, compile, flagString, getMode, lex, renderDiagnostic, renderText, summaryLine, windowLine } from "../src/engine";
import { CORPORATE_EMAIL, measurements } from "./fixtures";

const lexed = lex(CORPORATE_EMAIL);
const report = compile({
  lexed,
  measurements: measurements(
    {
      nouls: { passive_aggression: 0.82, corporate_bullshit: 0.94, actual_information: 0.21, unnecessary_urgency: 0.72, meeting_could_be_email: 0.89 },
      scores: { information_density: 0.6, length_excess: 2.1 },
      choices: { intent: { choice: "cover_own_ass", p: 0.52 } },
      units: [0.1, 0.8, 0.7, 0.05],
    },
    "corporate",
  ),
  mode: getMode("corporate"),
  flags: { ...DEFAULT_FLAGS, o2: true },
  model: "jev-1.13.0",
  questionCount: 45,
  usage: { input_tokens: 1103, output_tokens: 100 },
  timings: { lex_ms: 0.42, analyze_ms: 812.4 },
});

describe("bar", () => {
  it("renders ten cells", () => {
    expect(bar(0)).toBe("░░░░░░░░░░");
    expect(bar(0.82)).toBe("████████░░");
    expect(bar(1)).toBe("██████████");
  });
});

describe("renderDiagnostic", () => {
  it("draws a rustc-style span with carets and a label", () => {
    const d = report.diagnostics.find((x) => x.message === '"circle back" detected');
    expect(d).toBeDefined();
    const text = renderDiagnostic(d as NonNullable<typeof d>, lexed.lines);
    expect(text.split("\n")).toEqual([
      'warning[HC201]: "circle back" detected',
      "  --> input.txt:3:32",
      "  |",
      "3 | Per my last email, I wanted to circle back on the Q3 alignment. Going forward we need to leverage our synergies and make sure everyone has the bandwidth to move the needle.",
      '  |                                ^^^^^^^^^^^ consider: "follow up"',
      "  |",
      "  = note: category: corporate",
    ]);
  });

  it("renders document-level diagnostics without a span", () => {
    const d = report.diagnostics.find((x) => x.code === "HC003");
    expect(renderDiagnostic(d as NonNullable<typeof d>, lexed.lines)).toBe(
      "error[HC003]: NullMeaningException: no recoverable information in 62 words\n  = note: actual_information = 0.21, threshold 0.25",
    );
  });
});

describe("windowLine", () => {
  it("leaves short lines alone", () => {
    expect(windowLine("short line", 3, 2, 40)).toEqual({ text: "short line", col: 3 });
  });

  it("trims long lines around the span and keeps the column pointing at it", () => {
    const src = "x".repeat(50) + "TARGET" + "y".repeat(50);
    const w = windowLine(src, 51, 6, 30);
    expect(w.text.length).toBeLessThanOrEqual(30);
    expect(w.text.slice(w.col - 1, w.col - 1 + 6)).toBe("TARGET");
    expect(w.text.startsWith("...")).toBe(true);
    expect(w.text.endsWith("...")).toBe(true);
    const head = windowLine(src, 1, 3, 30);
    expect(head.text.startsWith("xxx")).toBe(true);
    expect(head.col).toBe(1);
  });

  it("is used by renderDiagnostic when a width is given", () => {
    const d = report.diagnostics.find((x) => x.message === '"circle back" detected');
    const text = renderDiagnostic(d as NonNullable<typeof d>, lexed.lines, "input.txt", 60);
    const src = text.split("\n")[3];
    expect(src.length).toBeLessThanOrEqual(64);
    expect(src).toContain("circle back");
  });
});

describe("summaryLine and flags", () => {
  it("summarises like a compiler", () => {
    expect(summaryLine(report)).toMatch(/^error: could not compile `input.txt` due to \d+ previous errors?; \d+ warnings emitted$/);
    expect(summaryLine({ ...report, counts: { ...report.counts, errors: 0, warnings: 2 } })).toBe("warning: `input.txt` generated 2 warnings");
    expect(summaryLine({ ...report, counts: { ...report.counts, errors: 0, warnings: 0 } })).toBe("`input.txt` compiled without diagnostics");
    expect(flagString(report)).toBe("--mode corporate -O2");
  });
});

describe("renderText", () => {
  const text = renderText(report, lexed.lines);

  it("starts with the compile header and timings", () => {
    const lines = text.split("\n");
    expect(lines[0]).toBe("   Compiling input.txt (--mode corporate -O2)");
    expect(lines[1]).toBe("      Lexing   0.4ms  4 paragraphs, 7 sentences, 62 words");
    expect(lines[2]).toBe("   Analyzing   812ms  jev-1.13.0, 45 questions, 1203 tokens");
  });

  it("prints sub-tenth timings as a floor", () => {
    const fast = renderText({ ...report, timings: { ...report.timings, lex_ms: 0 } }, lexed.lines).split("\n")[1];
    expect(fast).toBe("      Lexing  <0.1ms  4 paragraphs, 7 sentences, 62 words");
  });

  it("prints measurement bars, scores and distributions", () => {
    expect(text).toContain("CORPORATE_BULLSHIT      █████████░  0.94");
    expect(text).toContain("ACTUAL_INFORMATION      ██░░░░░░░░  0.21");
    expect(text).toContain("information_density     0.6 / 3  mostly filler with one or two concrete points");
    expect(text).toContain("intent\n  cover_own_ass           0.52");
  });

  it("prints the optimisation result, severity and exit code", () => {
    expect(text).toContain("-O2: removed 2 dead paragraphs,");
    expect(text).toMatch(/severity: \d\.\d \/ 10\nerror: could not compile `input.txt`.*\nexit code: 1$/);
  });

  it("matches the stored snapshot", () => {
    expect(text).toMatchSnapshot();
  });
});
