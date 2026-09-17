// Compiler modes. A mode is a lint profile: which categories fire, at what
// level, with which thresholds, plus a few mode-specific questions.

import type { Category, Level, ModeId } from "./types";

export type LevelOrOff = Level | "off";

export const REGISTERS = {
  corporate: "Internal business communication: memos, status emails, management updates",
  linkedin: "Public professional self-presentation: announcements, career stories, lessons learned",
  academic: "Scholarly or technical writing with claims, evidence, and citations",
  forum: "Online discussion replies: comments, threads, arguments with strangers",
  political: "Public statements by officials, campaigns, or spokespeople",
  teen: "Casual chat between young people, heavy on slang",
  marketing: "Copy meant to sell or promote something",
  personal: "A private message between people who know each other",
} as const;
export type RegisterId = keyof typeof REGISTERS;

export const REGISTER_TO_MODE: Record<RegisterId, ModeId> = {
  corporate: "corporate",
  linkedin: "linkedin",
  academic: "academic",
  forum: "reddit",
  political: "politician",
  teen: "teenager",
  marketing: "linkedin",
  personal: "default",
};

export interface ModeQuestion {
  /** Noul id sent to the model; also the measurement id. */
  id: string;
  code: string;
  label: string;
  instructions: string;
  threshold: number;
  level: Level;
  message: string;
  summary: string;
}

export interface Mode {
  id: ModeId;
  description: string;
  /** Register the mode expects; a confident mismatch is reported. */
  register: RegisterId | null;
  /** Threshold overrides keyed by noul or score id. */
  thresholds: Record<string, number>;
  /** Rule level overrides keyed by rule code. */
  levels: Record<string, LevelOrOff>;
  /** Level for every phrase category. */
  lexical: Record<Category, LevelOrOff>;
  extra: ModeQuestion[];
}

const BASE_LEXICAL: Record<Category, LevelOrOff> = {
  corporate: "warning",
  passive_aggressive: "warning",
  urgency: "warning",
  linkedin: "warning",
  academic: "note",
  reddit: "note",
  politician: "note",
  teenager: "note",
  ai_slop: "warning",
  filler: "note",
  hedge: "note",
  deprecated: "warning",
};

function lexical(overrides: Partial<Record<Category, LevelOrOff>>): Record<Category, LevelOrOff> {
  return { ...BASE_LEXICAL, ...overrides };
}

const q = (
  code: string,
  id: string,
  label: string,
  instructions: string,
  message: string,
  summary: string,
  threshold = 0.7,
  level: Level = "warning",
): ModeQuestion => ({ code, id, label, instructions, message, summary, threshold, level });

export const MODES: Record<ModeId, Mode> = {
  default: {
    id: "default",
    description: "Balanced profile. Suggests a mode when the input has an obvious dialect.",
    register: null,
    thresholds: {},
    levels: {},
    lexical: lexical({}),
    extra: [],
  },
  corporate: {
    id: "corporate",
    description: "Internal email and memos. Jargon, urgency, and vagueness are warnings.",
    register: "corporate",
    thresholds: { corporate_bullshit: 0.7, meeting_could_be_email: 0.65, vague_ask: 0.6 },
    levels: {},
    lexical: lexical({ academic: "off", reddit: "off", teenager: "error", filler: "warning" }),
    extra: [
      q(
        "HC301",
        "vague_reorg",
        "VAGUE_REORG",
        "The text in `text` announces a change, restructuring, or new process without saying what will be different for the reader.",
        "change announced without saying what changes",
        "A change is announced but its effect on the reader is not stated.",
      ),
      q(
        "HC302",
        "fake_consultation",
        "FAKE_CONSULTATION",
        "The text in `text` asks for feedback or input while making clear the decision has already been made.",
        "feedback requested on a decision already made",
        "Feedback is requested on something already decided.",
      ),
      q(
        "HC303",
        "agentless_decision",
        "AGENTLESS_DECISION",
        "The text in `text` describes a decision or action without saying who decided or who will act, for example by using 'we', 'the business', or the passive voice.",
        "decision has no named owner",
        "A decision or action is described without a named owner.",
      ),
    ],
  },
  manager: {
    id: "manager",
    description: "Messages from a manager. Meetings, updates, and delegation are checked hardest.",
    register: "corporate",
    thresholds: { meeting_could_be_email: 0.6, vague_ask: 0.55, corporate_bullshit: 0.7 },
    levels: { HC005: "error" },
    lexical: lexical({ corporate: "error", academic: "off", reddit: "off", teenager: "error", filler: "warning" }),
    extra: [
      q(
        "HC311",
        "contextless_update",
        "CONTEXTLESS_UPDATE",
        "The text in `text` asks for an update or status without saying what it is needed for or by when.",
        "update requested without purpose or deadline",
        "An update is requested with no purpose or deadline.",
      ),
      q(
        "HC312",
        "ownerless_task",
        "OWNERLESS_TASK",
        "The text in `text` hands out a task without a named owner or a due date.",
        "task has no owner or due date",
        "A task is delegated without an owner or a due date.",
      ),
      q(
        "HC313",
        "meta_meeting",
        "META_MEETING",
        "The text in `text` proposes a meeting whose purpose is to plan, schedule, or discuss another meeting.",
        "meeting about a meeting",
        "A meeting is proposed to discuss another meeting.",
      ),
    ],
  },
  linkedin: {
    id: "linkedin",
    description: "Public professional posts. Bragging and engagement bait are checked; jargon is expected.",
    register: "linkedin",
    thresholds: { linkedin_energy: 0.9, humble_brag: 0.6, self_congratulation: 0.6, excessive_enthusiasm: 0.65 },
    levels: { HC006: "note", HC218: "off", HC219: "note" },
    lexical: lexical({ corporate: "note", filler: "off", hedge: "off", academic: "off", reddit: "off" }),
    extra: [
      q(
        "HC321",
        "parable",
        "PARABLE",
        "The text in `text` tells a personal story mainly to deliver a business or career lesson at the end.",
        "personal story used as a delivery vehicle for a lesson",
        "A personal story exists to deliver a lesson.",
      ),
      q(
        "HC322",
        "announcement",
        "ANNOUNCEMENT",
        "The text in `text` announces the author's new job, promotion, award, or milestone.",
        "announcement of the author's own milestone",
        "The author announces their own milestone.",
        0.7,
        "note",
      ),
      q(
        "HC323",
        "engagement_bait",
        "ENGAGEMENT_BAIT",
        "The text in `text` ends with a question, prompt, or request whose purpose is to get replies, likes, or shares rather than information.",
        "closing question exists to farm replies",
        "The closing question is there to get replies.",
      ),
    ],
  },
  academic: {
    id: "academic",
    description: "Papers and technical writing. Undeclared acronyms are errors; hedging is tolerated.",
    register: "academic",
    thresholds: { hedging: 0.85, circular_reasoning: 0.55 },
    levels: { HC213: "error", HC010: "note" },
    lexical: lexical({ academic: "warning", reddit: "off", teenager: "error", filler: "warning", hedge: "note" }),
    extra: [
      q(
        "HC331",
        "novelty_claim",
        "NOVELTY_CLAIM",
        "The text in `text` claims that something is new, novel, or the first of its kind without saying what specifically is new.",
        "novelty claimed without saying what is new",
        "Novelty is claimed without specifics.",
      ),
      q(
        "HC332",
        "scope_dodge",
        "SCOPE_DODGE",
        "The text in `text` dismisses a limitation, counterexample, or obvious question as out of scope or left for future work.",
        "limitation dismissed as out of scope",
        "A limitation is dismissed as out of scope.",
      ),
      q(
        "HC333",
        "claimless",
        "CLAIMLESS",
        "The text in `text` hedges so heavily that it makes no claim a reader could disagree with.",
        "no falsifiable claim found",
        "Hedging leaves no claim to disagree with.",
      ),
    ],
  },
  reddit: {
    id: "reddit",
    description: "Forum replies. Sarcasm is expected; pedantry and credentialism are warnings.",
    register: "forum",
    thresholds: { sarcasm: 0.9 },
    levels: { HC020: "off", HC030: "note" },
    lexical: lexical({ reddit: "warning", teenager: "note", hedge: "off", filler: "off", ai_slop: "error" }),
    extra: [
      q(
        "HC341",
        "well_actually",
        "WELL_ACTUALLY",
        "The text in `text` corrects a detail that does not change the other person's point.",
        "correction does not change the point",
        "A correction is made that changes nothing.",
      ),
      q(
        "HC342",
        "source_demand",
        "SOURCE_DEMAND",
        "The text in `text` demands a source or citation for a claim that is ordinary, obvious, or a matter of opinion.",
        "source demanded for an ordinary claim",
        "A source is demanded for an ordinary claim.",
      ),
      q(
        "HC343",
        "credentialism",
        "CREDENTIALISM",
        "The text in `text` uses the author's job, identity, or experience as the main reason to accept the argument.",
        "argument rests on the author's credentials",
        "The argument rests on who the author is.",
      ),
    ],
  },
  politician: {
    id: "politician",
    description: "Public statements. Non-answers and responsibility without consequence are checked hardest.",
    register: "political",
    thresholds: { non_answer: 0.5, hedging: 0.6, blame_shifting: 0.6, fake_apology: 0.6 },
    levels: { HC014: "error" },
    lexical: lexical({ politician: "warning", corporate: "note", teenager: "note", reddit: "off" }),
    extra: [
      q(
        "HC351",
        "pivot",
        "PIVOT",
        "The text in `text` answers a different question from the one that was asked, or redirects to a preferred topic.",
        "response answers a different question",
        "A different question is answered.",
      ),
      q(
        "HC352",
        "consequence_free",
        "CONSEQUENCE_FREE",
        "The text in `text` accepts responsibility or acknowledges a mistake without naming any consequence, remedy, or change.",
        "responsibility accepted without consequence",
        "Responsibility is accepted with no consequence.",
      ),
      q(
        "HC353",
        "invokes_the_people",
        "INVOKES_THE_PEOPLE",
        "The text in `text` speaks on behalf of an unnamed group such as 'the people', 'families', or 'the community' to support its position.",
        "unnamed group invoked as support",
        "An unnamed group is invoked as support.",
      ),
    ],
  },
  teenager: {
    id: "teenager",
    description: "Casual chat. Slang is expected; corporate and academic phrases are errors.",
    register: "teen",
    thresholds: { hostility: 1.7 },
    levels: { HC216: "off", HC217: "off", HC218: "off", HC030: "note", HC120: "off" },
    lexical: lexical({
      teenager: "off",
      corporate: "error",
      academic: "error",
      ai_slop: "error",
      passive_aggressive: "note",
      filler: "off",
      hedge: "off",
      reddit: "note",
    }),
    extra: [
      q(
        "HC361",
        "ironic_detachment",
        "IRONIC_DETACHMENT",
        "The text in `text` expresses interest or enthusiasm only through irony, understatement, or pretending not to care.",
        "enthusiasm expressed through irony only",
        "Enthusiasm appears only as irony.",
      ),
      q(
        "HC362",
        "lookup_required",
        "LOOKUP_REQUIRED",
        "The text in `text` uses slang or references that a reader over thirty would need to look up.",
        "reader over thirty would need a glossary",
        "Slang would need a glossary.",
        0.7,
        "note",
      ),
      q(
        "HC363",
        "reactions_only",
        "REACTIONS_ONLY",
        "The text in `text` consists mostly of reactions or exclamations rather than statements with content.",
        "mostly reactions, few statements",
        "Reactions outnumber statements.",
      ),
    ],
  },
};

export function getMode(id: ModeId): Mode {
  return MODES[id];
}
