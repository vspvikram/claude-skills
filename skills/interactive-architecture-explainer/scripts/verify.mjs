#!/usr/bin/env node
// Verify an explorer page: render it in headless Chrome, click through every scenario step and every box,
// check overlaps, overflow, keyboard, motion and console errors, and save screenshots.
//
// Usage:  node verify.mjs <page.html> <out-dir> [--width=1440] [--height=1000]
//   <page.html>  the Artifact fragment (no doctype/html/head/body), e.g. your copy of template/explorer.html
//   <out-dir>    a scratch folder, never the user's repo. Gets test.html, shots/*.png and chrome-profile/.
// Needs Node 22+ (built-in WebSocket and fetch) and Chrome or Chromium. Set CHROME=/path/to/chrome if not found.
// Relies on the template's ids (#arch, #explorer, #btn-next, #btn-back, .sc[data-sc], #node-<id>, #node-name,
// #step-count, .panel) and on window.__explorer, which the template exposes only on file:// pages.
// Exit code: 0 no issues, 1 issues found, 2 could not run.

import { spawn, execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const argv = process.argv.slice(2);
const opt = Object.fromEntries(argv.filter(a => a.startsWith("--")).map(a => { const [k, v] = a.slice(2).split("="); return [k, v ?? "1"]; }));
const [src, outArg] = argv.filter(a => !a.startsWith("--"));
if (!src || !outArg) { console.error("Usage: node verify.mjs <page.html> <out-dir> [--width=1440] [--height=1000]"); process.exit(2); }
const OUT = resolve(outArg), SHOTS = join(OUT, "shots"), PROFILE = join(OUT, "chrome-profile");
const WIDTH = Number(opt.width || 1440), HEIGHT = Number(opt.height || 1000);
mkdirSync(SHOTS, { recursive: true });

/* ---------- 1. Static contract checks on the fragment ---------- */
const fragment = readFileSync(resolve(src), "utf8");
function contractIssues(s) {
  const out = [];
  const title = (s.slice(0, 8192).match(/<title>([^<]*)<\/title>/i) || [])[1];
  if (!title || !title.trim()) out.push("no <title> in the first 8KB");
  else if (title.trim().split(/\s+/).length > 5 || /[:|—–]/.test(title)) out.push(`title "${title}" reads like a caption; use a 2–4 word name`);
  if (/<!doctype|<html[\s>]|<head[\s>]|<body[\s>]/i.test(s)) out.push("has its own doctype/html/head/body; an Artifact is a fragment");
  const okScript = /^https:\/\/(cdnjs\.cloudflare\.com\/|cdn\.jsdelivr\.net\/npm\/|unpkg\.com\/|cdn\.tailwindcss\.com|code\.jquery\.com\/)/;
  for (const m of s.matchAll(/<script[^>]*\ssrc=["']([^"']+)["']/gi)) if (!okScript.test(m[1])) out.push("script from a blocked host: " + m[1]);
  for (const m of s.matchAll(/<link[^>]*\shref=["'](https?:[^"']+)["'][^>]*>/gi)) if (/stylesheet/i.test(m[0]) && !/^https:\/\/fonts\.googleapis\.com\//.test(m[1])) out.push("stylesheet from a blocked host: " + m[1]);
  for (const m of s.matchAll(/@import\s+url\(\s*["']?([^"')]+)/gi)) if (!/^https:\/\/fonts\.googleapis\.com\//.test(m[1])) out.push("@import from a blocked host: " + m[1]);
  for (const m of s.matchAll(/<(img|video|audio|source|iframe)[^>]*\ssrc=["'](https?:[^"']+)["']/gi)) out.push(`<${m[1]}> from another host is blocked: ${m[2]}`);
  const js = [...s.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]).join("\n");
  if (/\b(alert|confirm|prompt)\s*\(/.test(js)) out.push("uses alert/confirm/prompt, which the Artifact viewer never shows");
  if (/\bfetch\s*\(\s*["'`]https?:/.test(js)) out.push("fetches from another host, which the Artifact CSP blocks");
  if (/\.style\.display\s*=/.test(js)) out.push("sets style.display; toggle el.hidden instead (the skeleton forces [hidden] to display:none)");
  if (!/prefers-reduced-motion/.test(s)) out.push("no prefers-reduced-motion handling");
  return out;
}

/* ---------- 2. Wrap it like the Artifact publisher does ---------- */
const SKELETON = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">' +
  '<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif;background:#fafafa}img{max-width:100%}[hidden]{display:none!important}</style></head><body>';
const TEST = join(OUT, "test.html");
writeFileSync(TEST, /^\s*<!doctype/i.test(fragment) ? fragment : SKELETON + fragment + "</body></html>");
const PAGE = pathToFileURL(TEST).href;

/* ---------- 3. Checks that run inside the page (serialized with toString, so no outside variables) ---------- */
// The data itself: every reference resolves, every field the panel shows is filled, the text budget holds.
function checkData() {
  const X = window.__explorer, out = [], words = t => String(t || "").trim().split(/\s+/).filter(Boolean).length;
  const regions = X.REGIONS || [], lanes = X.LANE_NAME || {};
  for (const [id, n] of Object.entries(X.NODES)) {
    if (!["comp", "store", "ext"].includes(n.kind)) out.push(`box ${id}: kind "${n.kind}" should be comp, store or ext`);
    if (!["built", "changing", "new"].includes(n.status)) out.push(`box ${id}: status "${n.status}" should be built, changing or new`);
    if (!lanes[n.lane]) out.push(`box ${id}: lane "${n.lane}" is missing from LANE_NAME`);
    for (const f of ["name", "what", "holds", "who", "statusText"]) if (!n[f]) out.push(`box ${id}: ${f} is empty`);
    for (const f of ["x", "y", "w", "h"]) if (typeof n[f] !== "number") out.push(`box ${id}: ${f} must be a number`);
    const r = regions.find(q => q.id === n.lane);
    if (!r) out.push(`box ${id}: no region with id "${n.lane}"`);
    else if (n.x < r.x || n.y < r.y || n.x + n.w > r.x + r.w || n.y + n.h > r.y + r.h) out.push(`box ${id} sticks out of its region "${r.id}"`);
  }
  const n = Object.keys(X.NODES).length;
  if (n > 18) out.push(`${n} boxes: past about 16 the overview stops reading at a glance; merge some`);
  const ids = new Set();
  X.EDGES.forEach(e => {
    if (ids.has(e.id)) out.push(`line ${e.id}: the id is used twice`); ids.add(e.id);
    for (const end of ["a", "b"]) if (!X.NODES[e[end]]) out.push(`line ${e.id}: ${end} = "${e[end]}" is not a box`);
    if (!e.label) out.push(`line ${e.id}: no label`);
    else if (/^(uses?|calls?|data|talks to|connects?( to)?|sends?|reads?|writes?)$/i.test(e.label.trim())) out.push(`line ${e.id}: label "${e.label}" is vague; say what moves`);
    if (e.route && !["h", "over", "side"].includes(e.route)) out.push(`line ${e.id}: unknown route "${e.route}"`);
  });
  const scs = Object.entries(X.SCENARIOS);
  if (scs.length > 7) out.push(`${scs.length} scenarios: keep the 3–7 that answer the reviewer's questions`);
  for (const [sid, sc] of scs) {
    if (!sc.steps || !sc.steps.length) { out.push(`scenario ${sid}: no steps`); continue; }
    if (sc.steps.length > 7) out.push(`scenario ${sid}: ${sc.steps.length} steps; split it, 3–7 reads best`);
    for (const f of ["name", "tag", "title"]) if (!sc[f]) out.push(`scenario ${sid}: ${f} is empty`);
    if (!lanes[sc.lane]) out.push(`scenario ${sid}: lane "${sc.lane}" is missing from LANE_NAME`);
    sc.steps.forEach((s, i) => {
      const at = `scenario ${sid}, step ${i + 1}`;
      for (const f of ["title", "text", "example"]) if (!s[f]) out.push(`${at}: ${f} is empty`);
      (s.edges || []).forEach(([id, dir]) => {
        if (!ids.has(id)) out.push(`${at}: line "${id}" does not exist`);
        if (!["f", "r", "b"].includes(dir)) out.push(`${at}: direction "${dir}" should be f, r or b`);
      });
      (s.io || []).forEach(([, id]) => { if (!X.NODES[id]) out.push(`${at}: io names "${id}", which is not a box`); });
      (s.nodes || []).forEach(id => { if (!X.NODES[id]) out.push(`${at}: nodes names "${id}", which is not a box`); });
      if (!(s.edges || []).length && !(s.nodes || []).length) out.push(`${at}: lights nothing; give it edges or nodes`);
      if (s.lane && !lanes[s.lane]) out.push(`${at}: lane "${s.lane}" is missing from LANE_NAME`);
      if (words(s.title) > 6) out.push(`${at}: title is ${words(s.title)} words; 2–5 reads best`);
      if (words(s.text) > 40) out.push(`${at}: text is ${words(s.text)} words; keep it to 1–2 short sentences`);
      if (words(s.example) > 18) out.push(`${at}: example is ${words(s.example)} words; keep it tiny`);
    });
  }
  return out;
}
function checkDiagram() {
  const X = window.__explorer, svg = document.getElementById("arch"), vb = svg.viewBox.baseVal, out = [];
  const inter = (a, b, pad = 0.5) => a.x + pad < b.x + b.width && a.x + a.width > b.x + pad && a.y + pad < b.y + b.height && a.y + a.height > b.y + pad;
  const groupOf = el => el.closest(".elabel, .ebadge, .nbadge, .node, .region");
  const say = t => (t.querySelector("tspan") ? [...t.querySelectorAll("tspan")].map(x => x.textContent).join(" ") : t.textContent).trim().slice(0, 40);
  const texts = [...svg.querySelectorAll("text")].filter(t => t.textContent.trim())
    .map(t => ({ b: t.getBBox(), g: groupOf(t), s: say(t) })).filter(t => t.b.width > 0);
  for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++)
    if (texts[i].g !== texts[j].g && inter(texts[i].b, texts[j].b)) out.push(`text on text: "${texts[i].s}" / "${texts[j].s}"`);
  const fixed = texts.filter(t => t.g && (t.g.classList.contains("node") || t.g.classList.contains("region")));
  const boxes = [...svg.querySelectorAll(".node")].map(g => ({ id: g.dataset.node, b: g.querySelector(".box").getBBox() }));
  const labels = [...svg.querySelectorAll(".elabel .pill, .ebadge circle, .nbadge circle")].map(m => {
    const g = m.closest(".elabel, .ebadge, .nbadge");
    return { b: m.getBBox(), g, onBox: g.classList.contains("nbadge"), s: (g.querySelector(".pill-text") || g.querySelector("text")).textContent };
  });
  labels.forEach((p, i) => {
    if (!p.onBox) boxes.forEach(n => { if (inter(p.b, n.b)) out.push(`label on a box: "${p.s}" on ${n.id}`); });
    labels.forEach((q, j) => { if (j > i && inter(p.b, q.b)) out.push(`label on label: "${p.s}" / "${q.s}"`); });
    fixed.forEach(t => { if (inter(p.b, t.b)) out.push(`label on text: "${p.s}" on "${t.s}"`); });
    if (p.b.x < 0 || p.b.y < 0 || p.b.x + p.b.width > vb.width || p.b.y + p.b.height > vb.height) out.push(`label outside the drawing: "${p.s}"`);
  });
  const regionText = fixed.filter(t => t.g.classList.contains("region"));
  boxes.forEach((n, i) => {
    regionText.forEach(t => { if (inter(n.b, t.b)) out.push(`box on region text: ${n.id} on "${t.s}"`); });
    boxes.forEach((m, j) => { if (j > i && inter(n.b, m.b, 0)) out.push(`box on box: ${n.id} / ${m.id}`); });
  });
  svg.querySelectorAll(".node").forEach(g => {
    const box = g.querySelector(".box").getBBox(), mark = g.querySelector(".sm");
    g.querySelectorAll("text").forEach(t => {
      const b = t.getBBox();
      if (b.x < box.x + 4 || b.x + b.width > box.x + box.width - 4 || b.y < box.y || b.y + b.height > box.y + box.height) out.push(`text too big for its box: "${t.textContent}"`);
      if (mark && inter(b, mark.getBBox(), 0)) out.push(`text touches the status mark: "${t.textContent}"`);
    });
  });
  svg.querySelectorAll(".region").forEach(g => {
    const r = g.querySelector("rect").getBBox();
    g.querySelectorAll("text").forEach(t => { const b = t.getBBox(); if (b.x < r.x || b.y < r.y || b.x + b.width > r.x + r.width || b.y + b.height > r.y + r.height) out.push(`region text outside its region: "${t.textContent}"`); });
  });
  const E = Object.fromEntries(X.EDGES.map(e => [e.id, e]));
  svg.querySelectorAll(".edge").forEach(g => {
    if (g.classList.contains("is-dim")) return;
    const path = g.querySelector(".line"), len = path.getTotalLength(), e = E[g.dataset.edge];
    const lit = g.classList.contains("is-current") || g.classList.contains("is-visited");
    const hitText = new Set(), hitBox = new Set(), hitLabel = new Set();
    for (let k = 2; k < 198; k++) {
      const p = path.getPointAtLength(len * k / 200);
      const inside = b => p.x > b.x && p.x < b.x + b.width && p.y > b.y + 1 && p.y < b.y + b.height - 1;
      fixed.forEach(t => { if (inside(t.b)) hitText.add(t.s); });
      boxes.forEach(n => { if (n.id !== e.a && n.id !== e.b && inside(n.b)) hitBox.add(n.id); });
      if (lit) labels.forEach(q => { if (q.g.dataset.for !== e.id && inside(q.b)) hitLabel.add(q.s); });
    }
    hitText.forEach(s => out.push(`line through text: ${e.id} crosses "${s}"`));
    hitBox.forEach(id => out.push(`line through a box: ${e.id} crosses ${id}`));
    hitLabel.forEach(s => out.push(`lit line under another label: ${e.id} under "${s}"`));
  });
  return [...new Set(out)];
}
function checkHover() {
  const X = window.__explorer, out = [];
  const inter = (a, b) => a.x + 0.5 < b.x + b.width && a.x + a.width > b.x + 0.5 && a.y + 0.5 < b.y + b.height && a.y + a.height > b.y + 0.5;
  X.reset();
  for (const e of X.EDGES) {
    e.hit.dispatchEvent(new MouseEvent("mouseenter"));
    const pill = document.querySelector("#g-labels .elabel .pill");
    if (!pill) { out.push("no label on hover: " + e.id); continue; }
    const b = pill.getBBox();
    document.querySelectorAll("#arch .node").forEach(n => { if (inter(b, n.querySelector(".box").getBBox())) out.push(`hover label on a box: ${e.id} on ${n.dataset.node}`); });
    document.querySelectorAll("#g-regions text").forEach(t => { if (inter(b, t.getBBox())) out.push(`hover label on region text: ${e.id} on "${t.textContent}"`); });
    e.hit.dispatchEvent(new MouseEvent("mouseleave"));
  }
  return out;
}
// Reports root causes only: the innermost box whose content spills out, and the outermost element past the edge.
function checkOverflow() {
  const out = [], de = document.documentElement, vw = de.clientWidth;
  if (de.scrollWidth > vw + 1) out.push(`page scrolls sideways: ${de.scrollWidth}px of content in ${vw}px`);
  const name = el => el.id ? "#" + el.id : el.tagName.toLowerCase() + (el.getAttribute("class") ? "." + el.getAttribute("class").split(" ")[0] : "");
  const inScroller = el => { for (let p = el.parentElement; p; p = p.parentElement) if (["auto", "scroll", "hidden"].includes(getComputedStyle(p).overflowX)) return true; return false; };
  const all = [...document.querySelectorAll("body *")].filter(el => !el.closest("svg") && !el.closest("[hidden]"));
  const spills = all.filter(el => { const cs = getComputedStyle(el); return cs.display !== "inline" && cs.display !== "contents" && el.clientWidth && cs.overflowX === "visible" && el.scrollWidth > el.clientWidth + 1; });
  spills.filter(el => !spills.some(o => o !== el && el.contains(o))).forEach(el => out.push(`content spills out of ${name(el)} (${el.scrollWidth}px in ${el.clientWidth}px)`));
  const past = el => el.getBoundingClientRect().right > vw + 1;
  const boxParent = el => { let p = el.parentElement; while (p && getComputedStyle(p).display === "contents") p = p.parentElement; return p; };
  all.forEach(el => { const p = boxParent(el); if (!inScroller(el) && el.getBoundingClientRect().width && past(el) && !(p && past(p))) out.push(`sticks out past the right edge: ${name(el)}`); });
  return [...new Set(out)].slice(0, 12);
}
function checkPanel() {
  const out = [], panel = document.querySelector(".panel");
  if (!panel) return out;
  const pr = panel.getBoundingClientRect();
  panel.querySelectorAll("*").forEach(e => {
    if (e.closest("[hidden]")) return;
    const r = e.getBoundingClientRect();
    if (r.width && r.right > pr.right + 0.5) out.push("panel content sticks out: " + (e.id || e.getAttribute("class") || e.tagName));
  });
  const p = panel.querySelector(".player");
  if (p && p.scrollWidth > p.clientWidth + 1) out.push("player controls don't fit on one row");
  return [...new Set(out)].slice(0, 8);
}
// Text colors keyed by DOM position, so the light and dark renders can be compared element by element.
function themeColors() {
  const out = {}, key = el => { const p = []; for (let e = el; e && e !== document.body; e = e.parentElement) { let i = 0, s = e; while ((s = s.previousElementSibling)) i++; p.unshift(e.tagName + i); } return p.join(">"); };
  document.querySelectorAll("body *").forEach(el => {
    if (el.closest("[hidden], .sprite, title, desc") || !el.getBoundingClientRect().width || ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) return;
    const cs = getComputedStyle(el);
    out[key(el)] = [el instanceof SVGElement ? cs.fill : cs.color, el.id ? "#" + el.id : el.tagName.toLowerCase() + (el.getAttribute("class") ? "." + el.getAttribute("class").split(" ")[0] : "")];
  });
  return { colors: out, body: getComputedStyle(document.body).backgroundColor };
}
function fontStatus() {
  const fam = getComputedStyle(document.body).fontFamily.split(",")[0].trim().replace(/^["']|["']$/g, "");
  const faces = [...document.fonts].filter(f => f.family.replace(/["']/g, "") === fam);
  if (!faces.length) return `${fam} (a system font)`;
  return faces.some(f => f.status === "loaded") ? `${fam} loaded` : `${fam} did not load, a fallback font is in use (offline?)`;
}
const inPage = fn => `(${fn.toString()})()`;

/* ---------- 4. A tiny DevTools-protocol driver ---------- */
function findChrome() {
  const known = [process.env.CHROME, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"].filter(Boolean);
  for (const p of known) if (existsSync(p)) return p;
  for (const n of ["google-chrome", "chromium", "chromium-browser"]) { try { return execFileSync("which", [n], { encoding: "utf8" }).trim(); } catch { /* next */ } }
  return null;
}
const CHROME = findChrome();
if (!CHROME) { console.error("Chrome or Chromium not found. Set CHROME=/path/to/chrome."); process.exit(2); }
if (typeof WebSocket === "undefined") { console.error("This needs Node 22 or newer (built-in WebSocket)."); process.exit(2); }

mkdirSync(PROFILE, { recursive: true });
rmSync(join(PROFILE, "DevToolsActivePort"), { force: true }); // a stale port file from an earlier run would mislead us
const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${PROFILE}`, "--no-first-run",
  "--no-default-browser-check", "--hide-scrollbars", `--window-size=${WIDTH},${HEIGHT}`, "about:blank"], { stdio: "ignore" });

let ws, seq = 0;
const pending = new Map(), events = [], waiters = [];
async function connect() {
  const portFile = join(PROFILE, "DevToolsActivePort");
  for (let i = 0; i < 150; i++) {
    if (existsSync(portFile)) {
      try {
        const port = readFileSync(portFile, "utf8").split("\n")[0].trim();
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        const target = list.find(t => t.type === "page");
        if (target) {
          ws = new WebSocket(target.webSocketDebuggerUrl);
          await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
          ws.onmessage = m => {
            const msg = JSON.parse(m.data);
            if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
            if (!msg.method) return;
            events.push(msg);
            for (let k = waiters.length - 1; k >= 0; k--) if (waiters[k].method === msg.method) { waiters[k].res(msg); waiters.splice(k, 1); }
          };
          return;
        }
      } catch { /* not ready yet */ }
    }
    await sleep(100);
  }
  throw new Error("Chrome did not open its DevTools port");
}
function send(method, params = {}) { const id = ++seq; ws.send(JSON.stringify({ id, method, params })); return new Promise(res => pending.set(id, res)); }
function waitFor(method, ms = 20000) {
  return new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("timed out waiting for " + method)), ms); waiters.push({ method, res: m => { clearTimeout(t); res(m); } }); });
}
async function evaluate(expr) {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.error) throw new Error(r.error.message);
  if (r.result.exceptionDetails) throw new Error("page threw: " + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text).split("\n")[0]);
  return r.result.result.value;
}
async function key(k, code = k, vk = { ArrowRight: 39, ArrowLeft: 37, Escape: 27, Enter: 13 }[k]) {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk });
}
const saved = [];
async function shot(name, selector) {
  const rect = await evaluate(`(() => { const e = ${selector ? `document.querySelector(${JSON.stringify(selector)})` : "document.documentElement"}; if (!e) return null;
    const r = e.getBoundingClientRect(); return { x: r.x + scrollX, y: r.y + scrollY, width: ${selector ? "r.width" : "e.scrollWidth"}, height: ${selector ? "r.height" : "e.scrollHeight"} }; })()`);
  if (!rect) return;
  const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { ...rect, scale: 1 } });
  writeFileSync(join(SHOTS, name + ".png"), Buffer.from(r.result.data, "base64"));
  saved.push(name + ".png");
}
async function load(width, height, mobile, reduce) {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: reduce ? "reduce" : "no-preference" }] });
  const loaded = waitFor("Page.loadEventFired");
  await send("Page.navigate", { url: PAGE });
  await loaded;
  await evaluate("document.fonts ? document.fonts.ready.then(() => true) : true");
  await sleep(300);
}

/* ---------- 5. The run ---------- */
// Each issue is reported once, under the first state where it shows up.
const report = {}, info = [], seen = new Set();
const add = (k, list) => { for (const s of list || []) if (!seen.has(s)) { seen.add(s); (report[k] = report[k] || []).push(s); } };
const stepText = () => evaluate(`document.getElementById("step-count").textContent`);
const click = sel => evaluate(`document.querySelector(${JSON.stringify(sel)}).dispatchEvent(new MouseEvent("click", { bubbles: true }))`);
// One failing section must not hide the others.
async function section(name, fn) { try { await fn(); } catch (err) { add(name, ["could not run: " + err.message]); } }

async function main() {
  add("contract", contractIssues(fragment));
  await connect();
  await send("Page.enable"); await send("Runtime.enable"); await send("Log.enable");

  // Pass A: desktop with reduced motion, so every state is still and the screenshots are clean.
  await load(WIDTH, HEIGHT, false, true);
  const hook = await evaluate("window.__explorer ? (window.__explorer.startScenario ? 'ready' : 'data') : 'none'");
  if (hook === "none") add("setup", ["window.__explorer is missing, so only the static and overflow checks ran. Keep the test hook from the template."]);
  if (hook !== "none") add("data", await evaluate(inPage(checkData)));
  if (hook === "data") add("setup", ["the engine stopped while building the page; see the data and console sections"]);
  add("page overflow", await evaluate(inPage(checkOverflow)));
  await shot("rest-page");
  const look = [];
  let scen = [], nodes = [];
  if (hook === "ready") {
    info.push("fonts: " + await evaluate(inPage(fontStatus)));
    scen = await evaluate("Object.entries(window.__explorer.SCENARIOS).map(([id, s]) => [id, s.steps.length])");
    nodes = await evaluate("Object.values(window.__explorer.NODES).map(n => [n.id, n.name])");
    await section("rest", async () => { add("rest", await evaluate(inPage(checkDiagram))); await shot("rest-explorer", "#explorer"); look.push("rest-explorer.png"); });
    await section("hover labels", async () => add("hover labels", await evaluate(inPage(checkHover))));

    // Themes: render light and dark. A text color that stays the same in both is a literal, not a token.
    await section("themes", async () => {
      const snap = {};
      for (const scheme of ["light", "dark"]) {
        await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }, { name: "prefers-reduced-motion", value: "reduce" }] });
        await sleep(150);
        snap[scheme] = await evaluate(inPage(themeColors));
        if (/rgba\(0, 0, 0, 0\)|transparent/.test(snap[scheme].body)) add("themes", [`body has no background in ${scheme} mode`]);
        await shot(`rest-explorer-${scheme}`, "#explorer");
        if (scen.length) { // the lit path is where contrast fails first
          await evaluate(`window.__explorer.startScenario(${JSON.stringify(scen[0][0])}, false); window.__explorer.go(${scen[0][1] - 1})`);
          await shot(`${scen[0][0]}-step${scen[0][1]}-${scheme}`, "#explorer");
          await evaluate("window.__explorer.reset()");
        }
      }
      const keys = Object.keys(snap.light.colors).filter(k => snap.dark.colors[k]);
      const same = keys.filter(k => snap.light.colors[k][0] === snap.dark.colors[k][0]);
      if (keys.length && same.length === keys.length) info.push("themes: the page looks the same in light and dark. Fine only if the user asked for a single theme.");
      else if (same.length) add("themes", same.slice(0, 8).map(k => `text color doesn't follow the theme: ${snap.light.colors[k][1]} (${snap.light.colors[k][0]})`));
      await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    });

    for (const [id, n] of scen) await section(id, async () => {
      await evaluate("window.__explorer.reset()");
      await click("#sc-" + id);
      if (await evaluate("window.__explorer.state.playing")) add(id, ["autoplay started although reduced motion is on"]);
      if (await evaluate(`document.querySelectorAll("#g-tokens circle").length`)) add(id, ["a token moves although reduced motion is on"]);
      for (let i = 0; i < n; i++) {
        if (i > 0) await click("#btn-next");
        await sleep(40);
        const problems = await evaluate(inPage(checkDiagram));
        const count = await stepText();
        if (count !== `Step ${i + 1} of ${n}`) problems.push(`the panel says "${count}"`);
        problems.push(...await evaluate(inPage(checkPanel)));
        add(`${id}, step ${i + 1}`, problems);
        await shot(`${id}-step${i + 1}`, "#explorer");
      }
      look.push(`${id}-step${n}.png`);
      if (n > 1) { await click("#btn-back"); const b = await stepText(); if (b !== `Step ${n - 1} of ${n}`) add(id, [`Back went to "${b}"`]); }
    });

    // Every box opens its own panel.
    await section("boxes", async () => {
      await evaluate("window.__explorer.reset()");
      for (const [nid, name] of nodes) {
        await click("#node-" + nid);
        const shown = await evaluate(`document.getElementById("pv-node").hidden ? null : document.getElementById("node-name").textContent`);
        if (shown !== name) add("boxes", [`clicking ${nid} showed ${JSON.stringify(shown)}`]);
        add(`box ${nid}`, [...await evaluate(inPage(checkDiagram)), ...await evaluate(inPage(checkPanel))]);
        if (nid === nodes[0][0]) { await shot("box-" + nid, "#explorer"); look.push(`box-${nid}.png`); }
      }
    });

    // From a scenario step, opening a box offers a way back to that step.
    const [first, firstN] = scen[0] || [];
    if (firstN > 1) await section("boxes", async () => {
      await evaluate(`window.__explorer.startScenario(${JSON.stringify(first)}, false); window.__explorer.go(1)`);
      await click("#node-" + nodes[0][0]);
      const back = await evaluate(`document.getElementById("btn-node-back").hidden ? null : document.getElementById("btn-node-back").textContent`);
      if (!back || !/step 2\b/.test(back)) add("boxes", [`no "back to step 2" link after opening a box mid-scenario (got ${JSON.stringify(back)})`]);
      else { await click("#btn-node-back"); if ((await stepText()) !== `Step 2 of ${firstN}`) add("boxes", ["the back link did not return to step 2"]); }
    });

    // Keyboard: arrows step only inside the explorer, Esc resets, Enter opens a focused box.
    if (first) await section("keyboard", async () => {
      await evaluate(`window.__explorer.reset(); document.getElementById("sc-${first}").click(); document.getElementById("btn-next").focus()`);
      if (firstN > 1) {
        await key("ArrowRight"); const a = await stepText();
        await key("ArrowLeft"); const b = await stepText();
        if (a !== `Step 2 of ${firstN}` || b !== `Step 1 of ${firstN}`) add("keyboard", [`arrow keys gave "${a}" then "${b}"`]);
        await evaluate("document.activeElement.blur(); document.body.focus()");
        await key("ArrowRight");
        if ((await stepText()) !== `Step 1 of ${firstN}`) add("keyboard", ["arrow keys step the scenario even when focus is outside the explorer"]);
        await evaluate(`document.getElementById("btn-next").focus()`);
      }
      await key("Escape");
      if ((await evaluate("window.__explorer.state.mode")) !== "rest") add("keyboard", ["Escape did not reset"]);
      await evaluate(`document.getElementById("node-${nodes[0][0]}").focus()`);
      await key("Enter");
      if ((await evaluate(`document.getElementById("pv-node").hidden ? null : document.getElementById("node-name").textContent`)) !== nodes[0][1]) add("keyboard", ["Enter on a focused box did not open it"]);
    });

    // Pass B: normal motion. A token moves along the lit line and autoplay advances on its own.
    await section("motion", async () => {
      await load(WIDTH, HEIGHT, false, false);
      const sc = await evaluate("(Object.entries(window.__explorer.SCENARIOS).find(([, s]) => (s.steps[0].edges || []).length) || [null])[0]");
      if (!sc) return;
      await click("#sc-" + sc);
      const pos = `[...document.querySelectorAll("#g-tokens .token")].map(c => c.getAttribute("cx") + "," + c.getAttribute("cy")).join(" ")`;
      await sleep(200); const p1 = await evaluate(pos); await sleep(250); const p2 = await evaluate(pos);
      if (!p1) add("motion", ["no token on the lit line"]); else if (p1 === p2) add("motion", ["the token did not move"]);
      await shot("motion-token", "#explorer");
      let advanced = false;
      for (let i = 0; i < 40 && !advanced; i++) { await sleep(250); advanced = /^Step 2 /.test(await stepText()); }
      if ((await evaluate(`window.__explorer.SCENARIOS[${JSON.stringify(sc)}].steps.length`)) > 1 && !advanced) add("motion", ["autoplay did not reach step 2 within 10 s"]);
    });
  }

  // Pass C: phone width. The page must not scroll sideways; only the diagram and tables scroll inside themselves.
  await section("phone (390px)", async () => {
    await load(390, 844, true, true);
    add("phone (390px)", await evaluate(inPage(checkOverflow)));
    const top = await send("Page.captureScreenshot", { format: "png" }); // what a phone shows first
    writeFileSync(join(SHOTS, "phone-top.png"), Buffer.from(top.result.data, "base64")); saved.push("phone-top.png");
    await shot("phone-page");
  });
  if (look.length) info.push("look at: " + look.join(", "));
}

let exitCode = 0;
try { await main(); }
catch (err) { console.error("verify could not finish: " + err.message); exitCode = 2; }
finally { try { ws && ws.close(); } catch { /* ignore */ } chrome.kill(); }

const logged = events.filter(e => e.method === "Runtime.exceptionThrown" || (e.method === "Runtime.consoleAPICalled" && ["error", "warning", "assert"].includes(e.params.type)) || (e.method === "Log.entryAdded" && ["error", "warning"].includes(e.params.entry.level)));
const describe = e => e.method === "Runtime.exceptionThrown" ? (e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text) : e.method === "Log.entryAdded" ? `${e.params.entry.text} ${e.params.entry.url || ""}` : e.params.args.map(a => a.value ?? a.description).join(" ");
const fontNoise = s => /fonts\.(googleapis|gstatic)\.com/.test(s);
add("console", logged.map(describe).filter(s => !fontNoise(s)).map(s => s.split("\n")[0].slice(0, 240)));
if (logged.map(describe).some(fontNoise)) info.push("web fonts could not load (no network?); the fallback stack was used");

let total = 0;
for (const [k, list] of Object.entries(report)) { total += list.length; console.log(`\n${k}:`); list.forEach(s => console.log("  - " + s)); }
console.log("\n" + info.join("\n"));
console.log(`\n${total ? total + " issue(s) found" : "No issues found"}. ${saved.length} screenshots in ${SHOTS}`);
process.exit(exitCode || (total ? 1 : 0));
