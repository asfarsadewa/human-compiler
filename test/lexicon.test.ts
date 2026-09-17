import { describe, expect, it } from "vitest";
import { ACRONYM_ALLOWLIST, CATEGORIES, LEXICON, TERMINATORS } from "../src/engine";

describe("lexicon", () => {
  it("has unique phrases", () => {
    const seen = new Map<string, number>();
    for (const e of LEXICON) seen.set(e.phrase.toLowerCase(), (seen.get(e.phrase.toLowerCase()) ?? 0) + 1);
    const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([p]) => p);
    expect(dupes).toEqual([]);
  });

  it("uses only known categories", () => {
    for (const e of LEXICON) expect(CATEGORIES).toContain(e.category);
  });

  it("gives every deprecated phrase a year and nothing else one", () => {
    for (const e of LEXICON) {
      if (e.category === "deprecated") expect(e.since).toBeGreaterThan(2000);
      else expect(e.since).toBeUndefined();
    }
  });

  it("compiles every custom pattern", () => {
    for (const e of LEXICON) {
      if (!e.pattern) continue;
      const anchored = e.pattern.startsWith("^") || e.pattern.endsWith("$");
      expect(() => new RegExp(e.pattern as string, anchored ? "gimu" : "giu")).not.toThrow();
    }
  });

  it("gives every corporate phrase a suggestion", () => {
    for (const e of LEXICON) {
      if (e.category === "corporate") expect(typeof e.suggestion).toBe("string");
    }
  });

  it("has a non-trivial catalogue", () => {
    expect(LEXICON.length).toBeGreaterThan(300);
    expect(TERMINATORS.length).toBeGreaterThan(5);
    expect(ACRONYM_ALLOWLIST.size).toBeGreaterThan(50);
  });
});
