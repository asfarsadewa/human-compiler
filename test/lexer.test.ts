import { describe, expect, it } from "vitest";
import { LineIndex, MAX_UNITS, countWords, lex, normalize, phraseCounts } from "../src/engine";
import { CORPORATE_EMAIL } from "./fixtures";

describe("normalize", () => {
  it("converts CRLF and strips trailing whitespace", () => {
    expect(normalize("a\r\nb\r\n\r\n")).toBe("a\nb");
    expect(normalize("x y  \n")).toBe("x y");
  });
});

describe("LineIndex", () => {
  it("maps offsets to 1-based line and column and back", () => {
    const idx = new LineIndex("ab\ncd\n\nefg");
    expect(idx.pos(0)).toEqual({ line: 1, col: 1 });
    expect(idx.pos(3)).toEqual({ line: 2, col: 1 });
    expect(idx.pos(4)).toEqual({ line: 2, col: 2 });
    expect(idx.pos(7)).toEqual({ line: 4, col: 1 });
    expect(idx.pos(9)).toEqual({ line: 4, col: 3 });
    expect(idx.offset(4, 3)).toBe(9);
    expect(idx.lineCount).toBe(4);
  });
});

describe("lex: phrases", () => {
  it("locates a phrase by line and column", () => {
    const l = lex("Hello.\nLet's circle back on this.");
    const hit = l.hits.find((h) => h.phrase === "circle back");
    expect(hit).toMatchObject({ line: 2, col: 7, length: 11, category: "corporate", suggestion: "follow up" });
  });

  it("is case-insensitive and respects word boundaries", () => {
    expect(lex("CIRCLE BACK now").hits.map((h) => h.phrase)).toEqual(["circle back"]);
    expect(lex("leverages").hits.filter((h) => h.phrase === "leverage")).toHaveLength(0);
    expect(lex("the leverage.").hits.filter((h) => h.phrase === "leverage")).toHaveLength(1);
  });

  it("keeps the longest of overlapping matches", () => {
    const l = lex("Well, actually that is wrong.");
    expect(l.hits.map((h) => h.phrase)).toEqual(["well, actually"]);
  });

  it("matches curly apostrophes", () => {
    expect(lex("I’m not sure but it works").hits.map((h) => h.phrase)).toContain("I'm not sure but");
  });

  it("uses custom patterns for punctuation-aware phrases", () => {
    expect(lex("this.").hits.map((h) => h.phrase)).toEqual(["this."]);
    expect(lex("I like this. It is fine.").hits.map((h) => h.phrase)).not.toContain("this.");
    expect(lex("EDIT: thanks").hits.map((h) => h.phrase)).toContain("EDIT:");
    expect(lex("As a developer, I disagree.").hits.map((h) => h.phrase)).toContain("as a ...,");
    expect(lex("As a result, it failed.").hits.map((h) => h.phrase)).not.toContain("as a ...,");
  });

  it("records deprecation years", () => {
    const hit = lex("welcome to the new normal").hits[0];
    expect(hit).toMatchObject({ category: "deprecated", since: 2021 });
  });

  it("returns hits sorted by position", () => {
    const offsets = lex(CORPORATE_EMAIL).hits.map((h) => h.offset);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
  });
});

describe("lex: structure", () => {
  it("splits paragraphs on blank lines with correct positions", () => {
    const l = lex("First para.\n\n\nSecond para\nstill second.\n\nThird.");
    expect(l.paragraphs.map((p) => p.line)).toEqual([1, 4, 7]);
    expect(l.paragraphs[1].endLine).toBe(5);
    expect(l.paragraphs[1].text).toBe("Second para\nstill second.");
    expect(l.unitKind).toBe("paragraph");
    expect(l.units).toHaveLength(3);
  });

  it("splits sentences and reports their words", () => {
    const l = lex("One two three. Four five! Six?");
    expect(l.sentences.map((s) => s.text)).toEqual(["One two three.", "Four five!", "Six?"]);
    expect(l.sentences.map((s) => s.col)).toEqual([1, 16, 27]);
    expect(l.sentences.map((s) => s.words)).toEqual([3, 2, 1]);
  });

  it("uses sentences as units when there is one paragraph", () => {
    const l = lex("Alpha beta. Gamma delta. Epsilon.");
    expect(l.unitKind).toBe("sentence");
    expect(l.units.map((u) => u.text)).toEqual(["Alpha beta.", "Gamma delta.", "Epsilon."]);
  });

  it("caps units", () => {
    const text = Array.from({ length: 40 }, (_, i) => `Paragraph ${i}.`).join("\n\n");
    const l = lex(text);
    expect(l.paragraphs).toHaveLength(40);
    expect(l.units).toHaveLength(MAX_UNITS);
    expect(l.units[MAX_UNITS - 1].index).toBe(MAX_UNITS - 1);
  });

  it("finds the conclusion marker", () => {
    const l = lex("Intro.\n\nTL;DR: buy it.\n\nMore words after.");
    expect(l.terminatorUnit).toBe(1);
    expect(l.terminatorPhrase).toBe("TL;DR");
    expect(lex("No conclusion here.\n\nStill none.").terminatorUnit).toBeNull();
  });

  it("counts words and chars", () => {
    expect(countWords("  a  b\nc ")).toBe(3);
    const l = lex(CORPORATE_EMAIL);
    expect(l.words).toBe(countWords(CORPORATE_EMAIL));
    expect(l.chars).toBe(CORPORATE_EMAIL.length);
    expect(l.lines).toHaveLength(8);
  });
});

describe("lex: counts", () => {
  it("detects undeclared and declared acronyms", () => {
    const l = lex("Our KPI is up and the KPI is green. Total Cost of Ownership (TCO) fell. TCO matters.");
    const kpi = l.acronyms.find((a) => a.token === "KPI");
    const tco = l.acronyms.find((a) => a.token === "TCO");
    expect(kpi).toMatchObject({ declared: false, count: 2, line: 1, col: 5 });
    expect(tco).toMatchObject({ declared: true, count: 2 });
    expect(l.acronyms.map((a) => a.token)).not.toContain("OK");
  });

  it("separates shouting from acronyms", () => {
    const l = lex("PLEASE READ THIS NOW. The API is DEPRECATED.");
    expect(l.capsWords).toEqual(["PLEASE", "READ", "THIS", "DEPRECATED"]);
    expect(l.acronyms).toHaveLength(0);
  });

  it("counts punctuation, emoji, hashtags and em dashes", () => {
    const l = lex("Wow!!! Really? Why? How? When? 🚀🚀🎉 #blessed #hustle — yes — no — maybe");
    expect(l.exclamations).toBe(3);
    expect(l.questions).toBe(4);
    expect(l.emojis).toBe(3);
    expect(l.hashtags).toBe(2);
    expect(l.emDashes).toBe(3);
  });

  it("counts repeated phrases and tracked words", () => {
    const l = lex("Alignment here, alignment there, and alignment everywhere. Impact, impact, impact.");
    const counts = phraseCounts(l);
    expect(counts.get("alignment")).toBe(3);
    expect(counts.get("impact")).toBe(3);
  });
});
