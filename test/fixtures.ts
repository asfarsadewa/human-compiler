import { CHOICES, NOULS, SCORES, extrasFor, type Measurements, type ModeRequest } from "../src/engine";

export interface Overrides {
  nouls?: Record<string, number>;
  scores?: Partial<Record<keyof typeof SCORES, number>>;
  choices?: Partial<Record<keyof typeof CHOICES, { choice: string; p: number }>>;
  units?: number[];
}

const DEFAULT_SCORES: Record<keyof typeof SCORES, number> = {
  information_density: 2.5,
  length_excess: 0.5,
  clarity: 0.2,
  hostility: 0.1,
};

const DEFAULT_CHOICES: Record<keyof typeof CHOICES, string> = {
  intent: "inform",
  register: "personal",
  subtext: "none",
};

function spread(options: readonly string[], choice: string, p: number): Record<string, number> {
  const rest = options.length > 1 ? (1 - p) / (options.length - 1) : 0;
  const out: Record<string, number> = {};
  for (const o of options) out[o] = o === choice ? p : rest;
  return out;
}

/** Quiet measurements: every noul low, every score benign. Override what a test needs. */
export function measurements(over: Overrides = {}, mode: ModeRequest = "default"): Measurements {
  const m: Measurements = { nouls: {}, choices: {}, scores: {}, units: over.units ?? [] };
  for (const n of NOULS) m.nouls[n.id] = n.presence ? 0.9 : 0.1;
  m.nouls.contains_request = 0.1;
  for (const x of extrasFor(mode)) m.nouls[x.id] = 0.1;
  Object.assign(m.nouls, over.nouls ?? {});

  for (const [id, spec] of Object.entries(SCORES)) {
    const key = id as keyof typeof SCORES;
    const score = over.scores?.[key] ?? DEFAULT_SCORES[key];
    const max = spec.criteria.length - 1;
    const lo = Math.max(0, Math.min(max, Math.floor(score)));
    const hi = Math.min(max, lo + 1);
    const frac = score - lo;
    const probabilities: Record<string, number> = {};
    const legend: Record<string, string> = {};
    spec.criteria.forEach((c, i) => {
      legend[String(i)] = c;
      probabilities[String(i)] = i === lo ? 1 - frac : i === hi ? frac : 0;
    });
    m.scores[key] = { score, confidence: 0.9, probabilities, legend };
  }

  for (const [id, spec] of Object.entries(CHOICES)) {
    const key = id as keyof typeof CHOICES;
    const options = Object.keys(spec.criteria);
    const o = over.choices?.[key];
    const choice = o?.choice ?? DEFAULT_CHOICES[key];
    const p = o?.p ?? 0.9;
    m.choices[key] = { choice, confidence: p, probabilities: spread(options, choice, p) };
  }
  return m;
}

export const CORPORATE_EMAIL = `Hi team,

Per my last email, I wanted to circle back on the Q3 alignment. Going forward we need to leverage our synergies and make sure everyone has the bandwidth to move the needle.

Let's find a time to touch base ASAP so we can double-click on the deliverables and get alignment on next steps. This is critical.

Thanks in advance,
Dave`;
