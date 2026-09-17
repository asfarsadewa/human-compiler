import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_FLAGS, MAX_INPUT_CHARS, MODE_IDS, VERSION, normalize, type Diagnostic, type Flags, type ModeId } from "../engine";
import { ApiError, compileText, fetchConfig, type CompileResponse, type Config } from "./api";
import { Editor, type EditorHandle, type Highlight } from "./Editor";
import { ManPage } from "./ManPage";
import { Output, type Status } from "./Output";
import { SAMPLE } from "./sample";
import { useTurnstile } from "./turnstile";

const STORAGE_KEY = "human-compiler:v1";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

interface Persisted {
  text: string;
  mode: ModeId;
  flags: Flags;
}

function load(): Persisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Persisted>;
      return {
        text: typeof p.text === "string" ? p.text : "",
        mode: (MODE_IDS as readonly string[]).includes(p.mode ?? "") ? (p.mode as ModeId) : "default",
        flags: { ...DEFAULT_FLAGS, ...(p.flags ?? {}) },
      };
    }
  } catch {
    // storage unavailable
  }
  return { text: "", mode: "default", flags: { ...DEFAULT_FLAGS } };
}

function save(p: Persisted): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    // storage unavailable
  }
}

export function App() {
  const initial = useMemo(load, []);
  const [text, setText] = useState(initial.text);
  const [mode, setMode] = useState<ModeId>(initial.mode);
  const [flags, setFlags] = useState<Flags>(initial.flags);
  const [config, setConfig] = useState<Config | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<CompileResponse | null>(null);
  const [compiledText, setCompiledText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manOpen, setManOpen] = useState(false);

  const editorRef = useRef<EditorHandle>(null);
  const turnstileRef = useRef<HTMLDivElement>(null);
  const turnstile = useTurnstile(config?.siteKey ?? null, turnstileRef);

  useEffect(() => {
    fetchConfig()
      .then(setConfig)
      .catch((e: unknown) => setConfigError(e instanceof Error ? e.message : "configuration failed"));
  }, []);

  useEffect(() => {
    save({ text, mode, flags });
  }, [text, mode, flags]);

  const maxChars = config?.maxChars ?? MAX_INPUT_CHARS;
  const normalized = useMemo(() => normalize(text), [text]);
  const count = normalized.length;
  const over = count > maxChars;
  const stale = result !== null && compiledText !== null && normalized !== compiledText;
  const canCompile = status !== "compiling" && count > 0 && !over && config !== null && turnstile.state !== "error";

  const compile = useCallback(async () => {
    if (!canCompile) return;
    setStatus("compiling");
    setError(null);
    try {
      const token = await turnstile.getToken();
      const res = await compileText({ text: normalized, mode, flags, token });
      setResult(res);
      setCompiledText(normalized);
      setStatus("done");
    } catch (e) {
      const message =
        e instanceof ApiError
          ? e.status === 429
            ? "rate limited; wait a minute"
            : e.message
          : e instanceof Error
            ? e.message
            : "compile failed";
      setError(message);
      setStatus("error");
    } finally {
      turnstile.reset();
    }
  }, [canCompile, turnstile, normalized, mode, flags]);

  const highlights = useMemo<Highlight[]>(() => {
    if (!result || stale) return [];
    return result.report.diagnostics
      .filter((d): d is Diagnostic & { span: NonNullable<Diagnostic["span"]> } => d.span !== undefined)
      .map((d) => ({ ...d.span, level: d.level, title: `${d.level}[${d.code}]: ${d.message}` }));
  }, [result, stale]);

  const jump = (d: Diagnostic) => {
    if (d.span) editorRef.current?.select(d.span.line, d.span.col, d.span.length);
  };

  const toggle = (key: keyof Flags) => setFlags((f) => ({ ...f, [key]: !f[key] }));

  const loadExample = () => {
    setText(SAMPLE);
    setMode("corporate");
    editorRef.current?.focus();
  };

  const verifyState = turnstile.state === "error" ? "verification failed; reload" : configError ? `config: ${configError}` : null;

  return (
    <div className="app">
      <header className="top">
        <h1 className="wordmark">
          human-compiler <span className="ver">v{VERSION}</span>
        </h1>
        <div className="cli" role="group" aria-label="compiler options">
          <label className="opt">
            <span className="flag">--mode</span>
            <select value={mode} onChange={(e) => setMode(e.target.value as ModeId)} aria-label="mode">
              {MODE_IDS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="flag-btn" aria-pressed={flags.wall} onClick={() => toggle("wall")} title="lower every threshold by 0.1">
            -Wall
          </button>
          <button type="button" className="flag-btn" aria-pressed={flags.werror} onClick={() => toggle("werror")} title="warnings become errors">
            -Werror
          </button>
          <button type="button" className="flag-btn" aria-pressed={flags.o2} onClick={() => toggle("o2")} title="dead paragraph elimination">
            -O2
          </button>
          <button type="button" className="flag-btn help-btn" onClick={() => setManOpen(true)}>
            --help
          </button>
        </div>
      </header>

      <main className="panes">
        <section className="pane pane-in" aria-label="input">
          <div className="pane-head">
            <span className="file">input.txt</span>
            <span className={`count${over ? " over" : ""}`}>
              {count} / {maxChars}
            </span>
          </div>
          <Editor ref={editorRef} value={text} onChange={setText} highlights={highlights} disabled={status === "compiling"} onSubmit={compile} />
          <div className="pane-foot">
            <div className="turnstile" ref={turnstileRef} />
            <div className="actions">
              {verifyState ? (
                <span className="verify-state">{verifyState}</span>
              ) : (
                <span className="hint">
                  <kbd>ctrl</kbd>+<kbd>enter</kbd>
                </span>
              )}
              <button type="button" className="compile" onClick={compile} disabled={!canCompile}>
                {status === "compiling" ? "compiling" : "compile"}
              </button>
            </div>
          </div>
        </section>

        <section className="pane pane-out" aria-label="output" aria-live="polite">
          <div className="pane-head">
            <span className="file">stderr</span>
            {result && !stale && (
              <span className={`exit exit-${result.report.exitCode}`}>
                {plural(result.report.counts.errors, "error")}, {plural(result.report.counts.warnings, "warning")}
              </span>
            )}
          </div>
          <Output
            status={status}
            report={result?.report ?? null}
            lines={result?.lines ?? []}
            error={error}
            stale={stale}
            onJump={jump}
            onLoadExample={loadExample}
          />
        </section>
      </main>

      <footer className="bottom">
        <span>
          measurements by <a href="https://typesafe.ai" rel="noreferrer">TypeSafe Jev</a>
        </span>
        <span className="bottom-links">
          <a href="https://github.com/asfarsadewa/human-compiler" rel="noreferrer">source</a>
          <span aria-hidden="true">·</span>
          <span>MIT</span>
          <span aria-hidden="true">·</span>
          <a className="x-link" href="https://x.com/ashthepeasant" rel="noreferrer" aria-label="ashthepeasant on X" title="@ashthepeasant">
            <svg className="x-mark" viewBox="0 0 24 24" width="13" height="13" aria-hidden="true" focusable="false">
              <path
                fill="currentColor"
                d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"
              />
            </svg>
            <span>ashthepeasant</span>
          </a>
        </span>
      </footer>

      <ManPage open={manOpen} onClose={() => setManOpen(false)} maxChars={maxChars} />
    </div>
  );
}
