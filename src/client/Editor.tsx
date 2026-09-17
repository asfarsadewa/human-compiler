import { useImperativeHandle, useMemo, useRef, type ChangeEvent, type Ref } from "react";
import { LineIndex, type Level } from "../engine";

export interface Highlight {
  line: number;
  col: number;
  length: number;
  level: Level;
  title: string;
}

export interface EditorHandle {
  select(line: number, col: number, length: number): void;
  focus(): void;
}

interface Props {
  value: string;
  onChange(value: string): void;
  highlights: Highlight[];
  disabled?: boolean;
  onSubmit?(): void;
  ref?: Ref<EditorHandle>;
}

function groupByLine(highlights: Highlight[]): Map<number, Highlight[]> {
  const map = new Map<number, Highlight[]>();
  for (const h of highlights) {
    const list = map.get(h.line) ?? [];
    list.push(h);
    map.set(h.line, list);
  }
  for (const [line, list] of map) {
    list.sort((a, b) => a.col - b.col || b.length - a.length);
    const kept: Highlight[] = [];
    let end = 0;
    for (const h of list) {
      if (h.col > end) {
        kept.push(h);
        end = h.col + h.length - 1;
      }
    }
    map.set(line, kept);
  }
  return map;
}

function Segments({ text, marks }: { text: string; marks: Highlight[] | undefined }) {
  if (!marks || marks.length === 0) return <>{text || "​"}</>;
  const out: React.ReactNode[] = [];
  let cursor = 0;
  marks.forEach((m, i) => {
    const start = m.col - 1;
    const end = Math.min(text.length, start + m.length);
    if (start > cursor) out.push(text.slice(cursor, start));
    out.push(
      <mark key={i} className={`sq sq-${m.level}`} title={m.title}>
        {text.slice(start, end)}
      </mark>,
    );
    cursor = end;
  });
  if (cursor < text.length) out.push(text.slice(cursor));
  return <>{out}</>;
}

export function Editor({ value, onChange, highlights, disabled, onSubmit, ref }: Props) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const lines = useMemo(() => value.split("\n"), [value]);
  const marks = useMemo(() => groupByLine(highlights), [highlights]);

  useImperativeHandle(ref, () => ({
    focus() {
      taRef.current?.focus();
    },
    select(line, col, length) {
      const ta = taRef.current;
      if (!ta) return;
      const idx = new LineIndex(value);
      const start = idx.offset(line, col);
      ta.focus({ preventScroll: true });
      ta.setSelectionRange(start, start + length);
      const row = bodyRef.current?.querySelector<HTMLElement>(`[data-line="${line}"]`);
      row?.scrollIntoView({ block: "center", behavior: "smooth" });
    },
  }));

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value);

  return (
    <div className="editor" data-empty={value.length === 0 ? "true" : undefined}>
      <div className="editor-body" ref={bodyRef}>
        <div className="hl" aria-hidden="true">
          {lines.map((text, i) => (
            <div className="row" key={i} data-line={i + 1}>
              <span className="ln">{i + 1}</span>
              <span className="src">
                <Segments text={text} marks={marks.get(i + 1)} />
              </span>
            </div>
          ))}
          <div className="row row-pad" aria-hidden="true">
            {"​"}
          </div>
        </div>
        <textarea
          ref={taRef}
          className="ta"
          value={value}
          onChange={handleChange}
          disabled={disabled}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          aria-label="input.txt"
          placeholder="paste text here"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              onSubmit?.();
            }
          }}
        />
      </div>
    </div>
  );
}
