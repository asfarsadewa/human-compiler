import { useEffect, useRef } from "react";
import { MODES, VERSION, allRules } from "../engine";

interface Props {
  open: boolean;
  onClose(): void;
  maxChars: number;
}

const FLAGS = [
  ["--mode <name>", "Lint profile. Changes thresholds, which phrase categories fire, and adds mode-specific questions."],
  ["-Wall", "Lower every threshold by 0.1 and enable phrase categories the mode turned off."],
  ["-Werror", "Treat warnings as errors. Notes and help are unaffected."],
  ["-O2", "Dead paragraph elimination. Removes paragraphs that add no information, and anything after a conclusion."],
] as const;

export function ManPage({ open, onClose, maxChars }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const rules = allRules();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="man"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="man-body">
        <header className="man-head">
          <span>HUMAN-COMPILER(1)</span>
          <span>User Commands</span>
          <span>HUMAN-COMPILER(1)</span>
        </header>

        <h2>NAME</h2>
        <p>human-compiler - compile human language into diagnostics</p>

        <h2>SYNOPSIS</h2>
        <p>
          <b>human-compiler</b> [<b>--mode</b> <i>name</i>] [<b>-Wall</b>] [<b>-Werror</b>] [<b>-O2</b>] <i>input.txt</i>
        </p>

        <h2>DESCRIPTION</h2>
        <p>
          Reads up to {maxChars} characters of text. A lexer finds phrases, acronyms, paragraphs and sentences in code. A
          System One model (TypeSafe Jev) answers a fixed set of yes/no, choice and score questions about the text and
          returns probabilities, not prose. Rules in code compare those probabilities to thresholds and emit diagnostics.
          The same measurements always produce the same output.
        </p>
        <p>Exit code is 1 when any error is emitted, otherwise 0.</p>

        <h2>MODES</h2>
        <dl>
          {Object.values(MODES).map((m) => (
            <div key={m.id}>
              <dt>--mode {m.id}</dt>
              <dd>{m.description}</dd>
            </div>
          ))}
        </dl>

        <h2>FLAGS</h2>
        <dl>
          {FLAGS.map(([flag, text]) => (
            <div key={flag}>
              <dt>{flag}</dt>
              <dd>{text}</dd>
            </div>
          ))}
        </dl>

        <h2>DIAGNOSTICS</h2>
        <p>Default levels are shown. Modes and flags can change them or turn a rule off.</p>
        <table className="man-rules">
          <thead>
            <tr>
              <th>code</th>
              <th>level</th>
              <th>summary</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.code}>
                <td>{r.code}</td>
                <td className={`lvl-${r.level}`}>{r.level}</td>
                <td>{r.summary}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2>NOTES</h2>
        <p>
          Measurements are calibrated probabilities, not facts. Thresholds are opinions. Nothing you paste is stored.
        </p>

        <footer className="man-foot">
          <span>human-compiler {VERSION}</span>
          <button type="button" className="tool" onClick={onClose}>
            q
          </button>
        </footer>
      </div>
    </dialog>
  );
}
