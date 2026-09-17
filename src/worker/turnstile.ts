// Server-side Turnstile validation. Browser -> this Worker -> siteverify.
// Fails closed on any error.

export const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export interface TurnstileOptions {
  secret: string;
  token: string;
  remoteip?: string;
  expectedAction: string;
  expectedHostnames: ReadonlySet<string>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface TurnstileResult {
  ok: boolean;
  reason?: string;
  hostname?: string;
  /** True when the configured secret is one of Cloudflare's testing keys. */
  testing?: boolean;
}

interface SiteverifyResponse {
  success?: boolean;
  action?: string;
  hostname?: string;
  "error-codes"?: string[];
  metadata?: { result_with_testing_key?: boolean };
}

export function parseHostnames(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  );
}

export async function verifyTurnstile(opts: TurnstileOptions): Promise<TurnstileResult> {
  const { secret, token, remoteip, expectedAction, expectedHostnames } = opts;
  if (typeof token !== "string" || token.length === 0 || token.length > 2048) {
    return { ok: false, reason: "token invalid" };
  }
  if (!secret) return { ok: false, reason: "secret not configured" };
  if (expectedHostnames.size === 0) return { ok: false, reason: "hostnames not configured" };

  const body = new URLSearchParams({ secret, response: token });
  if (remoteip) body.set("remoteip", remoteip);

  let result: SiteverifyResponse;
  try {
    const doFetch = opts.fetchImpl ?? fetch;
    const r = await doFetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
      body,
    });
    if (!r.ok) return { ok: false, reason: `siteverify ${r.status}` };
    result = (await r.json()) as SiteverifyResponse;
  } catch {
    return { ok: false, reason: "siteverify unreachable" };
  }

  if (result.success !== true) {
    const codes = result["error-codes"] ?? [];
    return { ok: false, reason: codes.length ? codes.join(",") : "not verified" };
  }
  const hostname = (result.hostname ?? "").toLowerCase();
  // Cloudflare's testing secrets answer with a fixed hostname and no action. The
  // flag can only be set when the secret itself is a testing key, so this is a
  // configuration state, not something a client can forge.
  if (result.metadata?.result_with_testing_key === true) return { ok: true, hostname, testing: true };
  if (result.action !== expectedAction) return { ok: false, reason: "action mismatch" };
  if (!expectedHostnames.has(hostname)) return { ok: false, reason: "hostname mismatch", hostname };
  return { ok: true, hostname };
}
