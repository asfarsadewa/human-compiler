import { describe, expect, it } from "vitest";
import { MAX_INPUT_CHARS } from "../src/engine";
import { parseHostnames, verifyTurnstile } from "../src/worker/turnstile";
import { ValidationError, parseCompileRequest, parseFlags, parseMode } from "../src/worker/validate";

describe("parseCompileRequest", () => {
  it("accepts a minimal valid body with defaults", () => {
    const r = parseCompileRequest({ text: "hello\r\n", token: "t" });
    expect(r).toEqual({ text: "hello", mode: "default", flags: { wall: false, werror: false, o2: false }, token: "t" });
  });

  it("enforces the character limit after normalisation", () => {
    const ok = "a".repeat(MAX_INPUT_CHARS) + "\n\n";
    expect(parseCompileRequest({ text: ok, token: "t" }).text).toHaveLength(MAX_INPUT_CHARS);
    expect(() => parseCompileRequest({ text: "a".repeat(MAX_INPUT_CHARS + 1), token: "t" })).toThrow(ValidationError);
    expect(() => parseCompileRequest({ text: "   ", token: "t" })).toThrow(/empty/);
  });

  it("rejects bad shapes", () => {
    expect(() => parseCompileRequest(null)).toThrow(/JSON object/);
    expect(() => parseCompileRequest({ text: 5, token: "t" })).toThrow(/string/);
    expect(() => parseCompileRequest({ text: "x" })).toThrow(/token/);
    expect(() => parseCompileRequest({ text: "x", token: "y".repeat(3000) })).toThrow(/too long/);
    expect(() => parseCompileRequest({ text: "x", token: "t", mode: "pirate" })).toThrow(/mode/);
    expect(() => parseCompileRequest({ text: "x", token: "t", flags: { wall: "yes" } })).toThrow(/boolean/);
  });

  it("parses modes and flags", () => {
    expect(parseMode("teenager")).toBe("teenager");
    expect(parseMode(undefined)).toBe("default");
    expect(parseFlags({ werror: true })).toEqual({ wall: false, werror: true, o2: false });
    expect(parseFlags(undefined)).toEqual({ wall: false, werror: false, o2: false });
  });
});

describe("parseHostnames", () => {
  it("splits, trims and lowercases", () => {
    expect([...parseHostnames(" Example.com, localhost ,")]).toEqual(["example.com", "localhost"]);
    expect(parseHostnames(undefined).size).toBe(0);
  });
});

describe("verifyTurnstile", () => {
  const hosts = new Set(["example.com"]);
  const respond = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status });
  const base = { secret: "s", token: "tok", expectedAction: "compile", expectedHostnames: hosts };

  it("passes when success, action and hostname all match", async () => {
    const r = await verifyTurnstile({ ...base, fetchImpl: respond({ success: true, action: "compile", hostname: "example.com" }) });
    expect(r).toEqual({ ok: true, hostname: "example.com" });
  });

  it("fails closed on mismatches and errors", async () => {
    expect((await verifyTurnstile({ ...base, fetchImpl: respond({ success: true, action: "login", hostname: "example.com" }) })).reason).toBe("action mismatch");
    expect((await verifyTurnstile({ ...base, fetchImpl: respond({ success: true, action: "compile", hostname: "evil.com" }) })).reason).toBe("hostname mismatch");
    expect((await verifyTurnstile({ ...base, fetchImpl: respond({ success: false, "error-codes": ["timeout-or-duplicate"] }) })).reason).toBe("timeout-or-duplicate");
    expect((await verifyTurnstile({ ...base, fetchImpl: respond({}, 500) })).reason).toBe("siteverify 500");
    expect((await verifyTurnstile({ ...base, fetchImpl: async () => { throw new Error("boom"); } })).reason).toBe("siteverify unreachable");
    expect((await verifyTurnstile({ ...base, token: "" })).reason).toBe("token invalid");
    expect((await verifyTurnstile({ ...base, secret: "" })).reason).toBe("secret not configured");
    expect((await verifyTurnstile({ ...base, expectedHostnames: new Set() })).reason).toBe("hostnames not configured");
  });

  it("accepts a testing-key result without action or hostname checks", async () => {
    const r = await verifyTurnstile({
      ...base,
      fetchImpl: respond({ success: true, hostname: "example.com", metadata: { result_with_testing_key: true } }),
    });
    expect(r).toEqual({ ok: true, hostname: "example.com", testing: true });
    const real = await verifyTurnstile({ ...base, fetchImpl: respond({ success: true, hostname: "example.com", metadata: {} }) });
    expect(real.ok).toBe(false);
  });

  it("sends the secret, token and ip as a form body", async () => {
    let seen: URLSearchParams | undefined;
    await verifyTurnstile({
      ...base,
      remoteip: "1.2.3.4",
      fetchImpl: async (_url, init) => {
        seen = init?.body as URLSearchParams;
        return new Response(JSON.stringify({ success: true, action: "compile", hostname: "example.com" }));
      },
    });
    expect(seen?.get("secret")).toBe("s");
    expect(seen?.get("response")).toBe("tok");
    expect(seen?.get("remoteip")).toBe("1.2.3.4");
  });
});
