// Lexical analysis. Pure, deterministic, and unaware of the model.

import { ACRONYM_ALLOWLIST, LEXICON, TERMINATORS, TRACKED_WORDS, type PhraseEntry } from "./lexicon";
import type { AcronymHit, Lexed, PhraseHit, Sentence, Unit } from "./types";

/** Maximum number of per-unit questions asked of the model. */
export const MAX_UNITS = 24;

/** Normalise line endings and trailing whitespace. Client and server both call this. */
export function normalize(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    .replace(/\s+$/, "");
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}

const WORD_CHAR = "[\\p{L}\\p{N}_]";

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function phrasePattern(entry: PhraseEntry): RegExp {
  if (entry.pattern) {
    const anchored = entry.pattern.startsWith("^") || entry.pattern.endsWith("$");
    return new RegExp(entry.pattern, anchored ? "gimu" : "giu");
  }
  const body = escapeRegex(entry.phrase)
    .replace(/\s+/g, "\\s+")
    .replace(/'/g, "['’]");
  return new RegExp(`(?<!${WORD_CHAR})${body}(?!${WORD_CHAR})`, "giu");
}

interface CompiledEntry {
  entry: PhraseEntry;
  re: RegExp;
}

const COMPILED: readonly CompiledEntry[] = LEXICON.map((entry) => ({ entry, re: phrasePattern(entry) }));

const TRACKED: readonly { word: string; re: RegExp }[] = TRACKED_WORDS.map((word) => ({
  word,
  re: new RegExp(`(?<!${WORD_CHAR})${escapeRegex(word)}(?!${WORD_CHAR})`, "giu"),
}));

const TERMINATOR_RE = new RegExp(
  `^[\\s"'“”‘’(*_\\-#>]*(?:${TERMINATORS.map(escapeRegex).join("|")})(?!${WORD_CHAR})`,
  "iu",
);

export class LineIndex {
  private readonly starts: number[];

  constructor(source: string) {
    this.starts = [0];
    for (let i = 0; i < source.length; i++) {
      if (source.charCodeAt(i) === 10) this.starts.push(i + 1);
    }
  }

  /** 1-based line and column for a character offset. */
  pos(offset: number): { line: number; col: number } {
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, col: offset - this.starts[lo] + 1 };
  }

  /** Absolute offset for a 1-based line and column. */
  offset(line: number, col: number): number {
    const start = this.starts[Math.min(Math.max(line, 1), this.starts.length) - 1];
    return start + Math.max(col, 1) - 1;
  }

  get lineCount(): number {
    return this.starts.length;
  }
}

function splitParagraphs(source: string, index: LineIndex): Unit[] {
  const units: Unit[] = [];
  const sep = /\n[ \t]*\n\s*/g;
  let start = 0;
  let m: RegExpExecArray | null;
  const push = (raw: string, offset: number) => {
    const leading = raw.length - raw.trimStart().length;
    const text = raw.trim();
    if (text === "") return;
    const at = offset + leading;
    const { line, col } = index.pos(at);
    const endLine = index.pos(at + text.length - 1).line;
    units.push({ index: units.length, text, offset: at, line, col, endLine, words: countWords(text) });
  };
  while ((m = sep.exec(source)) !== null) {
    push(source.slice(start, m.index), start);
    start = m.index + m[0].length;
  }
  push(source.slice(start), start);
  return units;
}

const SENTENCE_RE = /[^.!?\n]+(?:[.!?]+["'”’)\]]*|\n|$)|[.!?]+["'”’)\]]*/gu;

function splitSentences(paragraph: Unit, index: LineIndex): Sentence[] {
  const out: Sentence[] = [];
  for (const m of paragraph.text.matchAll(SENTENCE_RE)) {
    const raw = m[0];
    const leading = raw.length - raw.trimStart().length;
    const text = raw.trim();
    if (text === "" || !/[\p{L}\p{N}]/u.test(text)) continue;
    const offset = paragraph.offset + (m.index ?? 0) + leading;
    const { line, col } = index.pos(offset);
    const nl = text.indexOf("\n");
    const length = nl === -1 ? text.length : nl;
    out.push({ text, offset, line, col, length, words: countWords(text) });
  }
  return out;
}

function findHits(source: string, index: LineIndex): PhraseHit[] {
  const raw: PhraseHit[] = [];
  for (const { entry, re } of COMPILED) {
    for (const m of source.matchAll(re)) {
      const offset = m.index ?? 0;
      const matched = m[0];
      const nl = matched.indexOf("\n");
      const length = nl === -1 ? matched.length : nl;
      const { line, col } = index.pos(offset);
      raw.push({
        phrase: entry.phrase,
        category: entry.category,
        offset,
        line,
        col,
        length,
        suggestion: entry.suggestion,
        since: entry.since,
      });
    }
  }
  // Longest match wins; overlapping shorter matches are dropped.
  raw.sort((a, b) => a.offset - b.offset || b.length - a.length || a.phrase.localeCompare(b.phrase));
  const kept: PhraseHit[] = [];
  let end = -1;
  for (const h of raw) {
    if (h.offset >= end) {
      kept.push(h);
      end = h.offset + h.length;
    }
  }
  return kept;
}

const CAPS_RE = /(?<![\p{L}\p{N}])[A-Z]{2,}(?![\p{L}\p{N}])/gu;
const ROMAN_RE = /^[IVXLCDM]+$/;

function findAcronyms(source: string, index: LineIndex): { acronyms: AcronymHit[]; capsWords: string[] } {
  const seen = new Map<string, AcronymHit>();
  const capsWords: string[] = [];
  for (const m of source.matchAll(CAPS_RE)) {
    const token = m[0];
    const allow = ACRONYM_ALLOWLIST.has(token) || ROMAN_RE.test(token);
    if (token.length > 6 || (allow && token.length >= 4)) {
      capsWords.push(token);
      continue;
    }
    if (allow) continue;
    const existing = seen.get(token);
    if (existing) {
      existing.count += 1;
      continue;
    }
    const { line, col } = index.pos(m.index ?? 0);
    const declared = source.includes(`(${token})`) || new RegExp(`${token}\\s*\\(`, "u").test(source);
    seen.set(token, { token, line, col, declared, count: 1 });
  }
  return { acronyms: [...seen.values()], capsWords };
}

function countMatches(source: string, re: RegExp): number {
  let n = 0;
  for (const _ of source.matchAll(re)) n += 1;
  return n;
}

/** Occurrence counts of every lexicon phrase and tracked word, by phrase. */
export function phraseCounts(lexed: Lexed): Map<string, number> {
  const counts = new Map<string, number>();
  for (const h of lexed.hits) counts.set(h.phrase, (counts.get(h.phrase) ?? 0) + 1);
  for (const { word, re } of TRACKED) {
    const n = countMatches(lexed.source, re);
    if (n > 0) counts.set(word, Math.max(counts.get(word) ?? 0, n));
  }
  return counts;
}

export function lex(input: string): Lexed {
  const source = normalize(input);
  const index = new LineIndex(source);
  const lines = source.split("\n");
  const paragraphs = splitParagraphs(source, index);
  const sentences = paragraphs.flatMap((p) => splitSentences(p, index));

  let units: Unit[];
  let unitKind: Lexed["unitKind"];
  if (paragraphs.length >= 2) {
    units = paragraphs;
    unitKind = "paragraph";
  } else {
    unitKind = "sentence";
    units = sentences.map((s, i) => ({
      index: i,
      text: s.text,
      offset: s.offset,
      line: s.line,
      col: s.col,
      endLine: index.pos(s.offset + Math.max(s.text.length - 1, 0)).line,
      words: s.words,
    }));
  }
  units = units.slice(0, MAX_UNITS).map((u, i) => ({ ...u, index: i }));

  let terminatorUnit: number | null = null;
  let terminatorPhrase: string | null = null;
  for (const u of paragraphs) {
    const m = TERMINATOR_RE.exec(u.text);
    if (m) {
      terminatorUnit = u.index;
      terminatorPhrase = m[0].trim().replace(/^[^\p{L}]+/u, "");
      break;
    }
  }

  const { acronyms, capsWords } = findAcronyms(source, index);

  return {
    source,
    lines,
    paragraphs,
    sentences,
    units,
    unitKind,
    words: countWords(source),
    chars: source.length,
    hits: findHits(source, index),
    acronyms,
    exclamations: countMatches(source, /!/g),
    questions: countMatches(source, /\?/g),
    capsWords,
    emojis: countMatches(source, /\p{Extended_Pictographic}/gu),
    hashtags: countMatches(source, /(?<![\p{L}\p{N}&])#[\p{L}][\p{L}\p{N}_]*/gu),
    emDashes: countMatches(source, /—|(?<=\S)\s--\s(?=\S)/g),
    terminatorUnit,
    terminatorPhrase,
  };
}
