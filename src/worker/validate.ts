// Request validation for POST /api/compile. Pure, so it is unit tested.

import { DEFAULT_FLAGS, MODE_REQUESTS, normalize, MAX_INPUT_CHARS, type Flags, type ModeRequest } from "../engine";

export const MAX_TOKEN_CHARS = 2048;
export const MAX_BODY_BYTES = 64 * 1024;

export class ValidationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

export interface CompileRequest {
  text: string;
  mode: ModeRequest;
  flags: Flags;
  token: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function parseFlags(v: unknown): Flags {
  if (v === undefined) return { ...DEFAULT_FLAGS };
  if (!isRecord(v)) throw new ValidationError("flags", "flags must be an object");
  const out: Flags = { ...DEFAULT_FLAGS };
  for (const key of Object.keys(DEFAULT_FLAGS) as (keyof Flags)[]) {
    const val = v[key];
    if (val === undefined) continue;
    if (typeof val !== "boolean") throw new ValidationError("flags", `flags.${key} must be a boolean`);
    out[key] = val;
  }
  return out;
}

export function parseMode(v: unknown): ModeRequest {
  if (v === undefined) return "auto";
  if (typeof v !== "string" || !(MODE_REQUESTS as readonly string[]).includes(v)) {
    throw new ValidationError("mode", `mode must be one of ${MODE_REQUESTS.join(", ")}`);
  }
  return v as ModeRequest;
}

export function parseCompileRequest(body: unknown): CompileRequest {
  if (!isRecord(body)) throw new ValidationError("body", "body must be a JSON object");
  if (typeof body.text !== "string") throw new ValidationError("text", "text must be a string");
  const text = normalize(body.text);
  if (text.length === 0) throw new ValidationError("text", "text is empty");
  if (text.length > MAX_INPUT_CHARS) {
    throw new ValidationError("text", `text must be at most ${MAX_INPUT_CHARS} characters; got ${text.length}`);
  }
  const token = body.token;
  if (typeof token !== "string" || token.length === 0) throw new ValidationError("token", "turnstile token missing");
  if (token.length > MAX_TOKEN_CHARS) throw new ValidationError("token", "turnstile token too long");
  return { text, mode: parseMode(body.mode), flags: parseFlags(body.flags), token };
}
