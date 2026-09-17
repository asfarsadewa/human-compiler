import { describe, expect, it } from "vitest";
import {
  DEFAULT_FLAGS,
  MAX_NOTABLE_ROWS,
  buildQuestions,
  compile,
  getMode,
  lex,
  measurementRows,
  optimize,
  severity,
  sortDiagnostics,
  type CompileInput,
  type Diagnostic,
  type ModeRequest,
} from "../src/engine";
import { CORPORATE_EMAIL, measurements } from "./fixtures";

function input(text: string, over: Parameters<typeof measurements>[0] = {}, mode: ModeRequest = "default", flags = DEFAULT_FLAGS): CompileInput {
  return {
    lexed: lex(text),
    measurements: measurements(over, mode),
    request: mode,
    flags,
    model: "jev-test",
    questionCount: 40,
    usage: { input_tokens: 500, output_tokens: 60 },
    timings: { lex_ms: 1, analyze_ms: 200 },
  };
}

describe("compile", () => {
  it("is deterministic", () => {
    const a = compile(input(CORPORATE_EMAIL, { nouls: { corporate_bullshit: 0.94, passive_aggression: 0.82 } }, "corporate"));
    const b = compile(input(CORPORATE_EMAIL, { nouls: { corporate_bullshit: 0.94, passive_aggression: 0.82 } }, "corporate"));
    expect(a).toEqual(b);
  });

  it("carries input statistics, counts and exit code", () => {
    const r = compile(input(CORPORATE_EMAIL, { nouls: { circular_reasoning: 0.9 } }, "corporate"));
    expect(r.input).toEqual({ lines: 8, paragraphs: 4, sentences: 7, words: 62, chars: CORPORATE_EMAIL.length });
    expect(r.counts.errors).toBe(1);
    expect(r.exitCode).toBe(1);
    expect(r.counts.warnings).toBeGreaterThan(5);
    expect(r.mode).toBe("corporate");
    expect(r.model).toBe("jev-test");
    expect(r.timings).toEqual({ lex_ms: 1, analyze_ms: 200, emit_ms: 0 });
  });

  it("exits 0 without errors", () => {
    const r = compile(input("A plain and specific message: the invoice is due on 3 October."));
    expect(r.exitCode).toBe(0);
    expect(r.counts.errors).toBe(0);
  });

  it("does not depend on question building", () => {
    const q = buildQuestions(lex(CORPORATE_EMAIL), "corporate");
    expect(q.count).toBeGreaterThan(30);
    const r = compile(input(CORPORATE_EMAIL, {}, "corporate"));
    expect(r.questionCount).toBe(40);
  });
});

describe("--mode auto", () => {
  const text = "This is a plain sentence about nothing in particular, written to be unremarkable and long enough to count.";

  it("picks the profile from a confident dialect and reports it", () => {
    const r = compile(input(text, { choices: { register: { choice: "linkedin", p: 0.7 } }, nouls: { linkedin_energy: 0.85 } }, "auto"));
    expect(r.mode).toBe("linkedin");
    expect(r.requested).toBe("auto");
    expect(r.resolution).toEqual({ register: "linkedin", p: 0.7, used: true });
    expect(r.diagnostics.find((d) => d.code === "HC034")).toMatchObject({
      level: "note",
      message: "--mode auto resolved to linkedin",
      notes: ["dialect.linkedin = 0.70, threshold 0.50"],
    });
    expect(r.diagnostics.find((d) => d.code === "HC032")).toBeUndefined();
    // The linkedin profile only reports linkedin energy from 0.9, so the default profile did not run.
    expect(r.diagnostics.find((d) => d.code === "HC006")).toBeUndefined();
  });

  it("falls back to default without a dominant dialect", () => {
    const r = compile(input(text, { choices: { register: { choice: "forum", p: 0.4 } } }, "auto"));
    expect(r.mode).toBe("default");
    expect(r.resolution).toEqual({ register: "forum", p: 0.4, used: false });
    expect(r.diagnostics.find((d) => d.code === "HC034")?.message).toBe(
      "--mode auto found no dominant dialect; compiled with --mode default",
    );
    const personal = compile(input(text, { choices: { register: { choice: "personal", p: 0.9 } } }, "auto"));
    expect(personal.mode).toBe("default");
    expect(personal.resolution?.used).toBe(false);
  });

  it("consumes only the winning profile's questions", () => {
    const r = compile(input(text, { choices: { register: { choice: "political", p: 0.8 } }, nouls: { pivot: 0.9, meta_meeting: 0.9 } }, "auto"));
    expect(r.mode).toBe("politician");
    const codes = r.diagnostics.map((d) => d.code);
    expect(codes).toContain("HC351");
    expect(codes).not.toContain("HC313");
  });

  it("leaves literal requests alone", () => {
    const r = compile(input(text, { choices: { register: { choice: "linkedin", p: 0.9 } } }, "corporate"));
    expect(r.mode).toBe("corporate");
    expect(r.requested).toBe("corporate");
    expect(r.resolution).toBeNull();
    expect(r.diagnostics.find((d) => d.code === "HC034")).toBeUndefined();
    expect(r.diagnostics.find((d) => d.code === "HC032")).toBeDefined();
  });
});

describe("sortDiagnostics", () => {
  it("puts document-level diagnostics first by level, then spans in source order", () => {
    const d = (code: string, level: Diagnostic["level"], span?: Diagnostic["span"]): Diagnostic => ({ code, level, message: "", notes: [], help: [], span });
    const sorted = sortDiagnostics([
      d("HC201", "warning", { line: 3, col: 5, length: 1 }),
      d("HC020", "note"),
      d("HC201", "warning", { line: 1, col: 9, length: 1 }),
      d("HC003", "error"),
      d("HC001", "warning"),
      d("HC202", "warning", { line: 1, col: 2, length: 1 }),
    ]);
    expect(sorted.map((x) => `${x.code}@${x.span ? `${x.span.line}:${x.span.col}` : "-"}`)).toEqual([
      "HC003@-",
      "HC001@-",
      "HC020@-",
      "HC202@1:2",
      "HC201@1:9",
      "HC201@3:5",
    ]);
  });
});

describe("severity", () => {
  it("weights the worst three measurements, information, and diagnostic load", () => {
    const m = measurements({ nouls: { passive_aggression: 0.8, corporate_bullshit: 0.9, hedging: 0.7, actual_information: 0.2 } });
    // worst three = (0.9 + 0.8 + 0.7) / 3 = 0.8; info = 0.2; load = (2*1 + 4) / 8 = 0.75
    // 10 * (0.45*0.8 + 0.25*0.8 + 0.3*0.75) = 10 * (0.36 + 0.2 + 0.225) = 7.85 -> 7.9
    expect(severity(m, getMode("default"), { errors: 1, warnings: 4 })).toBe(7.9);
  });

  it("ignores presence measurements and caps load", () => {
    const m = measurements({ nouls: { contains_request: 1, actual_information: 1 } });
    // worst three among defects = 0.1; info = 1; load = min(1, 40/8) = 1
    // 10 * (0.045 + 0 + 0.3) = 3.45 -> 3.5 (rounded half up at one decimal)
    expect(severity(m, getMode("default"), { errors: 20, warnings: 0 })).toBe(3.5);
    // worst three = 0.1; info = 0.9 (fixture default); load = 0 -> 10 * (0.045 + 0.025) = 0.7
    expect(severity(measurements(), getMode("default"), { errors: 0, warnings: 0 })).toBe(0.7);
  });
});

describe("measurementRows", () => {
  it("shows headline rows always and others only at 0.5 or above, sorted", () => {
    const m = measurements({ nouls: { hedging: 0.55, sarcasm: 0.75, name_dropping: 0.49 } });
    const rows = measurementRows(m, getMode("default"));
    const ids = rows.map((r) => r.id);
    expect(ids.slice(0, 7)).toEqual([
      "passive_aggression",
      "corporate_bullshit",
      "actual_information",
      "unnecessary_urgency",
      "meeting_could_be_email",
      "linkedin_energy",
      "sounds_ai_generated",
    ]);
    expect(ids.slice(7)).toEqual(["sarcasm", "hedging"]);
    expect(rows.find((r) => r.id === "sarcasm")?.label).toBe("SARCASM");
  });

  it("caps the notable rows", () => {
    const m = measurements({
      nouls: { hedging: 0.9, sarcasm: 0.9, name_dropping: 0.9, fomo: 0.9, clickbait: 0.9, guilt_trip: 0.9, humble_brag: 0.9, condescension: 0.9 },
    });
    expect(measurementRows(m, getMode("default"))).toHaveLength(7 + MAX_NOTABLE_ROWS);
  });
});

describe("optimize (-O2)", () => {
  const text = "The meeting is at 10:00 on Tuesday.\n\nThanks so much.\n\nIn conclusion, come.\n\nP.S. really appreciate it.";

  it("removes dead and unreachable paragraphs and reports the saving", () => {
    const o = optimize(lex(text), measurements({ units: [0.9, 0.1, 0.8, 0.9] }), DEFAULT_FLAGS);
    expect(o.removedUnits).toEqual([1, 3]);
    expect(o.text).toBe("The meeting is at 10:00 on Tuesday.\n\nIn conclusion, come.");
    expect(o.before).toBe(text.length);
    expect(o.after).toBe(o.text.length);
    expect(o.percent).toBe(Math.round((1 - o.after / o.before) * 100));
    expect(o.unitKind).toBe("paragraph");
  });

  it("joins surviving sentences with spaces", () => {
    const o = optimize(lex("Fact one. Filler. Fact two."), measurements({ units: [0.9, 0.1, 0.9] }), DEFAULT_FLAGS);
    expect(o.text).toBe("Fact one. Fact two.");
    expect(o.unitKind).toBe("sentence");
  });

  it("is attached to the report only with -O2", () => {
    const withFlag = compile(input(text, { units: [0.9, 0.1, 0.8, 0.9] }, "default", { ...DEFAULT_FLAGS, o2: true }));
    expect(withFlag.optimized?.removedUnits).toEqual([1, 3]);
    expect(compile(input(text, { units: [0.9, 0.1, 0.8, 0.9] })).optimized).toBeNull();
  });
});
