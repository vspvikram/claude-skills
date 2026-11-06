#!/usr/bin/env node
// Verify a workflow replay page: render it in headless Chrome, open every run in every view, step
// through every step, open every step's pop-up, and check the data, text fit, clipping, phone
// width, both themes and console errors. Saves screenshots.
//
// Usage:  node verify.mjs <page.html> <out-dir> [--width=1440] [--height=1000]
//   <page.html>  the Artifact fragment (no doctype/html/head/body), e.g. your copy of template/replay.html
//   <out-dir>    a scratch folder, never the user's repo. Gets test.html, shots/*.png and chrome-profile/.
// Needs Node 22+ (built-in WebSocket and fetch) and Chrome or Chromium. Set CHROME=/path/to/chrome if not found.
// Relies on the template's ids (#loop, #seq, #funnel, #inspect, #insp-body, .run[data-run], .tab[data-view])
// and on window.__replay, which the template exposes only on file:// pages.
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
// The data: every step lands on a box, every call it names exists, every finding points at a real moment.
function checkData() {
  const X = window.__replay, out = [], note = [];
  if (!X) return { out: ["window.__replay is missing: keep the template's test hook at the end of init()"], note };
  const { RUNS, FLOWS, FINDS } = X;
  for (const [fid, f] of Object.entries(FLOWS)) {
    const ids = new Set(f.nodes.map(n => n.id));
    for (const [id] of f.edges) {
      const [a, b] = String(id).split(">");
      if (!ids.has(a) || !ids.has(b)) out.push(`flow ${fid}: edge "${id}" joins a box that isn't drawn`);
    }
    if (f.nodes.length > 18) out.push(`flow ${fid}: ${f.nodes.length} boxes; past about 16 the loop stops reading at a glance`);
  }
  for (const r of RUNS) {
    const f = FLOWS[r.flow];
    if (!f) { out.push(`run ${r.id}: flow "${r.flow}" is not in FLOWS`); continue; }
    const ids = new Set(f.nodes.map(n => n.id));
    const edges = new Set(f.edges.map(e => e[0]));
    const al = st => (f.alias || {})[st] || st;
    let prev = null;
    r.steps.forEach((s, k) => {
      if (!ids.has(al(s.st))) out.push(`run ${r.id} step ${k + 1} (${s.title}): "${s.st}" is not a box in flow ${r.flow} (add it, or an alias)`);
      if (!(s.b >= s.a)) out.push(`run ${r.id} step ${k + 1}: ends before it starts`);
      if (k && s.a < r.steps[k - 1].a) out.push(`run ${r.id} step ${k + 1}: steps must be sorted by start`);
      for (const c of s.calls || []) if (!r.net[c]) out.push(`run ${r.id} step ${k + 1}: call ${c} is not in run.net`);
      if (s.ctx_call != null && !(r.net[s.ctx_call] && r.net[s.ctx_call].k === "llm")) out.push(`run ${r.id} step ${k + 1}: ctx_call ${s.ctx_call} is not a model call`);
      if (!s.title) out.push(`run ${r.id} step ${k + 1}: no title`);
      if (s.sub) return;
      const froms = s.fr ? s.fr.map(al) : prev ? [prev] : [];
      for (const fr of froms) if (fr !== al(s.st) && !edges.has(`${fr}>${al(s.st)}`)) note.push(`run ${r.id}: the move ${fr} → ${al(s.st)} (step ${k + 1}) has no edge drawn`);
      prev = al(s.st);
    });
    (r.net || []).forEach((c, i) => {
      if (c.i !== i) out.push(`run ${r.id}: net[${i}].i is ${c.i}; ids must equal their index`);
      if (c.k === "llm" && c.prompt && !(c.prompt in (window.__replay.PROMPTS || PROMPTS))) out.push(`run ${r.id}: call ${i} names prompt ${c.prompt}, which PROMPTS lacks`);
      if (c.k === "llm" && c.schema && !(c.schema in SCHEMAS)) out.push(`run ${r.id}: call ${i} names schema ${c.schema}, which SCHEMAS lacks`);
    });
    for (const e of r.events) if (e.c != null && !r.net[e.c]) out.push(`run ${r.id}: an event points at call ${e.c}, which run.net lacks`);
    if (r.tokens.cached > r.tokens.in) out.push(`run ${r.id}: more cached tokens than input tokens`);
    const llm = (r.net || []).filter(c => c.k === "llm").length;
    if (llm && llm !== r.calls) note.push(`run ${r.id}: calls says ${r.calls} model calls, run.net has ${llm}`);
  }
  for (const f of FINDS) {
    const r = RUNS.find(x => x.id === f.go[0]);
    if (!r) out.push(`finding "${f.title}": run ${f.go[0]} doesn't exist`);
    else if (f.go[2] > r.total) out.push(`finding "${f.title}": ${f.go[2]} ms is past the run's end`);
    if (!["loop", "seq", "funnel"].includes(f.go[1])) out.push(`finding "${f.title}": view "${f.go[1]}" should be loop, seq or funnel`);
    if (!["good", "bug", "waste"].includes(f.sev)) out.push(`finding "${f.title}": sev should be good, bug or waste`);
  }
  return { out, note };
}
// The loop drawing: box text fits its box, region names stay clear of boxes.
function checkLoop() {
  const out = [], svg = document.getElementById("loop");
  const boxes = [...svg.querySelectorAll(".node")].map(g => ({ g, r: g.querySelector(".shape").getBBox(), id: g.dataset.id }));
  for (const { g, r, id } of boxes) {
    const diamond = g.querySelector("path.shape");
    for (const t of g.querySelectorAll(".n-t, .n-s")) {
      const w = t.getBBox().width, room = diamond ? r.width * 0.62 : r.width - 10;
      if (w > room) out.push(`box ${id}: "${t.textContent}" is wider than its box (${Math.round(w)} > ${Math.round(room)})`);
    }
  }
  const hit = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  for (const t of svg.querySelectorAll(".region-label")) for (const { r, id } of boxes) if (hit(t.getBBox(), r)) out.push(`region name "${t.textContent}" runs into box ${id}`);
  for (const t of svg.querySelectorAll(".e-lab")) for (const { r, id } of boxes) if (hit(t.getBBox(), r)) out.push(`edge label "${t.textContent}" sits on box ${id}`);
  return out;
}
// The pop-up: something to read, and no card squeezed shorter than its content.
function checkInspector() {
  const out = [], d = document.getElementById("inspect"), body = document.getElementById("insp-body");
  if (!d.open) return ["the pop-up did not open"];
  if (!body.textContent.trim()) out.push("the pop-up is empty");
  for (const c of body.querySelectorAll(".call")) if (c.scrollHeight > c.clientHeight + 2) out.push(`a card is cut off (${c.scrollHeight} > ${c.clientHeight} px): the pop-up body must scroll, not squeeze`);
  if (body.scrollWidth > body.clientWidth + 1) out.push(`the pop-up scrolls sideways (${body.scrollWidth} > ${body.clientWidth})`);
  return out;
}
function checkPageWidth() {
  const w = document.documentElement.scrollWidth, v = window.innerWidth;
  return w > v + 1 ? [`the page scrolls sideways at ${v}px (${w}px wide)`] : [];
}
function themeColors() {
  return ["--bg", "--ink", "--surface", "--model", "--code", "--data"].map(k => getComputedStyle(document.documentElement).getPropertyValue(k).trim());
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
async function section(name, fn) { try { await fn(); } catch (err) { add(name, ["could not run: " + err.message]); } }

async function main() {
  add("contract", contractIssues(fragment));
  await connect();
  await send("Page.enable"); await send("Runtime.enable"); await send("Log.enable");
  await load(WIDTH, HEIGHT, false, false);

  await section("data", async () => {
    const { out, note } = await evaluate(inPage(checkData));
    add("data", out);
    for (const n of note) info.push("note: " + n);
  });
  const runs = await evaluate("window.__replay ? window.__replay.RUNS.map(r => ({ id: r.id, steps: r.steps.length, total: r.total })) : []");
  if (!runs.length) { add("data", ["no runs to check"]); return; }

  await section("loop", async () => {
    for (const r of runs) {
      await evaluate(`window.__replay.selectRun(${JSON.stringify(r.id)}); window.__replay.setView("loop"); true`);
      add("loop", await evaluate(inPage(checkLoop)));
      await shot(`loop-${r.id}`, ".canvas");
    }
  });

  await section("views", async () => {
    for (const r of runs) {
      await evaluate(`window.__replay.selectRun(${JSON.stringify(r.id)}); true`);
      for (const v of ["seq", "funnel", "loop"]) {
        await evaluate(`window.__replay.setView(${JSON.stringify(v)}); true`);
        // Every step, in this view.
        for (let k = 0; k < r.steps.length; k++) await evaluate(`window.__replay.seek(window.__replay.S.run.steps[${k}].a, true); true`);
        if (r === runs[0] && v !== "loop") await shot(`${v}-${r.id}`, ".canvas");
      }
    }
  });

  await section("pop-up", async () => {
    for (const r of runs) {
      await evaluate(`window.__replay.selectRun(${JSON.stringify(r.id)}); true`);
      for (let k = 0; k < r.steps.length; k++) {
        await evaluate(`window.__replay.openInspect(${k}); true`);
        add("pop-up", (await evaluate(inPage(checkInspector))).map(s => `${r.id} step ${k + 1}: ${s}`));
      }
      const first = await evaluate(`window.__replay.S.run.steps.findIndex(s => (s.calls || []).some(c => window.__replay.S.run.net[c].k === "llm"))`);
      if (first >= 0) {
        await evaluate(`window.__replay.openInspect(${first}); true`);
        if (r === runs[0]) await shot(`popup-${r.id}`, "#inspect");
      }
      await evaluate(`document.getElementById("inspect").close(); true`);
    }
    // A click on a box opens its step.
    await evaluate(`window.__replay.selectRun(${JSON.stringify(runs[0].id)}); window.__replay.setView("loop"); true`);
    const opened = await evaluate(`(() => { const g = [...document.querySelectorAll("#loop .node")].find(n => n.querySelector(".io-b")); if (!g) return "none"; g.dispatchEvent(new MouseEvent("click", { bubbles: true })); return document.getElementById("inspect").open; })()`);
    if (opened === false) add("pop-up", ["clicking a box with calls did not open the pop-up"]);
    await evaluate(`document.getElementById("inspect").close(); true`);
  });

  await section("themes", async () => {
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
    await sleep(400); // let colour transitions finish
    const dark = await evaluate(inPage(themeColors));
    await shot("page-dark");
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
    await sleep(400);
    const light = await evaluate(inPage(themeColors));
    await shot("page-light");
    await shot("loop-light", ".canvas");
    if (JSON.stringify(dark) === JSON.stringify(light)) add("themes", ["light and dark use the same colours: keep both palettes as tokens"]);
  });

  await section("phone", async () => {
    await load(390, 844, true, false);
    add("phone", await evaluate(inPage(checkPageWidth)));
    await shot("phone-page");
    await evaluate(`window.__replay.openInspect(Math.max(0, window.__replay.S.run.steps.findIndex(s => (s.calls || []).length))); true`);
    add("phone", (await evaluate(inPage(checkInspector))).map(s => "pop-up: " + s));
    await shot("phone-popup", "#inspect");
  });

  await section("motion", async () => {
    await load(WIDTH, HEIGHT, false, true);
    await evaluate(`document.getElementById("play").click(); true`);
    await sleep(400);
    const t = await evaluate("window.__replay.S.t");
    if (!(t >= 0)) add("motion", ["playback broke under reduced motion"]);
  });
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
