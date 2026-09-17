import { useState } from "react";
import { FILENAME, headerLines, optimizedLine, renderText, spanBlock, summaryLine, type Diagnostic, type Report } from "../engine";

export type Status = "idle" | "compiling" | "done" | "error";

interface Props {
  status: Status;
  report: Report | null;
  lines: string[];
  error: string | null;
  stale: boolean;
  onJump(d: Diagnostic): void;
  onLoadExample(): void;
}

const SOURCE_WIDTH = 80;

function Diag({ d, lines, onJump }: { d: Diagnostic; lines: string[]; onJump(d: Diagnostic): void }) {
  const block = spanBlock(d, lines, FILENAME, SOURCE_WIDTH);
  const pad = d.span ? " ".repeat(String(d.span.line).length) : " ";
  return (
    <article className={`diag diag-${d.level}`}>
      <header className="diag-head">
        <span className="lvl">{d.level}</span>
        <span className="code">[{d.code}]</span>: {d.message}
      </header>
      {block && d.span ? (
        <pre className="diag-span">
          <button type="button" className="arrow" onClick={() => onJump(d)} title="show in input">
            {block.arrow}
          </button>
          {"\n"}
          {block.gutter}
          {"\n"}
          {block.source}
          {"\n"}
          <span className="carets">{block.carets}</span>
          {d.notes.length || d.help.length ? `\n${block.gutter}` : ""}
          {d.notes.map((n, i) => (
            <span key={`n${i}`}>
              {"\n"}
              {pad} = <b>note</b>: {n}
            </span>
          ))}
          {d.help.map((h, i) => (
            <span key={`h${i}`}>
              {"\n"}
              {pad} = <b>help</b>: {h}
            </span>
          ))}
        </pre>
      ) : (
        (d.notes.length > 0 || d.help.length > 0) && (
          <pre className="diag-span">
            {d.notes.map((n, i) => (
              <span key={`n${i}`}>
                {i > 0 ? "\n" : ""}  = <b>note</b>: {n}
              </span>
            ))}
            {d.help.map((h, i) => (
              <span key={`h${i}`}>
                {d.notes.length > 0 || i > 0 ? "\n" : ""}  = <b>help</b>: {h}
              </span>
            ))}
          </pre>
        )
      )}
    </article>
  );
}

export function Output({ status, report, lines, error, stale, onJump, onLoadExample }: Props) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(renderText(report, lines));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  if (status === "idle" && !report) {
    return (
      <div className="listing plain empty">
        <p>no input.</p>
        <p>
          paste text on the left, then compile.{" "}
          <button type="button" className="link" onClick={onLoadExample}>
            load an example
          </button>
        </p>
      </div>
    );
  }

  if (status === "compiling") {
    return (
      <div className="listing plain">
        <pre className="log">
          {`   Compiling ${FILENAME}\n      Lexing\n   Analyzing `}
          <span className="cursor" aria-hidden="true" />
        </pre>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="listing plain">
        <pre className="log">
          <span className="lvl-error">error</span>: {error ?? "compile failed"}
          {"\n"}
          {`exit code: 2`}
        </pre>
      </div>
    );
  }

  if (!report) return null;

  const [h1, h2, h3] = headerLines(report);
  const labelWidth = Math.max(...report.measurements.map((m) => m.label.length), 20);
  const opt = optimizedLine(report);

  return (
    <div className={`listing${stale ? " stale" : ""}`}>
      <div className="listing-tools">
        {stale && <span className="stale-note">input changed since this compile</span>}
        <button type="button" className="tool" onClick={copy}>
          {copied ? "copied" : "copy as text"}
        </button>
      </div>

      <pre className="log">
        {h1}
        {"\n"}
        {h2}
        {"\n"}
        {h3}
      </pre>

      <table className="measure">
        <tbody>
          {report.measurements.map((m) => (
            <tr key={m.id}>
              <th scope="row">{m.label}</th>
              <td className="bar-cell">
                <span className="bar" aria-hidden="true">
                  <i style={{ width: `${Math.round(m.value * 100)}%` }} />
                </span>
              </td>
              <td className="num">{m.value.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <table className="scores">
        <tbody>
          {report.scores.map((s) => (
            <tr key={s.id}>
              <th scope="row">{s.label}</th>
              <td className="num">
                {s.score.toFixed(1)} / {s.max}
              </td>
              <td className="legend">{s.legend.toLowerCase()}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="dists">
        {report.distributions.map((d) => (
          <table className="dist" key={d.id}>
            <caption>{d.label}</caption>
            <tbody>
              {d.probabilities.map((p) => (
                <tr key={p.option} className={p.option === d.choice ? "chosen" : undefined}>
                  <th scope="row">{p.option}</th>
                  <td className="num">{p.p.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>

      <div className="diags">
        {report.diagnostics.map((d, i) => (
          <Diag key={`${d.code}-${i}`} d={d} lines={lines} onJump={onJump} />
        ))}
      </div>

      {opt && report.optimized && (
        <section className="opt">
          <pre className="log">{opt}</pre>
          {report.optimized.text ? <pre className="opt-text">{report.optimized.text}</pre> : <pre className="log">(nothing survives)</pre>}
        </section>
      )}

      <pre className={`log summary exit-${report.exitCode}`}>
        {`severity: ${report.severity.toFixed(1)} / 10`}
        {"\n"}
        <span className={report.counts.errors > 0 ? "lvl-error" : report.counts.warnings > 0 ? "lvl-warning" : "lvl-help"}>
          {summaryLine(report)}
        </span>
        {"\n"}
        {`exit code: ${report.exitCode}`}
      </pre>
      <div className="spacer" style={{ width: labelWidth }} aria-hidden="true" />
    </div>
  );
}
