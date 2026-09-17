# human-compiler

A compiler for human language. Paste an email, a Slack message, a LinkedIn post, a PR comment, or a memo. Get diagnostics.

```
   Compiling input.txt (--mode corporate)
      Lexing   0.4ms  4 paragraphs, 7 sentences, 62 words
   Analyzing   812ms  jev-1.13.0, 45 questions, 1203 tokens

PASSIVE_AGGRESSION      ████████░░  0.82
CORPORATE_BULLSHIT      █████████░  0.94
ACTUAL_INFORMATION      ██░░░░░░░░  0.21
UNNECESSARY_URGENCY     ███████░░░  0.72
MEETING_COULD_BE_EMAIL  █████████░  0.89

error[HC003]: NullMeaningException: no recoverable information in 62 words
  = note: actual_information = 0.21, threshold 0.25

warning[HC201]: "circle back" detected
  --> input.txt:3:32
  |
3 | Per my last email, I wanted to circle back on the Q3 alignment.
  |                                ^^^^^^^^^^^ consider: "follow up"
  |
  = note: category: corporate

severity: 7.9 / 10
error: could not compile `input.txt` due to 1 previous error; 9 warnings emitted
exit code: 1
```

Live: https://human-compiler.asfarlab.fun

## How it works

The joke only works if the compiler is real. So it is.

1. **Lexer** (`src/engine/lexer.ts`). Code splits the input into lines, paragraphs and sentences, finds phrases from a lexicon with line and column positions, counts acronyms, capitals, emoji, hashtags and em dashes, and spots conclusion markers. No model involved.
2. **Semantic analysis** (`src/engine/questions.ts`). One request to [TypeSafe](https://typesafe.ai)'s System One model, Jev, with the text as state and a fixed set of typed questions: about thirty yes/no questions (Nouls), three Choices (intent, dialect, subtext), four Scores (information density, length excess, clarity, hostility), plus one Noul per paragraph asking whether it adds anything. Jev returns probabilities, not prose.
3. **Rules** (`src/engine/rules.ts`). Code compares each measurement to a threshold and emits diagnostics with codes, levels, spans, notes and help. Modes change thresholds and levels. Flags change them again.
4. **Emit** (`src/engine/render.ts`). The report is rendered rustc-style in the browser and as plain text for copying.

Because the model supplies measurements and the code decides what fires, the same measurements always produce the same diagnostics. That part is covered by the test suite.

### Modes

`--mode auto | default | corporate | manager | linkedin | academic | reddit | politician | teenager`

A mode is a lint profile: which phrase categories fire, at what level, with which thresholds, plus three mode-specific questions. `teenager` treats corporate phrases as errors. `academic` treats undeclared acronyms as errors. `reddit` expects sarcasm.

`auto` is the default. It asks every mode's questions in the same request (they run in parallel and cost only tokens), then picks the profile from the `dialect` answer and consumes only that profile's answers. The choice is reported as `HC034`, with the probability that drove it. Below 0.50 it falls back to `default`.

### Flags

- `-Wall` lowers every threshold by 0.1 and enables categories the mode turned off.
- `-Werror` promotes warnings to errors.
- `-O2` dead paragraph elimination: removes paragraphs that add no information, and anything after "in conclusion".

### Diagnostics

Codes are stable. `HC0xx` are semantic thresholds, `HC1xx` structural, `HC2xx` lexical, `HC3xx` mode-specific. The full table is on the `--help` page in the app, generated from the rule catalogue.

## Stack

- Cloudflare Workers with static assets, via `@cloudflare/vite-plugin`
- React 19, Vite, TypeScript
- `@typesafe-ai/sdk` for the model call
- Cloudflare Turnstile in front of `/api/compile`, plus a per-IP rate limit binding
- Vitest for the engine and the Worker's pure helpers

The API key never reaches the browser. The browser calls `/api/compile`; the Worker verifies the Turnstile token, calls Jev, runs the rules, and returns the report.

## Development

```bash
npm install
cp .dev.vars.example .dev.vars   # then put your TYPESAFE_API_KEY in it
npm run dev                      # http://localhost:5173
npm test
npm run typecheck
```

`.dev.vars` uses Cloudflare's always-pass Turnstile test keys, so the widget verifies locally without a real site key.

## Deploy

```bash
npx wrangler secret put TYPESAFE_API_KEY
npx wrangler secret put TURNSTILE_SECRET
npm run deploy
```

`wrangler.jsonc` holds the public Turnstile site key, the hostname allowlist for siteverify, the custom domain, and the rate limit. Create a Turnstile widget for your hostname in the Cloudflare dashboard, put its site key in `vars.TURNSTILE_SITE_KEY`, and its secret in the `TURNSTILE_SECRET` secret.

## Limits

- 4000 characters of input.
- 24 paragraphs (or sentences, when there is one paragraph) get per-unit questions.
- 20 compiles per minute per IP.

## License

MIT. Measurements are calibrated probabilities. Thresholds are opinions.
