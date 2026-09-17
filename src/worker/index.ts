// Worker entry. Serves /api/*; everything else is a static asset.

import { APIConnectionError, APIError, TypeSafeClient, type Questions, type SystemOneResult } from "@typesafe-ai/sdk";
import { MAX_INPUT_CHARS, UNIT_PREFIX, VERSION, buildQuestions, compile, getMode, lex, type Measurements } from "../engine";
import { parseHostnames, verifyTurnstile } from "./turnstile";
import { MAX_BODY_BYTES, ValidationError, parseCompileRequest } from "./validate";

export const MODEL = "jev-latest";
export const TURNSTILE_ACTION = "compile";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function json(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...extra } });
}

function fail(status: number, code: string, message: string, extra: Record<string, string> = {}): Response {
  return json({ error: { code, message } }, status, extra);
}

function log(level: "info" | "warn" | "error", event: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ event, ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/** Maps typed answers onto the engine's measurement shape. */
export function toMeasurements(answers: SystemOneResult<Questions>["answers"], unitCount: number): Measurements {
  const m: Measurements = { nouls: {}, choices: {}, scores: {}, units: new Array<number>(unitCount).fill(0) };
  for (const [id, a] of Object.entries(answers)) {
    if (a.type === "noul") {
      if (id.startsWith(UNIT_PREFIX)) {
        const i = Number(id.slice(UNIT_PREFIX.length));
        if (Number.isInteger(i) && i >= 0 && i < unitCount) m.units[i] = a.noul;
      } else {
        m.nouls[id] = a.noul;
      }
    } else if (a.type === "choice") {
      m.choices[id] = { choice: a.choice, confidence: a.confidence, probabilities: { ...a.probabilities } };
    } else if (a.type === "score") {
      m.scores[id] = {
        score: a.score,
        confidence: a.confidence,
        probabilities: { ...(a.probabilities as Record<string, number>) },
        legend: { ...(a.legend as Record<string, string>) },
      };
    }
  }
  return m;
}

async function handleCompile(request: Request, env: Env): Promise<Response> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) return fail(413, "too_large", "request body too large");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, "bad_json", "body must be JSON");
  }

  let req;
  try {
    req = parseCompileRequest(body);
  } catch (e) {
    if (e instanceof ValidationError) return fail(400, e.code, e.message);
    throw e;
  }

  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const { success } = await env.COMPILE_LIMITER.limit({ key: ip });
  if (!success) return fail(429, "rate_limited", "too many compiles; try again in a minute", { "Retry-After": "60" });

  const turnstile = await verifyTurnstile({
    secret: env.TURNSTILE_SECRET,
    token: req.token,
    remoteip: ip === "unknown" ? undefined : ip,
    expectedAction: TURNSTILE_ACTION,
    expectedHostnames: parseHostnames(env.TURNSTILE_HOSTNAMES),
  });
  if (!turnstile.ok) {
    log("warn", "turnstile_rejected", { reason: turnstile.reason, hostname: turnstile.hostname });
    return fail(403, "turnstile", `verification failed: ${turnstile.reason ?? "unknown"}`);
  }
  if (turnstile.testing) log("warn", "turnstile_testing_key", { hostname: turnstile.hostname });

  const mode = getMode(req.mode);
  const t0 = performance.now();
  const lexed = lex(req.text);
  const built = buildQuestions(lexed, mode);
  const lexMs = performance.now() - t0;

  const client = new TypeSafeClient({
    apiKey: env.TYPESAFE_API_KEY,
    timeout: 15_000,
    retry: { maxRetries: 1 },
    logLevel: "warn",
  });

  const t1 = performance.now();
  let result: SystemOneResult<Questions>;
  try {
    result = await client.systemOne({ state: built.state, questions: built.questions, model: MODEL });
  } catch (e) {
    if (e instanceof APIError) {
      log("error", "typesafe_api_error", { status: e.status, requestId: e.requestId });
      if (e.status === 429 || e.status === 529 || e.status >= 500) {
        return fail(503, "model_busy", "the model is busy; try again shortly", { "Retry-After": "10" });
      }
      return fail(502, "model_error", `model request failed (${e.status})`);
    }
    if (e instanceof APIConnectionError) {
      log("error", "typesafe_unreachable", { message: e.message });
      return fail(504, "model_timeout", "the model did not answer in time");
    }
    throw e;
  }
  const analyzeMs = performance.now() - t1;

  const t2 = performance.now();
  const measurements = toMeasurements(result.answers, lexed.units.length);
  const report = compile({
    lexed,
    measurements,
    mode,
    flags: req.flags,
    model: result.model,
    questionCount: built.count,
    usage: result.usage,
    timings: { lex_ms: lexMs, analyze_ms: analyzeMs },
  });
  report.timings.emit_ms = performance.now() - t2;

  log("info", "compiled", {
    mode: mode.id,
    chars: lexed.chars,
    questions: built.count,
    tokens: result.usage.input_tokens + result.usage.output_tokens,
    analyze_ms: Math.round(analyzeMs),
    errors: report.counts.errors,
    warnings: report.counts.warnings,
  });

  return json({ report, lines: lexed.lines });
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/health") return json({ ok: true, version: VERSION });
      if (url.pathname === "/api/config") {
        return json({ siteKey: env.TURNSTILE_SITE_KEY, maxChars: MAX_INPUT_CHARS, version: VERSION, model: MODEL });
      }
      if (url.pathname === "/api/compile") {
        if (request.method !== "POST") return fail(405, "method_not_allowed", "POST only", { Allow: "POST" });
        return await handleCompile(request, env);
      }
      if (url.pathname.startsWith("/api/")) return fail(404, "not_found", "no such endpoint");
      return env.ASSETS.fetch(request);
    } catch (e) {
      log("error", "unhandled", { message: e instanceof Error ? e.message : String(e) });
      return fail(500, "internal", "internal error");
    }
  },
} satisfies ExportedHandler<Env>;
