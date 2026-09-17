// Shared types for the deterministic engine. No runtime dependencies.

export type Level = "error" | "warning" | "note" | "help";
export const LEVEL_ORDER: readonly Level[] = ["error", "warning", "note", "help"];

export const MODE_IDS = [
  "default",
  "corporate",
  "manager",
  "linkedin",
  "academic",
  "reddit",
  "politician",
  "teenager",
] as const;
export type ModeId = (typeof MODE_IDS)[number];

/** What can be requested: a profile, or auto, which picks a profile from the detected dialect. */
export const MODE_REQUESTS = ["auto", ...MODE_IDS] as const;
export type ModeRequest = (typeof MODE_REQUESTS)[number];

export interface ModeResolution {
  register: string;
  p: number;
  /** True when the dialect was confident enough to pick a profile. */
  used: boolean;
}

export interface Flags {
  /** -Wall: lower every threshold by 0.1 and enable every lexical category. */
  wall: boolean;
  /** -Werror: promote warnings to errors. */
  werror: boolean;
  /** -O2: dead paragraph elimination. */
  o2: boolean;
}

export const DEFAULT_FLAGS: Flags = { wall: false, werror: false, o2: false };

export type Category =
  | "corporate"
  | "passive_aggressive"
  | "urgency"
  | "linkedin"
  | "academic"
  | "reddit"
  | "politician"
  | "teenager"
  | "ai_slop"
  | "filler"
  | "hedge"
  | "deprecated";

export const CATEGORIES: readonly Category[] = [
  "corporate",
  "passive_aggressive",
  "urgency",
  "linkedin",
  "academic",
  "reddit",
  "politician",
  "teenager",
  "ai_slop",
  "filler",
  "hedge",
  "deprecated",
];

/** A span inside one source line. line and col are 1-based. */
export interface Span {
  line: number;
  col: number;
  length: number;
}

export interface Diagnostic {
  code: string;
  level: Level;
  message: string;
  span?: Span;
  /** Text printed under the carets, e.g. `consider: "discuss"`. */
  label?: string;
  notes: string[];
  help: string[];
}

export interface PhraseHit {
  phrase: string;
  category: Category;
  offset: number;
  line: number;
  col: number;
  length: number;
  suggestion?: string;
  since?: number;
}

export interface AcronymHit {
  token: string;
  line: number;
  col: number;
  declared: boolean;
  count: number;
}

/** A paragraph, or a sentence when the input has a single paragraph. */
export interface Unit {
  index: number;
  text: string;
  offset: number;
  line: number;
  col: number;
  endLine: number;
  words: number;
}

export interface Sentence {
  text: string;
  offset: number;
  line: number;
  col: number;
  /** Length on its first line only, so it can be rendered as a span. */
  length: number;
  words: number;
}

export interface Lexed {
  source: string;
  lines: string[];
  paragraphs: Unit[];
  sentences: Sentence[];
  /** What per-unit questions are asked over: paragraphs, or sentences if there is one paragraph. */
  units: Unit[];
  unitKind: "paragraph" | "sentence";
  words: number;
  chars: number;
  hits: PhraseHit[];
  acronyms: AcronymHit[];
  exclamations: number;
  questions: number;
  capsWords: string[];
  emojis: number;
  hashtags: number;
  emDashes: number;
  /** Index of the first unit that opens with a conclusion marker, if any. */
  terminatorUnit: number | null;
  terminatorPhrase: string | null;
}

export interface ChoiceResult {
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

export interface ScoreResult {
  score: number;
  confidence: number;
  probabilities: Record<string, number>;
  legend: Record<string, string>;
}

/** Everything Jev measured, keyed by question id. */
export interface Measurements {
  nouls: Record<string, number>;
  choices: Record<string, ChoiceResult>;
  scores: Record<string, ScoreResult>;
  /** Per-unit "adds new information" probability, aligned with Lexed.units. */
  units: number[];
}

export interface MeasurementRow {
  id: string;
  label: string;
  value: number;
}

export interface ScoreRow {
  id: string;
  label: string;
  score: number;
  max: number;
  legend: string;
}

export interface DistributionRow {
  id: string;
  label: string;
  choice: string;
  confidence: number;
  probabilities: { option: string; p: number }[];
}

export interface Optimized {
  text: string;
  removedUnits: number[];
  unitKind: "paragraph" | "sentence";
  before: number;
  after: number;
  percent: number;
}

export interface Report {
  version: string;
  /** The profile the rules ran with. */
  mode: ModeId;
  /** What was asked for; differs from `mode` only for auto. */
  requested: ModeRequest;
  resolution: ModeResolution | null;
  flags: Flags;
  input: {
    lines: number;
    paragraphs: number;
    sentences: number;
    words: number;
    chars: number;
  };
  model: string;
  questionCount: number;
  usage: { input_tokens: number; output_tokens: number };
  timings: { lex_ms: number; analyze_ms: number; emit_ms: number };
  measurements: MeasurementRow[];
  scores: ScoreRow[];
  distributions: DistributionRow[];
  diagnostics: Diagnostic[];
  counts: { errors: number; warnings: number; notes: number; helps: number };
  severity: number;
  optimized: Optimized | null;
  exitCode: 0 | 1;
}
