import type { Flags, ModeRequest, Report } from "../engine";

export interface Config {
  siteKey: string;
  maxChars: number;
  version: string;
  model: string;
}

export interface CompileResponse {
  report: Report;
  lines: string[];
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function parse<T>(r: Response): Promise<T> {
  const data: unknown = await r.json().catch(() => null);
  if (!r.ok) {
    const err = (data as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(r.status, err?.code ?? "http", err?.message ?? `request failed (${r.status})`);
  }
  return data as T;
}

export async function fetchConfig(): Promise<Config> {
  return parse<Config>(await fetch("/api/config", { headers: { Accept: "application/json" } }));
}

export async function compileText(body: { text: string; mode: ModeRequest; flags: Flags; token: string }): Promise<CompileResponse> {
  return parse<CompileResponse>(
    await fetch("/api/compile", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    }),
  );
}
