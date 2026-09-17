import { describe, expect, it } from "vitest";
import { CHOICES, MAX_UNITS, NOULS, SCORES, UNIT_PREFIX, buildQuestions, extrasFor, getMode, lex, noulSpecsFor } from "../src/engine";
import { CORPORATE_EMAIL } from "./fixtures";

describe("buildQuestions", () => {
  it("asks every base question plus one per unit", () => {
    const lexed = lex(CORPORATE_EMAIL);
    const q = buildQuestions(lexed, "default");
    const expected = NOULS.length + Object.keys(CHOICES).length + Object.keys(SCORES).length + lexed.units.length;
    expect(q.count).toBe(expected);
    expect(Object.keys(q.questions).length).toBe(expected);
    expect(q.state.text).toBe(lexed.source);
    expect(q.state.units).toEqual(lexed.units.map((u) => u.text));
  });

  it("adds the mode's own questions", () => {
    const q = buildQuestions(lex(CORPORATE_EMAIL), "politician");
    expect(q.questions.pivot).toMatchObject({ type: "noul" });
    expect(q.questions.consequence_free).toBeDefined();
    expect(q.questions.meta_meeting).toBeUndefined();
    expect(noulSpecsFor(getMode("politician")).map((s) => s.id)).toContain("invokes_the_people");
  });

  it("auto asks every mode's questions, once each", () => {
    const lexed = lex(CORPORATE_EMAIL);
    const extras = extrasFor("auto");
    expect(extras).toHaveLength(21);
    expect(new Set(extras.map((x) => x.id)).size).toBe(21);
    const q = buildQuestions(lexed, "auto");
    expect(q.count).toBe(NOULS.length + 21 + Object.keys(CHOICES).length + Object.keys(SCORES).length + lexed.units.length);
    expect(q.questions.meta_meeting).toBeDefined();
    expect(q.questions.pivot).toBeDefined();
  });

  it("skips unit questions for a single unit", () => {
    const q = buildQuestions(lex("One short sentence"), "default");
    expect(Object.keys(q.questions).filter((k) => k.startsWith(UNIT_PREFIX))).toEqual([]);
    expect(q.state.units).toBeUndefined();
  });

  it("references state paths in unit instructions and caps them", () => {
    const text = Array.from({ length: 30 }, (_, i) => `Paragraph ${i} says something.`).join("\n\n");
    const q = buildQuestions(lex(text), "default");
    const unitKeys = Object.keys(q.questions).filter((k) => k.startsWith(UNIT_PREFIX));
    expect(unitKeys).toHaveLength(MAX_UNITS);
    expect(q.questions.unit_0.instructions).toContain("`units[0]`");
    expect(q.questions.unit_5.instructions).toContain("`units[0]` through `units[4]`");
  });

  it("uses the documented primitive shapes", () => {
    const q = buildQuestions(lex(CORPORATE_EMAIL), "default");
    expect(q.questions.intent).toMatchObject({ type: "choice" });
    expect(q.questions.hostility).toMatchObject({ type: "score", criteria: [...SCORES.hostility.criteria] });
    expect(q.questions.passive_aggression).toMatchObject({ type: "noul", criteria: NOULS[0].criteria });
    expect(q.questions.hedging).toMatchObject({ type: "noul", criteria: null });
  });

  it("keeps question ids unique across modes", () => {
    for (const mode of ["default", "corporate", "manager", "linkedin", "academic", "reddit", "politician", "teenager"] as const) {
      const ids = noulSpecsFor(getMode(mode)).map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.some((id) => id in CHOICES || id in SCORES)).toBe(false);
    }
  });
});
