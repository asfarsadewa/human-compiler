// The rule catalog. Every diagnostic the compiler can emit is declared here
// with a code, a default level, and a one-line summary for the man page.
// Rules read measurements and lexical facts; they never call the model.

import { phraseCounts } from "./lexer";
import { MODES, REGISTER_TO_MODE, type LevelOrOff, type Mode, type ModeQuestion, type RegisterId } from "./modes";
import { SCORES } from "./questions";
import type { Category, Flags, Level, Lexed, Measurements, Span } from "./types";

export interface RuleContext {
  lexed: Lexed;
  m: Measurements;
  mode: Mode;
  flags: Flags;
  /** Threshold for rules that fire when a value is at or above it. -Wall lowers it. */
  th(id: string, def: number): number;
  /** Threshold for rules that fire when a value is below it. -Wall raises it. */
  thLow(id: string, def: number): number;
}

export interface Fired {
  message: string;
  span?: Span;
  label?: string;
  notes?: string[];
  help?: string[];
  /** Overrides the rule's default level before mode and flag resolution. */
  level?: Level;
}

export interface Rule {
  code: string;
  name: string;
  level: Level;
  summary: string;
  /** Set for phrase rules; the mode's lexical table decides their level. */
  category?: Category;
  run(ctx: RuleContext): Fired[];
}

export const WALL_DELTA = 0.1;
export const DEAD_UNIT_THRESHOLD = 0.4;
export const REPEAT_THRESHOLD = 3;
export const LONG_PARAGRAPH_WORDS = 120;
export const LONG_SENTENCE_WORDS = 45;
export const SINGLE_BLOCK_WORDS = 150;
export const MIN_WORDS = 5;

const f2 = (n: number): string => n.toFixed(2);

export const CATEGORY_CODES: Record<Category, string> = {
  corporate: "HC201",
  passive_aggressive: "HC202",
  urgency: "HC203",
  linkedin: "HC204",
  academic: "HC205",
  reddit: "HC206",
  politician: "HC207",
  teenager: "HC208",
  ai_slop: "HC209",
  filler: "HC210",
  hedge: "HC211",
  deprecated: "HC212",
};

export const CATEGORY_NAMES: Record<Category, string> = {
  corporate: "corporate phrase",
  passive_aggressive: "passive-aggressive phrase",
  urgency: "manufactured urgency",
  linkedin: "linkedin phrase",
  academic: "academic evasion",
  reddit: "forum reflex",
  politician: "political phrase",
  teenager: "slang",
  ai_slop: "model-generated phrase",
  filler: "filler",
  hedge: "hedge",
  deprecated: "deprecated phrase",
};

function noulRule(
  code: string,
  id: string,
  threshold: number,
  level: Level,
  message: string,
  summary: string,
): Rule {
  return {
    code,
    name: id,
    level,
    summary,
    run(ctx) {
      const v = ctx.m.nouls[id];
      if (v === undefined) return [];
      const t = ctx.th(id, threshold);
      return v >= t ? [{ message, notes: [`${id} = ${f2(v)}, threshold ${f2(t)}`] }] : [];
    },
  };
}

function scoreRule(
  code: string,
  id: keyof typeof SCORES,
  threshold: number,
  level: Level,
  message: (score: number, legend: string) => string,
  summary: string,
): Rule {
  return {
    code,
    name: id,
    level,
    summary,
    run(ctx) {
      const s = ctx.m.scores[id];
      if (!s) return [];
      const t = ctx.th(id, threshold);
      if (s.score < t) return [];
      const max = SCORES[id].criteria.length - 1;
      const legend = s.legend[String(Math.min(max, Math.round(s.score)))] ?? "";
      return [{ message: message(s.score, legend), notes: [`${id} = ${s.score.toFixed(1)} of ${max}, threshold ${t.toFixed(1)}`] }];
    },
  };
}

function lineSpan(lexed: Lexed, line: number, col: number, maxLength: number): Span {
  const text = lexed.lines[line - 1] ?? "";
  const length = Math.max(1, Math.min(maxLength, text.length - (col - 1)));
  return { line, col, length };
}

function pct(n: number): string {
  return `${Math.round(n)}%`;
}

export function deadUnits(ctx: Pick<RuleContext, "lexed" | "m" | "thLow">): number[] {
  if (ctx.lexed.units.length < 2) return [];
  const t = ctx.thLow("unit_new_info", DEAD_UNIT_THRESHOLD);
  const dead: number[] = [];
  ctx.m.units.forEach((p, i) => {
    if (i < ctx.lexed.units.length && p < t) dead.push(i);
  });
  return dead;
}

export function unreachableParagraphs(lexed: Lexed): number[] {
  if (lexed.terminatorUnit === null) return [];
  return lexed.paragraphs.filter((p) => p.index > (lexed.terminatorUnit as number)).map((p) => p.index);
}

const SEMANTIC_RULES: Rule[] = [
  noulRule("HC001", "passive_aggression", 0.7, "warning", "passive aggression detected", "Passive aggression above threshold."),
  noulRule("HC002", "corporate_bullshit", 0.8, "warning", "corporate language exceeds tolerance", "Corporate jargon above threshold."),
  {
    code: "HC003",
    name: "null_meaning",
    level: "error",
    summary: "No recoverable information in an input of thirty words or more.",
    run(ctx) {
      const v = ctx.m.nouls.actual_information;
      if (v === undefined || ctx.lexed.words < 30) return [];
      const t = ctx.thLow("actual_information", 0.25);
      return v < t
        ? [{ message: `NullMeaningException: no recoverable information in ${ctx.lexed.words} words`, notes: [`actual_information = ${f2(v)}, threshold ${f2(t)}`] }]
        : [];
    },
  },
  noulRule("HC004", "unnecessary_urgency", 0.7, "warning", "urgency not justified by content", "Urgency the content does not justify."),
  noulRule("HC005", "meeting_could_be_email", 0.75, "warning", "meeting could be an email", "A proposed meeting could be handled in writing."),
  noulRule("HC006", "linkedin_energy", 0.7, "warning", "linkedin energy detected", "Performative professional enthusiasm."),
  noulRule("HC007", "sounds_ai_generated", 0.7, "warning", "input appears machine-generated", "Reads like model output."),
  noulRule("HC008", "circular_reasoning", 0.65, "error", "CircularReasoningError: conclusion depends on itself", "A claim is supported by restating it."),
  noulRule("HC009", "humble_brag", 0.7, "warning", "humble brag detected", "A boast disguised as modesty."),
  noulRule("HC010", "hedging", 0.75, "warning", "no committed position found", "Qualifiers replace a position."),
  noulRule("HC011", "condescension", 0.7, "warning", "condescension detected", "The reader is talked down to."),
  noulRule("HC012", "fake_apology", 0.7, "warning", "apology does not accept responsibility", "An apology that shifts blame."),
  noulRule("HC013", "blame_shifting", 0.7, "warning", "responsibility reassigned without evidence", "Blame moved onto others."),
  noulRule("HC014", "non_answer", 0.7, "warning", "response does not address the question", "A question is answered without being answered."),
  noulRule("HC015", "guilt_trip", 0.7, "warning", "guilt used as a call to action", "Guilt is the lever."),
  noulRule("HC016", "veiled_threat", 0.6, "warning", "implied consequence detected", "A threat stated indirectly."),
  noulRule("HC017", "excessive_enthusiasm", 0.75, "warning", "enthusiasm exceeds content", "More enthusiasm than subject."),
  noulRule("HC018", "self_congratulation", 0.7, "warning", "self-congratulation detected", "The author praises themselves."),
  {
    code: "HC019",
    name: "vague_ask",
    level: "warning",
    summary: "A request with no deliverable, deadline, or reason.",
    run(ctx) {
      const req = ctx.m.nouls.contains_request;
      const vague = ctx.m.nouls.vague_ask;
      if (req === undefined || vague === undefined) return [];
      const tr = ctx.th("contains_request", 0.6);
      const tv = ctx.th("vague_ask", 0.65);
      return req >= tr && vague >= tv
        ? [{ message: "request has no deliverable, deadline, or reason", notes: [`contains_request = ${f2(req)}, vague_ask = ${f2(vague)}, threshold ${f2(tv)}`] }]
        : [];
    },
  },
  noulRule("HC020", "sarcasm", 0.7, "note", "sarcasm detected", "The text says the opposite of what it means."),
  noulRule("HC021", "toxic_positivity", 0.7, "warning", "problem dismissed with positivity", "A real problem waved away."),
  noulRule("HC022", "rage_bait", 0.7, "warning", "input optimised for outrage", "Built to provoke, not inform."),
  noulRule("HC023", "incoherent", 0.7, "error", "SyntaxError: sentences do not connect", "The text cannot be followed."),
  noulRule("HC024", "clickbait", 0.7, "warning", "main point withheld", "The point is held back to keep you reading."),
  noulRule("HC025", "name_dropping", 0.7, "note", "name dropping detected", "Names used to impress."),
  noulRule("HC026", "fomo", 0.7, "warning", "fear of missing out invoked", "You will be left behind, apparently."),
  {
    code: "HC027",
    name: "information_density",
    level: "warning",
    summary: "Information density at the lowest level in an input of forty words or more.",
    run(ctx) {
      const s = ctx.m.scores.information_density;
      if (!s || ctx.lexed.words < 40) return [];
      const t = ctx.thLow("information_density", 0.75);
      if (s.score >= t) return [];
      const legend = s.legend[String(Math.round(s.score))] ?? "";
      return [{ message: `information density ${s.score.toFixed(1)} of 3: ${legend.toLowerCase()}`, notes: [`information_density = ${s.score.toFixed(1)}, threshold ${t.toFixed(2)}`] }];
    },
  },
  {
    code: "HC028",
    name: "length_excess",
    level: "warning",
    summary: "Half or more of the input could be removed.",
    run(ctx) {
      const s = ctx.m.scores.length_excess;
      if (!s) return [];
      const t = ctx.th("length_excess", 1.5);
      if (s.score < t) return [];
      const dead = deadUnits(ctx);
      const removable = dead.reduce((n, i) => n + ctx.lexed.units[i].text.length, 0);
      const fromUnits = ctx.lexed.chars > 0 ? (removable / ctx.lexed.chars) * 100 : 0;
      const estimate = dead.length > 0 ? fromUnits : (s.score / 3) * 100;
      const help: string[] = [];
      if (dead.length > 0 && !ctx.flags.o2) {
        help.push(`run with -O2 to remove ${dead.length} dead ${ctx.lexed.unitKind}${dead.length === 1 ? "" : "s"}`);
      }
      return [
        {
          message: `${pct(estimate)} of input could be removed`,
          notes: [`length_excess = ${s.score.toFixed(1)} of 3, threshold ${t.toFixed(1)}`],
          help,
        },
      ];
    },
  },
  scoreRule(
    "HC029",
    "clarity",
    1.4,
    "warning",
    (score) => (score >= 1.9 ? "meaning cannot be determined" : "meaning requires more than one reading"),
    "The meaning takes more than one reading to work out.",
  ),
  scoreRule("HC030", "hostility", 1.4, "warning", (_s, legend) => `hostile tone: ${legend.toLowerCase()}`, "Tone toward the reader is cold or hostile."),
  {
    code: "HC031",
    name: "intent_cover_own_ass",
    level: "warning",
    summary: "The most likely purpose of the text is to create a protective record.",
    run(ctx) {
      const c = ctx.m.choices.intent;
      if (!c) return [];
      const p = c.probabilities.cover_own_ass ?? 0;
      const t = ctx.th("intent_cover_own_ass", 0.45);
      return p >= t
        ? [{ message: "primary intent resolved to cover_own_ass", notes: [`intent.cover_own_ass = ${f2(p)}, threshold ${f2(t)}`] }]
        : [];
    },
  },
  {
    code: "HC032",
    name: "dialect",
    level: "note",
    summary: "The input's dialect does not match the mode, or suggests one.",
    run(ctx) {
      const c = ctx.m.choices.register;
      if (!c) return [];
      const reg = c.choice as RegisterId;
      const p = c.probabilities[reg] ?? 0;
      if (ctx.mode.register === null) {
        const suggested = REGISTER_TO_MODE[reg];
        if (!suggested || suggested === "default" || p < ctx.th("register", 0.5)) return [];
        return [{ level: "help", message: `input dialect resolved to ${reg}; try --mode ${suggested}`, notes: [`dialect.${reg} = ${f2(p)}`] }];
      }
      if (reg === ctx.mode.register || p < ctx.th("register", 0.6)) return [];
      return [{ message: `input dialect resolved to ${reg}; compiled with --mode ${ctx.mode.id}`, notes: [`dialect.${reg} = ${f2(p)}`] }];
    },
  },
  {
    code: "HC033",
    name: "subtext",
    level: "note",
    summary: "An emotion under the surface of the text.",
    run(ctx) {
      const c = ctx.m.choices.subtext;
      if (!c || c.choice === "none") return [];
      const p = c.probabilities[c.choice] ?? 0;
      const t = ctx.th("subtext", 0.5);
      return p >= t ? [{ message: `emotional subtext: ${c.choice}`, notes: [`subtext.${c.choice} = ${f2(p)}, threshold ${f2(t)}`] }] : [];
    },
  },
];

const STRUCTURAL_RULES: Rule[] = [
  {
    code: "HC117",
    name: "dead_unit",
    level: "warning",
    summary: "A paragraph (or sentence) adds no information not already present.",
    run(ctx) {
      const t = ctx.thLow("unit_new_info", DEAD_UNIT_THRESHOLD);
      return deadUnits(ctx).map((i) => {
        const u = ctx.lexed.units[i];
        return {
          message: `${ctx.lexed.unitKind} ${i + 1} adds no new information`,
          span: lineSpan(ctx.lexed, u.line, u.col, u.text.length),
          label: "dead",
          notes: [`unit_${i} = ${f2(ctx.m.units[i])}, threshold ${f2(t)}`],
        };
      });
    },
  },
  {
    code: "HC118",
    name: "unreachable",
    level: "warning",
    summary: "A paragraph after a conclusion. The reader has already returned.",
    run(ctx) {
      const phrase = ctx.lexed.terminatorPhrase ?? "conclusion";
      const term = ctx.lexed.terminatorUnit;
      return unreachableParagraphs(ctx.lexed).map((i) => {
        const p = ctx.lexed.paragraphs[i];
        return {
          message: `unreachable paragraph: reader returned at "${phrase}"`,
          span: lineSpan(ctx.lexed, p.line, p.col, p.text.length),
          label: "unreachable",
          notes: term === null ? [] : [`conclusion begins at line ${ctx.lexed.paragraphs[term].line}`],
        };
      });
    },
  },
  {
    code: "HC119",
    name: "long_paragraph",
    level: "warning",
    summary: `A paragraph of more than ${LONG_PARAGRAPH_WORDS} words.`,
    run(ctx) {
      return ctx.lexed.paragraphs
        .filter((p) => p.words > LONG_PARAGRAPH_WORDS)
        .map((p) => ({
          message: `paragraph is ${p.words} words`,
          span: lineSpan(ctx.lexed, p.line, p.col, p.text.length),
          help: ["split it"],
        }));
    },
  },
  {
    code: "HC120",
    name: "long_sentence",
    level: "warning",
    summary: `A sentence of more than ${LONG_SENTENCE_WORDS} words.`,
    run(ctx) {
      return ctx.lexed.sentences
        .filter((s) => s.words > LONG_SENTENCE_WORDS)
        .map((s) => ({
          message: `sentence is ${s.words} words`,
          span: { line: s.line, col: s.col, length: Math.max(1, s.length) },
          help: ["end it sooner"],
        }));
    },
  },
  {
    code: "HC121",
    name: "single_block",
    level: "warning",
    summary: `A single paragraph of ${SINGLE_BLOCK_WORDS} words or more.`,
    run(ctx) {
      if (ctx.lexed.paragraphs.length !== 1 || ctx.lexed.words < SINGLE_BLOCK_WORDS) return [];
      return [{ message: `input is one block of ${ctx.lexed.words} words`, help: ["paragraphs exist"] }];
    },
  },
  {
    code: "HC122",
    name: "too_short",
    level: "note",
    summary: `Fewer than ${MIN_WORDS} words. Measurements are unreliable.`,
    run(ctx) {
      return ctx.lexed.words < MIN_WORDS ? [{ message: `input is ${ctx.lexed.words} word${ctx.lexed.words === 1 ? "" : "s"}; measurements are unreliable` }] : [];
    },
  },
];

function hitLabel(suggestion: string | undefined): string | undefined {
  if (suggestion === undefined) return undefined;
  if (suggestion === "") return "delete";
  return suggestion.startsWith("<") ? `consider: ${suggestion}` : `consider: "${suggestion}"`;
}

const LEXICAL_RULES: Rule[] = (Object.keys(CATEGORY_CODES) as Category[]).map((category) => ({
  code: CATEGORY_CODES[category],
  name: category,
  level: "warning",
  category,
  summary:
    category === "deprecated"
      ? "A phrase past its expiry date."
      : `A ${CATEGORY_NAMES[category]} from the lexicon.`,
  run(ctx) {
    return ctx.lexed.hits
      .filter((h) => h.category === category)
      .map((h) => {
        const text = ctx.lexed.source.slice(h.offset, h.offset + h.length);
        const message =
          category === "deprecated" ? `"${text}" is deprecated since ${h.since}` : `"${text}" detected`;
        return {
          message,
          span: { line: h.line, col: h.col, length: h.length },
          label: hitLabel(h.suggestion),
          notes: [`category: ${category}`],
        };
      });
  },
}));

const COUNT_RULES: Rule[] = [
  {
    code: "HC213",
    name: "undeclared_acronym",
    level: "note",
    summary: "An acronym used without being expanded on first use.",
    run(ctx) {
      return ctx.lexed.acronyms
        .filter((a) => !a.declared)
        .map((a) => ({
          message: `undeclared acronym "${a.token}"${a.count > 1 ? ` (${a.count} uses)` : ""}`,
          span: { line: a.line, col: a.col, length: a.token.length },
          help: ["expand it on first use"],
        }));
    },
  },
  {
    code: "HC214",
    name: "repetition",
    level: "warning",
    summary: `A phrase used ${REPEAT_THRESHOLD} or more times.`,
    run(ctx) {
      const counts = phraseCounts(ctx.lexed);
      const out: Fired[] = [];
      for (const [phrase, n] of [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        if (n < REPEAT_THRESHOLD || phrase === "synergy" || phrase === "synergies") continue;
        const first = ctx.lexed.hits.find((h) => h.phrase === phrase);
        out.push({
          message: `${n} instances of "${phrase}"`,
          span: first ? { line: first.line, col: first.col, length: first.length } : undefined,
          notes: [`repetition threshold ${REPEAT_THRESHOLD}`],
        });
      }
      return out;
    },
  },
  {
    code: "HC215",
    name: "synergy_overflow",
    level: "error",
    summary: '"synergy" used twice or more.',
    run(ctx) {
      const counts = phraseCounts(ctx.lexed);
      const n = (counts.get("synergy") ?? 0) + (counts.get("synergies") ?? 0);
      if (n < 2) return [];
      const first = ctx.lexed.hits.find((h) => h.phrase === "synergy" || h.phrase === "synergies");
      return [
        {
          message: `SynergyOverflow: "synergy" used ${n} times`,
          span: first ? { line: first.line, col: first.col, length: first.length } : undefined,
          notes: ["the limit is one"],
        },
      ];
    },
  },
  {
    code: "HC216",
    name: "exclamations",
    level: "warning",
    summary: "Three or more exclamation marks.",
    run(ctx) {
      return ctx.lexed.exclamations >= 3 ? [{ message: `${ctx.lexed.exclamations} exclamation marks` }] : [];
    },
  },
  {
    code: "HC217",
    name: "shouting",
    level: "warning",
    summary: "Three or more words in all capitals.",
    run(ctx) {
      const n = ctx.lexed.capsWords.length;
      return n >= 3 ? [{ message: `${n} words in all caps`, notes: [ctx.lexed.capsWords.slice(0, 3).join(", ")] }] : [];
    },
  },
  {
    code: "HC218",
    name: "emoji",
    level: "note",
    summary: "Three or more emoji.",
    run(ctx) {
      return ctx.lexed.emojis >= 3 ? [{ message: `${ctx.lexed.emojis} emoji` }] : [];
    },
  },
  {
    code: "HC219",
    name: "hashtags",
    level: "warning",
    summary: "Two or more hashtags.",
    run(ctx) {
      return ctx.lexed.hashtags >= 2 ? [{ message: `${ctx.lexed.hashtags} hashtags` }] : [];
    },
  },
  {
    code: "HC220",
    name: "questions",
    level: "note",
    summary: "Four or more questions in one message.",
    run(ctx) {
      return ctx.lexed.questions >= 4 ? [{ message: `${ctx.lexed.questions} questions in one message` }] : [];
    },
  },
  {
    code: "HC221",
    name: "em_dashes",
    level: "note",
    summary: "Three or more em dashes.",
    run(ctx) {
      return ctx.lexed.emDashes >= 3
        ? [{ message: `${ctx.lexed.emDashes} em dashes`, notes: ["density consistent with model output"] }]
        : [];
    },
  },
];

function modeRule(x: ModeQuestion): Rule {
  return {
    code: x.code,
    name: x.id,
    level: x.level,
    summary: x.summary,
    run(ctx) {
      const v = ctx.m.nouls[x.id];
      if (v === undefined) return [];
      const t = ctx.th(x.id, x.threshold);
      return v >= t ? [{ message: x.message, notes: [`${x.id} = ${f2(v)}, threshold ${f2(t)}`] }] : [];
    },
  };
}

/** Rules that apply in every mode. */
export const BASE_RULES: readonly Rule[] = [...SEMANTIC_RULES, ...STRUCTURAL_RULES, ...LEXICAL_RULES, ...COUNT_RULES];

/** Rules active for a mode, including its own questions. */
export function rulesFor(mode: Mode): Rule[] {
  return [...BASE_RULES, ...mode.extra.map(modeRule)];
}

/** Every rule across every mode, for documentation. */
export function allRules(): Rule[] {
  const seen = new Set<string>();
  const out: Rule[] = [];
  for (const r of BASE_RULES) {
    seen.add(r.code);
    out.push(r);
  }
  for (const mode of Object.values(MODES)) {
    for (const x of mode.extra) {
      if (!seen.has(x.code)) {
        seen.add(x.code);
        out.push(modeRule(x));
      }
    }
  }
  return out.sort((a, b) => a.code.localeCompare(b.code));
}

/** The level a rule fires at under a mode and flags, or null if it is off. */
export function resolveLevel(rule: Rule, fired: Fired, mode: Mode, flags: Flags): Level | null {
  let base: LevelOrOff = fired.level ?? rule.level;
  const override: LevelOrOff | undefined = rule.category ? mode.lexical[rule.category] : mode.levels[rule.code];
  if (override !== undefined) base = override;
  if (fired.level === "help") base = "help";
  if (base === "off") {
    if (!flags.wall) return null;
    base = "note";
  }
  if (flags.werror && base === "warning") return "error";
  return base;
}

export function makeContext(lexed: Lexed, m: Measurements, mode: Mode, flags: Flags): RuleContext {
  const delta = flags.wall ? WALL_DELTA : 0;
  return {
    lexed,
    m,
    mode,
    flags,
    th(id, def) {
      const base = mode.thresholds[id] ?? def;
      return Math.max(0.05, +(base - delta).toFixed(4));
    },
    thLow(id, def) {
      const base = mode.thresholds[id] ?? def;
      return +(base + delta).toFixed(4);
    },
  };
}
