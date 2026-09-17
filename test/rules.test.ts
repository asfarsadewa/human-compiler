import { describe, expect, it } from "vitest";
import { DEFAULT_FLAGS, MODES, allRules, getMode, lex, rulesFor, runRules, type Flags, type ModeId } from "../src/engine";
import { CORPORATE_EMAIL, measurements } from "./fixtures";

const quiet = "This is a plain sentence about nothing in particular, written to be unremarkable and long enough to count.";
const flags = (over: Partial<Flags> = {}): Flags => ({ ...DEFAULT_FLAGS, ...over });

function codes(text: string, m: ReturnType<typeof measurements>, mode: ModeId = "default", f = flags()) {
  return runRules(lex(text), m, getMode(mode), f).map((d) => `${d.level}:${d.code}`);
}

describe("catalogue", () => {
  it("has unique codes and a summary for every rule", () => {
    const rules = allRules();
    const codes = rules.map((r) => r.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const r of rules) {
      expect(r.code).toMatch(/^HC\d{3}$/);
      expect(r.summary.length).toBeGreaterThan(5);
    }
  });

  it("adds a mode's own questions to its rule set", () => {
    const base = rulesFor(getMode("default")).map((r) => r.code);
    const corp = rulesFor(getMode("corporate")).map((r) => r.code);
    expect(corp).toEqual([...base, "HC301", "HC302", "HC303"]);
    for (const mode of Object.values(MODES)) {
      expect(new Set(rulesFor(mode).map((r) => r.code)).size).toBe(rulesFor(mode).length);
    }
  });
});

describe("threshold rules", () => {
  it("fires at the threshold and not below it", () => {
    expect(codes(quiet, measurements({ nouls: { passive_aggression: 0.7 } }))).toContain("warning:HC001");
    expect(codes(quiet, measurements({ nouls: { passive_aggression: 0.69 } }))).not.toContain("warning:HC001");
  });

  it("-Wall lowers thresholds by 0.1", () => {
    const m = measurements({ nouls: { passive_aggression: 0.62 } });
    expect(codes(quiet, m)).not.toContain("warning:HC001");
    expect(codes(quiet, m, "default", flags({ wall: true }))).toContain("warning:HC001");
  });

  it("-Werror promotes warnings but not notes", () => {
    const m = measurements({ nouls: { passive_aggression: 0.9, sarcasm: 0.9 } });
    const out = codes(quiet, m, "default", flags({ werror: true }));
    expect(out).toContain("error:HC001");
    expect(out).toContain("note:HC020");
  });

  it("explains itself in a note", () => {
    const d = runRules(lex(quiet), measurements({ nouls: { corporate_bullshit: 0.94 } }), getMode("default"), flags());
    const hc002 = d.find((x) => x.code === "HC002");
    expect(hc002?.notes).toEqual(["corporate_bullshit = 0.94, threshold 0.80"]);
  });

  it("HC003 needs thirty words and low information", () => {
    const long = Array.from({ length: 30 }, () => "word").join(" ");
    expect(codes(long, measurements({ nouls: { actual_information: 0.2 } }))).toContain("error:HC003");
    expect(codes("few words only", measurements({ nouls: { actual_information: 0.2 } }))).not.toContain("error:HC003");
    expect(codes(long, measurements({ nouls: { actual_information: 0.25 } }))).not.toContain("error:HC003");
    expect(codes(long, measurements({ nouls: { actual_information: 0.3 } }), "default", flags({ wall: true }))).toContain(
      "error:HC003",
    );
  });

  it("HC019 needs both a request and vagueness", () => {
    expect(codes(quiet, measurements({ nouls: { contains_request: 0.9, vague_ask: 0.9 } }))).toContain("warning:HC019");
    expect(codes(quiet, measurements({ nouls: { contains_request: 0.2, vague_ask: 0.9 } }))).not.toContain("warning:HC019");
  });

  it("score rules fire on the weighted score", () => {
    expect(codes(quiet, measurements({ scores: { hostility: 1.4 } }))).toContain("warning:HC030");
    expect(codes(quiet, measurements({ scores: { hostility: 1.3 } }))).not.toContain("warning:HC030");
    expect(codes(quiet, measurements({ scores: { hostility: 1.5 } }), "teenager")).not.toContain("warning:HC030");
    expect(codes(quiet, measurements({ scores: { hostility: 1.8 } }), "teenager")).toContain("note:HC030");
  });

  it("HC028 estimates removable text from dead units when present", () => {
    const text = "Real content: the meeting is at 10:00 on Tuesday in room 4.\n\nThanks so much everyone, really appreciate it.";
    const m = measurements({ scores: { length_excess: 2 }, units: [0.9, 0.1] });
    const d = runRules(lex(text), m, getMode("default"), flags());
    const hc028 = d.find((x) => x.code === "HC028");
    expect(hc028?.message).toBe("43% of input could be removed");
    expect(hc028?.help).toEqual(["run with -O2 to remove 1 dead paragraph"]);
  });
});

describe("choice rules", () => {
  it("HC031 reads the cover_own_ass probability", () => {
    expect(codes(quiet, measurements({ choices: { intent: { choice: "cover_own_ass", p: 0.5 } } }))).toContain("warning:HC031");
    expect(codes(quiet, measurements({ choices: { intent: { choice: "inform", p: 0.9 } } }))).not.toContain("warning:HC031");
  });

  it("HC032 suggests a mode in default mode and reports a mismatch otherwise", () => {
    const linkedin = measurements({ choices: { register: { choice: "linkedin", p: 0.7 } } });
    const d1 = runRules(lex(quiet), linkedin, getMode("default"), flags());
    expect(d1.find((x) => x.code === "HC032")).toMatchObject({ level: "help", message: "input dialect resolved to linkedin; try --mode linkedin" });
    const d2 = runRules(lex(quiet), linkedin, getMode("corporate"), flags());
    expect(d2.find((x) => x.code === "HC032")).toMatchObject({ level: "note", message: "input dialect resolved to linkedin; compiled with --mode corporate" });
    const d3 = runRules(lex(quiet), linkedin, getMode("linkedin"), flags());
    expect(d3.find((x) => x.code === "HC032")).toBeUndefined();
    const personal = measurements({ choices: { register: { choice: "personal", p: 0.9 } } });
    expect(codes(quiet, personal)).not.toContain("help:HC032");
  });

  it("HC033 reports subtext other than none", () => {
    expect(codes(quiet, measurements({ choices: { subtext: { choice: "contempt", p: 0.6 } } }))).toContain("note:HC033");
    expect(codes(quiet, measurements({ choices: { subtext: { choice: "none", p: 0.9 } } }))).not.toContain("note:HC033");
  });
});

describe("mode profiles", () => {
  it("linkedin mode relaxes linkedin energy to a note with a higher threshold", () => {
    const m = measurements({ nouls: { linkedin_energy: 0.85 } });
    expect(codes(quiet, m, "default")).toContain("warning:HC006");
    expect(codes(quiet, m, "linkedin")).not.toContain("note:HC006");
    expect(codes(quiet, measurements({ nouls: { linkedin_energy: 0.95 } }), "linkedin")).toContain("note:HC006");
  });

  it("teenager mode turns slang off and corporate phrases into errors", () => {
    const text = "no cap we need to circle back on this";
    const dflt = codes(text, measurements());
    expect(dflt).toContain("note:HC208");
    expect(dflt).toContain("warning:HC201");
    const teen = codes(text, measurements({}, "teenager"), "teenager");
    expect(teen).not.toContain("note:HC208");
    expect(teen).toContain("error:HC201");
    const teenWall = codes(text, measurements({}, "teenager"), "teenager", flags({ wall: true }));
    expect(teenWall).toContain("note:HC208");
  });

  it("mode questions fire their own codes", () => {
    const m = measurements({ nouls: { meta_meeting: 0.8 } }, "manager");
    expect(codes(quiet, m, "manager")).toContain("warning:HC313");
    expect(codes(quiet, measurements({ nouls: { meta_meeting: 0.8 } }), "default")).not.toContain("warning:HC313");
  });
});

describe("lexical and count rules", () => {
  it("emits one diagnostic per phrase hit with a span and label", () => {
    const d = runRules(lex(CORPORATE_EMAIL), measurements(), getMode("corporate"), flags());
    const circle = d.find((x) => x.code === "HC201" && x.message === '"circle back" detected');
    expect(circle).toMatchObject({ level: "warning", label: 'consider: "follow up"', span: { line: 3, col: 32, length: 11 } });
    const pa = d.find((x) => x.code === "HC202");
    expect(pa?.message).toBe('"Per my last email" detected');
    const del = runRules(lex("At the end of the day it works."), measurements(), getMode("default"), flags());
    expect(del.find((x) => x.code === "HC201")?.label).toBe("delete");
  });

  it("names the deprecation year", () => {
    const d = runRules(lex("Embrace the new normal."), measurements(), getMode("default"), flags());
    expect(d.find((x) => x.code === "HC212")?.message).toBe('"new normal" is deprecated since 2021');
  });

  it("HC213 flags undeclared acronyms and academic mode makes them errors", () => {
    const text = "The KPI moved. Our TCO (total cost of ownership) fell.";
    expect(codes(text, measurements())).toContain("note:HC213");
    expect(codes(text, measurements({}, "academic"), "academic")).toContain("error:HC213");
    const d = runRules(lex(text), measurements(), getMode("default"), flags());
    expect(d.filter((x) => x.code === "HC213")).toHaveLength(1);
  });

  it("HC214 and HC215 count repetition", () => {
    const text = "Alignment. More alignment. Total alignment. Synergy plus synergy.";
    const d = runRules(lex(text), measurements(), getMode("default"), flags());
    expect(d.find((x) => x.code === "HC214")?.message).toBe('3 instances of "alignment"');
    expect(d.find((x) => x.code === "HC215")).toMatchObject({ level: "error", message: 'SynergyOverflow: "synergy" used 2 times' });
    expect(d.filter((x) => x.code === "HC214" && x.message.includes("synergy"))).toHaveLength(0);
  });

  it("count rules respect mode overrides", () => {
    const text = "Wow!!! 🚀🚀🎉 PLEASE READ THIS";
    const dflt = codes(text, measurements());
    expect(dflt).toEqual(expect.arrayContaining(["warning:HC216", "warning:HC217", "note:HC218"]));
    const teen = codes(text, measurements({}, "teenager"), "teenager");
    expect(teen).not.toContain("warning:HC216");
    expect(teen).not.toContain("warning:HC217");
    expect(teen).not.toContain("note:HC218");
  });
});

describe("structural rules", () => {
  it("HC117 marks dead units with spans", () => {
    const text = "Real content: the meeting is at 10:00.\n\nThanks so much everyone.\n\nReally appreciate it.";
    const d = runRules(lex(text), measurements({ units: [0.9, 0.2, 0.3] }), getMode("default"), flags());
    const dead = d.filter((x) => x.code === "HC117");
    expect(dead.map((x) => x.message)).toEqual(["paragraph 2 adds no new information", "paragraph 3 adds no new information"]);
    expect(dead[0].span).toEqual({ line: 3, col: 1, length: 24 });
    expect(dead[0].notes).toEqual(["unit_1 = 0.20, threshold 0.40"]);
  });

  it("HC118 marks paragraphs after a conclusion as unreachable", () => {
    const text = "Intro.\n\nIn conclusion, buy it.\n\nAlso this.\n\nAnd that.";
    const d = runRules(lex(text), measurements(), getMode("default"), flags());
    const unreachable = d.filter((x) => x.code === "HC118");
    expect(unreachable).toHaveLength(2);
    expect(unreachable[0]).toMatchObject({ message: 'unreachable paragraph: reader returned at "In conclusion"', span: { line: 5, col: 1 } });
  });

  it("HC119, HC120 and HC121 measure length", () => {
    const longSentence = Array.from({ length: 46 }, (_, i) => `w${i}`).join(" ") + ".";
    expect(codes(longSentence, measurements())).toContain("warning:HC120");
    const block = Array.from({ length: 150 }, () => "word").join(" ");
    const out = codes(block, measurements());
    expect(out).toContain("warning:HC121");
    expect(out).toContain("warning:HC119");
    expect(codes("Short one.\n\nShort two.", measurements())).not.toContain("warning:HC121");
  });

  it("HC122 notes very short input", () => {
    expect(codes("ok then", measurements())).toContain("note:HC122");
    expect(codes(quiet, measurements())).not.toContain("note:HC122");
  });
});
