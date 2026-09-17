// Builds the questions sent to Jev. Question ids are for code; the meaning
// lives in the instructions and criteria.

import type { Questions } from "@typesafe-ai/sdk";
import type { Mode } from "./modes";
import { REGISTERS } from "./modes";
import type { Lexed } from "./types";

export interface NoulSpec {
  id: string;
  label: string;
  instructions: string;
  criteria?: { true?: string; false?: string };
  /** Always shown in the measurement table. */
  headline?: boolean;
  /** Describes a property that is not a defect; excluded from severity. */
  presence?: boolean;
}

export const NOULS: readonly NoulSpec[] = [
  {
    id: "passive_aggression",
    label: "PASSIVE_AGGRESSION",
    headline: true,
    instructions:
      "The text in `text` is passive-aggressive: hostility, criticism, or blame expressed indirectly through politeness, sarcasm, reminders, or implication.",
    criteria: {
      true: "Polite surface with an implied accusation or grievance, e.g. 'per my last email', 'as I already explained', 'thanks in advance'.",
      false: "Direct criticism, or genuinely neutral text.",
    },
  },
  {
    id: "corporate_bullshit",
    label: "CORPORATE_BULLSHIT",
    headline: true,
    instructions:
      "The text in `text` relies on corporate jargon or business-speak that obscures rather than conveys meaning.",
    criteria: {
      true: "Phrases like synergy, alignment, leverage, or circle back stand in for concrete statements.",
      false: "Jargon is absent, or used sparingly with concrete meaning.",
    },
  },
  {
    id: "actual_information",
    label: "ACTUAL_INFORMATION",
    headline: true,
    presence: true,
    instructions:
      "The text in `text` conveys concrete, specific information that a reader did not already have and could act on: facts, numbers, dates, decisions, names, or instructions.",
    criteria: {
      true: "A reader learns something specific: what happened, what will happen, when, who, or how much.",
      false: "Generalities, sentiment, or process talk with nothing a reader could write down.",
    },
  },
  {
    id: "unnecessary_urgency",
    label: "UNNECESSARY_URGENCY",
    headline: true,
    instructions:
      "The text in `text` manufactures urgency that its content does not justify, for example by demanding immediate action without a reason or deadline.",
  },
  {
    id: "meeting_could_be_email",
    label: "MEETING_COULD_BE_EMAIL",
    headline: true,
    instructions:
      "The text in `text` proposes or describes a meeting, call, or sync whose stated purpose could be handled in writing.",
    criteria: {
      true: "A meeting is proposed to share information, give an update, or ask a simple question.",
      false: "No meeting is mentioned, or the meeting requires live discussion or negotiation.",
    },
  },
  {
    id: "linkedin_energy",
    label: "LINKEDIN_ENERGY",
    headline: true,
    instructions:
      "The text in `text` reads like a LinkedIn post: performative professional enthusiasm, humble-bragging, inspirational framing, or lessons learned.",
  },
  {
    id: "sounds_ai_generated",
    label: "SOUNDS_AI_GENERATED",
    headline: true,
    instructions:
      "The text in `text` reads as if written by an AI language model: generic, evenly structured, hedged, and free of specific personal detail or voice.",
  },
  {
    id: "circular_reasoning",
    label: "CIRCULAR_REASONING",
    instructions:
      "The text in `text` supports a claim by restating the claim itself or by assuming its own conclusion.",
  },
  {
    id: "humble_brag",
    label: "HUMBLE_BRAG",
    instructions:
      "The text in `text` presents a boast disguised as modesty, gratitude, complaint, or surprise.",
  },
  {
    id: "hedging",
    label: "HEDGING",
    instructions:
      "The text in `text` avoids committing to a clear position through qualifiers, caveats, and softeners.",
  },
  {
    id: "condescension",
    label: "CONDESCENSION",
    instructions:
      "The text in `text` talks down to the reader or explains things the reader obviously already knows.",
  },
  {
    id: "fake_apology",
    label: "FAKE_APOLOGY",
    instructions:
      "The text in `text` contains an apology that shifts blame, conditions the apology on the reader's feelings, or does not accept responsibility, e.g. 'sorry if you felt that way'.",
    criteria: { false: "No apology, or a plain apology that accepts responsibility." },
  },
  {
    id: "blame_shifting",
    label: "BLAME_SHIFTING",
    instructions:
      "The text in `text` attributes a problem to other people or circumstances while avoiding the author's own responsibility.",
  },
  {
    id: "non_answer",
    label: "NON_ANSWER",
    instructions: "The text in `text` responds to a question or request without actually answering it.",
    criteria: { false: "No question was being answered, or the question is answered directly." },
  },
  {
    id: "guilt_trip",
    label: "GUILT_TRIP",
    instructions: "The text in `text` tries to make the reader feel guilty in order to get a response or action.",
  },
  {
    id: "veiled_threat",
    label: "VEILED_THREAT",
    instructions:
      "The text in `text` contains an implied threat or consequence stated indirectly, e.g. 'it would be a shame if', 'I'd hate to have to escalate'.",
  },
  {
    id: "excessive_enthusiasm",
    label: "EXCESSIVE_ENTHUSIASM",
    instructions: "The text in `text` expresses enthusiasm out of proportion to what it is about.",
  },
  {
    id: "self_congratulation",
    label: "SELF_CONGRATULATION",
    instructions: "The author of `text` praises themselves, their team, or their organisation.",
  },
  {
    id: "contains_request",
    label: "CONTAINS_REQUEST",
    presence: true,
    instructions: "The text in `text` asks the reader to do something.",
  },
  {
    id: "vague_ask",
    label: "VAGUE_ASK",
    instructions:
      "The text in `text` asks the reader for something without saying clearly what is wanted, by when, or why.",
    criteria: { false: "Nothing is asked, or the request states what, when, and why." },
  },
  {
    id: "sarcasm",
    label: "SARCASM",
    instructions: "The text in `text` is sarcastic: it says the opposite of what it means for effect.",
  },
  {
    id: "toxic_positivity",
    label: "TOXIC_POSITIVITY",
    instructions: "The text in `text` dismisses a real problem or concern with forced positivity.",
  },
  {
    id: "rage_bait",
    label: "RAGE_BAIT",
    instructions: "The text in `text` is designed to provoke outrage or engagement rather than to inform.",
  },
  {
    id: "incoherent",
    label: "INCOHERENT",
    instructions: "The sentences in `text` do not connect logically, or the text as a whole cannot be followed.",
  },
  {
    id: "clickbait",
    label: "CLICKBAIT",
    instructions: "The text in `text` withholds its main point to make the reader keep reading.",
  },
  {
    id: "name_dropping",
    label: "NAME_DROPPING",
    instructions: "The text in `text` mentions people, companies, or credentials mainly to impress the reader.",
  },
  {
    id: "fomo",
    label: "FOMO",
    instructions:
      "The text in `text` implies the reader will miss out, fall behind, or regret it if they do not act.",
  },
  {
    id: "cover_own_ass",
    label: "COVER_OWN_ASS",
    instructions: "The main purpose of `text` is to create a record that protects the author from blame later.",
  },
];

export const CHOICES = {
  intent: {
    label: "intent",
    instructions: "The primary purpose of the author of `text`.",
    criteria: {
      inform: "Tell the reader something they did not know",
      persuade: "Change what the reader believes or does",
      request: "Get the reader to do a specific thing",
      cover_own_ass: "Create a record that protects the author from blame",
      vent: "Express feelings without expecting action",
      self_promote: "Make the author look good",
      unknown: "No discernible purpose",
    },
  },
  register: {
    label: "dialect",
    instructions: "The kind of communication `text` most resembles.",
    criteria: REGISTERS,
  },
  subtext: {
    label: "subtext",
    instructions: "The strongest emotion underneath the surface of `text`, if any.",
    criteria: {
      none: "No emotional subtext; the text means what it says",
      anger: "Irritation or anger held back",
      anxiety: "Worry about an outcome or about being blamed",
      contempt: "Low regard for the reader or a third party",
      insecurity: "Need for approval or fear of looking bad",
      boredom: "Going through the motions",
      desperation: "Urgent need for a response or help",
    },
  },
} as const;

export const SCORES = {
  information_density: {
    label: "information_density",
    instructions: "How much of `text` carries specific information.",
    criteria: [
      "No concrete information; the text could be deleted without loss",
      "Mostly filler with one or two concrete points",
      "Concrete content with some padding",
      "Nearly every sentence carries specific information",
    ],
  },
  length_excess: {
    label: "length_excess",
    instructions: "How much of `text` could be removed without losing anything the reader needs.",
    criteria: [
      "Nothing could be removed without losing content",
      "A few sentences could be removed",
      "About half could be removed",
      "Most of it could be removed",
    ],
  },
  clarity: {
    label: "clarity",
    instructions: "How hard it is to work out what `text` means.",
    criteria: ["Clear on one reading", "Needs a second reading to be sure", "Meaning cannot be determined"],
  },
  hostility: {
    label: "hostility",
    instructions: "The tone of `text` toward the reader.",
    criteria: ["Neutral or warm", "Cold, curt, or impatient", "Openly hostile or insulting"],
  },
} as const;

export const UNIT_PREFIX = "unit_";

export interface BuiltQuestions {
  state: { text: string; units?: string[] };
  questions: Questions;
  count: number;
}

export function buildQuestions(lexed: Lexed, mode: Mode): BuiltQuestions {
  const questions: Questions = {};

  for (const n of NOULS) {
    questions[n.id] = { type: "noul", instructions: n.instructions, criteria: n.criteria ?? null };
  }
  for (const x of mode.extra) {
    questions[x.id] = { type: "noul", instructions: x.instructions };
  }
  for (const [id, c] of Object.entries(CHOICES)) {
    questions[id] = { type: "choice", instructions: c.instructions, criteria: { ...c.criteria } };
  }
  for (const [id, s] of Object.entries(SCORES)) {
    questions[id] = {
      type: "score",
      instructions: s.instructions,
      criteria: [...s.criteria] as [string, string, ...string[]],
    };
  }

  const state: BuiltQuestions["state"] = { text: lexed.source };
  if (lexed.units.length >= 2) {
    state.units = lexed.units.map((u) => u.text);
    const kind = lexed.unitKind;
    for (const u of lexed.units) {
      const i = u.index;
      questions[`${UNIT_PREFIX}${i}`] = {
        type: "noul",
        instructions:
          i === 0
            ? `The ${kind} \`units[0]\` contains concrete information a reader could act on.`
            : `The ${kind} \`units[${i}]\` adds information that is not already present in \`units[0]\` through \`units[${i - 1}]\`.`,
        criteria: {
          true:
            i === 0
              ? "It states a fact, decision, date, number, name, or instruction."
              : "It states something new: a fact, decision, date, number, name, or instruction not covered earlier.",
          false:
            i === 0
              ? "It is a greeting, framing, or sentiment."
              : "It restates, summarises, thanks, signs off, or adds only sentiment.",
        },
      };
    }
  }

  return { state, questions, count: Object.keys(questions).length };
}

/** Every noul the report can show, in display order. */
export function noulSpecsFor(mode: Mode): NoulSpec[] {
  return [...NOULS, ...mode.extra.map((x) => ({ id: x.id, label: x.label, instructions: x.instructions }))];
}
