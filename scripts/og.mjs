// Renders public/og.png (1200x630) for link previews. Run with `npm run og`.
// Draws the same design as the app: paper, ink, the mono wordmark, a listing
// panel with green bands, and a compiler snippet with coloured diagnostics.

import { Resvg } from "@resvg/resvg-js";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cache = path.join(root, "node_modules", ".cache", "og-fonts");
const out = path.join(root, "public", "og.png");

const FONTS = [
  ["IBMPlexMono-Regular.ttf", "https://raw.githubusercontent.com/google/fonts/main/ofl/ibmplexmono/IBMPlexMono-Regular.ttf"],
  ["IBMPlexMono-SemiBold.ttf", "https://raw.githubusercontent.com/google/fonts/main/ofl/ibmplexmono/IBMPlexMono-SemiBold.ttf"],
  ["XanhMono-Regular.ttf", "https://raw.githubusercontent.com/google/fonts/main/ofl/xanhmono/XanhMono-Regular.ttf"],
];

async function fonts() {
  await mkdir(cache, { recursive: true });
  const files = [];
  for (const [name, url] of FONTS) {
    const file = path.join(cache, name);
    if (!existsSync(file)) {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`font download failed: ${url} (${r.status})`);
      await writeFile(file, Buffer.from(await r.arrayBuffer()));
    }
    files.push(file);
  }
  return files;
}

const W = 1200;
const H = 630;
const C = {
  paper: "#f3f4f1",
  sheet: "#ffffff",
  ink: "#1b1d1a",
  ink2: "#5b6058",
  ink3: "#8a9086",
  rule: "#d9dcd5",
  rule2: "#eceee9",
  band: "#eef4eb",
  error: "#b42318",
  warning: "#9a6700",
  note: "#175cd3",
};

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Listing geometry. 24px IBM Plex Mono advances 0.6em = 14.4px per character.
const FS = 24;
const CH = FS * 0.6;
const LH = 34;
const PANEL = { x: 72, y: 198, w: 1056, h: 370 };
const TEXT_X = PANEL.x + 24;
const firstBaseline = PANEL.y + 44;
const baseline = (i) => firstBaseline + i * LH;
/** Top of the line box for line i; bands are aligned to these. */
const lineTop = (i) => baseline(i) - 25;

function mono(x, y, text, fill = C.ink, weight = 400) {
  return `<text x="${x}" y="${y}" font-family="IBM Plex Mono" font-size="${FS}" font-weight="${weight}" fill="${fill}" xml:space="preserve">${esc(text)}</text>`;
}

function runs(x, y, parts) {
  const spans = parts
    .map(([text, fill, weight]) => `<tspan fill="${fill ?? C.ink}" font-weight="${weight ?? 400}">${esc(text)}</tspan>`)
    .join("");
  return `<text x="${x}" y="${y}" font-family="IBM Plex Mono" font-size="${FS}" xml:space="preserve">${spans}</text>`;
}

function measurement(i, label, value) {
  const y = baseline(i);
  const barX = TEXT_X + 24 * CH;
  const barW = 150;
  const barH = 12;
  const barY = y - 13;
  return [
    mono(TEXT_X, y, label, C.ink, 500),
    `<rect x="${barX}" y="${barY}" width="${barW}" height="${barH}" fill="${C.rule2}"/>`,
    `<rect x="${barX}" y="${barY}" width="${Math.round(barW * value)}" height="${barH}" fill="${C.ink}"/>`,
    mono(barX + barW + 20, y, value.toFixed(2), C.ink),
  ].join("");
}

function bands() {
  // Three-line bands, like listing paper, aligned to line boxes and clipped to the panel.
  const bandH = LH * 3;
  const bottom = PANEL.y + PANEL.h - 1;
  let s = "";
  for (let line = 0; lineTop(line) < bottom; line += 6) {
    const y = lineTop(line);
    s += `<rect x="${PANEL.x + 1}" y="${y}" width="${PANEL.w - 2}" height="${Math.min(bandH, bottom - y)}" fill="${C.band}"/>`;
  }
  return s;
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${C.paper}"/>
  <text x="72" y="104" font-family="Xanh Mono" font-size="72" fill="${C.ink}" letter-spacing="-1">human-compiler</text>
  <text x="656" y="98" font-family="IBM Plex Mono" font-size="22" fill="${C.ink3}">v0.1.0</text>
  <text x="72" y="154" font-family="IBM Plex Mono" font-size="26" fill="${C.ink2}">A compiler for human language. Paste text, get diagnostics.</text>

  <rect x="${PANEL.x}" y="${PANEL.y}" width="${PANEL.w}" height="${PANEL.h}" fill="${C.sheet}" stroke="${C.rule}"/>
  ${bands()}

  ${mono(TEXT_X, baseline(0), "   Compiling input.txt (--mode auto=corporate)", C.ink2)}
  ${measurement(2, "PASSIVE_AGGRESSION", 0.82)}
  ${measurement(3, "CORPORATE_BULLSHIT", 0.94)}
  ${measurement(4, "ACTUAL_INFORMATION", 0.21)}
  ${runs(TEXT_X, baseline(6), [["warning", C.warning, 600], ["[HC201]", C.ink2, 500], [': "circle back" detected', C.ink, 600]])}
  ${runs(TEXT_X, baseline(7), [["  --> input.txt:3:32", C.note]])}
  ${runs(TEXT_X, baseline(9), [["error", C.error, 600], [": could not compile `input.txt` due to 1 previous error", C.ink, 400]])}

  <text x="72" y="606" font-family="IBM Plex Mono" font-size="22" fill="${C.ink3}">human-compiler.asfarlab.fun</text>
  <text x="1128" y="606" font-family="IBM Plex Mono" font-size="22" fill="${C.ink3}" text-anchor="end">measurements by TypeSafe Jev</text>
</svg>`;

const fontFiles = await fonts();
const resvg = new Resvg(svg, {
  fitTo: { mode: "width", value: W },
  font: { fontFiles, loadSystemFonts: false, defaultFontFamily: "IBM Plex Mono" },
});
const png = resvg.render().asPng();
await writeFile(out, png);
await writeFile(path.join(cache, "og.svg"), svg);
console.log(`wrote ${path.relative(root, out)} (${png.length} bytes)`);
