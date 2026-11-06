// Record real runs of a Node workflow for a replay page: every model call with its full request
// body and answer, every other HTTP request with its parameters and a summary of its answer,
// optional cache reads, and the app's own events, each with a timestamp from the run's start.
// Request headers (where API keys travel) are never read; key-like fields in URLs and bodies are
// blanked.
//
//   import { install, scenario, save } from '<skill>/scripts/record.mjs';
//   install({ out: '<scratch>/traces.json', cache: { dir: '/cache/', hashedUrls: true } });
//   // Import the app only after install(), so its fetch, readFile and createHash are the wrapped ones.
//   const { runTurn } = await import(pathToFileURL(resolve(repo, 'src/agent.mjs')).href);
//   await scenario({ id: 'refund-late', title: 'After 41 days', ask: ['…'] }, async ({ event, turn }) => {
//     await turn(async () => runTurn(input, { onEvent: event }));   // one turn; call again for the next
//   });
//   await save();
//
// Run it locally against a copy of the data, never production. Model calls cost tokens: estimate
// the spend and get the owner's yes first.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';

const clock = () => performance.now();
const clip = (s, n = 600) => (typeof s === 'string' && s.length > n ? s.slice(0, n) + `…[+${s.length - n}]` : s);
const SECRET_KEY = /^(api_?key|apikey|key|token|access_token|secret|password|authorization|subscription-key|subscription-token|x-api-key)$/i;
const SECRET_VALUE = /^(sk-[A-Za-z0-9_-]{8,}|Bearer\s+\S+|AIza[0-9A-Za-z_-]{20,})$/;
const blank = (k, v) => (SECRET_KEY.test(k) || (typeof v === 'string' && SECRET_VALUE.test(v)) ? '•' : v);
function scrub(v, depth = 0) {
  if (depth > 12 || v === null || typeof v !== 'object') return typeof v === 'string' && SECRET_VALUE.test(v) ? '•' : v;
  if (Array.isArray(v)) return v.map((x) => scrub(x, depth + 1));
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SECRET_KEY.test(k) ? '•' : scrub(x, depth + 1)]));
}

let OPTS = null;
let current = null; // { t0, events, turns, appEvents }
const runs = [];
const push = (ev) => current && current.events.push(ev);
const rel = (t) => (current ? Math.round(t - current.t0) : 0);

// Which service a host is; model hosts get their whole request recorded.
const DEFAULT_LLM = [/(^|\.)openai\.com$/, /(^|\.)openai\.azure\.com$/, /(^|\.)anthropic\.com$/, /generativelanguage\.googleapis\.com$/, /(^|\.)mistral\.ai$/, /(^|\.)groq\.com$/];
function serviceOf(host) {
  for (const [name, test] of Object.entries(OPTS.services || {})) if (test instanceof RegExp ? test.test(host) : host.includes(test)) return name;
  if ((OPTS.llmHosts || DEFAULT_LLM).some((re) => re.test(host))) return 'llm';
  return host.replace(/^www\./, '').split('.').slice(-2, -1)[0] || host;
}

// A small, readable summary of a JSON answer (a service may pass its own `summarize`).
function defaultSummary(v, depth = 0) {
  if (v === null || typeof v !== 'object') return typeof v === 'string' ? clip(v, 200) : v;
  if (depth >= 2) return Array.isArray(v) ? `[${v.length} items]` : '{…}';
  if (Array.isArray(v)) return [...v.slice(0, 20).map((x) => defaultSummary(x, depth + 1)), ...(v.length > 20 ? [`…${v.length - 20} more`] : [])];
  return Object.fromEntries(Object.entries(v).slice(0, 16).map(([k, x]) => [k, defaultSummary(x, depth + 1)]));
}
const summarize = (service, v) => {
  try {
    return (OPTS.summarize && OPTS.summarize(service, v)) ?? defaultSummary(v);
  } catch {
    return null;
  }
};

// ---------- model calls: the request as sent, and the answer ----------
function llmRequest(body) {
  const out = {};
  for (const [k, v] of Object.entries(body || {})) {
    if ((k === 'input' || k === 'prompt') && typeof v === 'string') {
      try { out[k] = JSON.parse(v); continue; } catch { /* plain text */ }
    }
    out[k] = v;
  }
  const fmt = body?.text?.format || body?.response_format?.json_schema || null;
  return {
    name: fmt?.name || body?.metadata?.name || OPTS.nameOf?.(body) || null,
    model: body?.model || null,
    stream: Boolean(body?.stream),
    body: scrub(out),
  };
}
// OpenAI Responses (JSON or SSE), Chat Completions (JSON or SSE) and Anthropic Messages (JSON or SSE).
function llmResponse(text) {
  const tryJSON = (s) => { try { return JSON.parse(s); } catch { return null; } };
  let r = /^\s*\{/.test(text) ? tryJSON(text) : null;
  if (!r) {
    const lines = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => tryJSON(l.slice(5).trim())).filter(Boolean);
    const done = lines.find((e) => ['response.completed', 'response.incomplete', 'response.failed'].includes(e.type));
    if (done) r = done.response;
    else if (lines.some((e) => e.type === 'message_start')) {
      // Anthropic stream: stitch the text and tool input back together.
      const start = lines.find((e) => e.type === 'message_start').message;
      const blocks = [];
      for (const e of lines) {
        if (e.type === 'content_block_start') blocks[e.index] = { ...e.content_block, text: e.content_block.text || '', partial: '' };
        if (e.type === 'content_block_delta') {
          const b = blocks[e.index];
          if (e.delta.type === 'text_delta') b.text += e.delta.text;
          if (e.delta.type === 'input_json_delta') b.partial += e.delta.partial_json;
        }
      }
      const end = lines.filter((e) => e.type === 'message_delta').at(-1);
      r = { ...start, content: blocks.map((b) => (b.type === 'tool_use' ? { ...b, input: tryJSON(b.partial) ?? b.input } : b)), usage: { ...start.usage, ...(end?.usage || {}) }, stop_reason: end?.delta?.stop_reason };
    } else if (lines.some((e) => e.choices)) {
      // Chat Completions stream.
      let content = '';
      const tools = {};
      let usage = null;
      for (const e of lines) {
        if (e.usage) usage = e.usage;
        for (const ch of e.choices || []) {
          content += ch.delta?.content || '';
          for (const tc of ch.delta?.tool_calls || []) {
            const t = (tools[tc.index] ||= { name: '', args: '' });
            t.name += tc.function?.name || '';
            t.args += tc.function?.arguments || '';
          }
        }
      }
      r = { choices: [{ message: { content, tool_calls: Object.values(tools).map((t) => ({ function: { name: t.name, arguments: t.args } })) } }], usage };
    }
  }
  if (!r) return null;
  const out = [];
  let usage = {};
  if (Array.isArray(r.output)) {
    for (const item of r.output) {
      if (item.type === 'function_call') out.push({ type: 'tool_call', name: item.name, args: clip(item.arguments, 60000) });
      else if (item.type === 'message') out.push({ type: 'message', text: clip((item.content || []).map((c) => c.text || '').join(''), 400000) });
      else if (item.type === 'web_search_call') out.push({ type: 'web_search', query: clip(item.action?.query || '', 200) });
    }
    const u = r.usage || {};
    usage = { input: u.input_tokens ?? null, cached: u.input_tokens_details?.cached_tokens ?? null, output: u.output_tokens ?? null, reasoning: u.output_tokens_details?.reasoning_tokens ?? null };
  } else if (Array.isArray(r.content)) {
    for (const b of r.content) {
      if (b.type === 'text') out.push({ type: 'message', text: clip(b.text, 400000) });
      if (b.type === 'tool_use') out.push({ type: 'tool_call', name: b.name, args: clip(JSON.stringify(b.input), 60000) });
    }
    const u = r.usage || {};
    usage = { input: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), cached: u.cache_read_input_tokens ?? null, output: u.output_tokens ?? null, reasoning: null };
  } else if (Array.isArray(r.choices)) {
    const m = r.choices[0]?.message || {};
    if (m.content) out.push({ type: 'message', text: clip(typeof m.content === 'string' ? m.content : JSON.stringify(m.content), 400000) });
    for (const tc of m.tool_calls || []) out.push({ type: 'tool_call', name: tc.function?.name, args: clip(tc.function?.arguments, 60000) });
    const u = r.usage || {};
    usage = { input: u.prompt_tokens ?? null, cached: u.prompt_tokens_details?.cached_tokens ?? null, output: u.completion_tokens ?? null, reasoning: u.completion_tokens_details?.reasoning_tokens ?? null };
  }
  return { status: r.status || r.stop_reason || r.choices?.[0]?.finish_reason || null, usage, output: out };
}

// ---------- install ----------
export function install(opts = {}) {
  if (OPTS) return;
  OPTS = { out: 'traces.json', ...opts };
  // Cache reads: one JSON file per key in a folder, as many local caches keep them (optional).
  const cache = OPTS.cache;
  const hashed = new Map();
  if (cache?.hashedUrls) {
    // Caches keyed by a hash of the request: remember which request made each hash.
    const orig = crypto.createHash;
    crypto.createHash = function (...args) {
      const h = orig.apply(this, args);
      let seen = '';
      const update = h.update.bind(h), digest = h.digest.bind(h);
      h.update = function (data, enc) { if (typeof data === 'string' && data.length < 3000) seen += data; update(data, enc); return h; };
      h.digest = function (enc) { const out = digest(enc); if (seen && typeof out === 'string') hashed.set(out, seen); return out; };
      return h;
    };
  }
  if (cache?.dir) {
    const origRead = fs.promises.readFile;
    fs.promises.readFile = async function (path, ...rest) {
      const p = String(path);
      if (!current || !p.includes(cache.dir)) return origRead.call(this, path, ...rest);
      const key = p.split(cache.dir)[1].replace(/\.json$/, '');
      const start = clock();
      const service = cache.serviceOf?.(key) || key.split(/[:_-]/)[0];
      try {
        const raw = await origRead.call(this, path, ...rest);
        let hit = true, summary;
        try {
          const rec = JSON.parse(String(raw));
          hit = cache.isHit ? cache.isHit(rec) : rec.expiresAt == null || rec.expiresAt > Date.now();
          summary = summarize(service, cache.valueOf ? cache.valueOf(rec) : rec.value ?? rec);
        } catch { /* not JSON */ }
        const asked = [...hashed.entries()].find(([h]) => key.endsWith(h))?.[1];
        push({ kind: 'cache', key: clip(key, 120), service, hit, asked, summary, start: rel(start), end: rel(clock()) });
        return raw;
      } catch (error) {
        push({ kind: 'cache', key: clip(key, 120), service, hit: false, start: rel(start), end: rel(clock()) });
        throw error;
      }
    };
  }
  syncBuiltinESMExports();

  const origFetch = globalThis.fetch;
  globalThis.fetch = async function (input, init = {}) {
    const url = input instanceof URL ? new URL(input.href) : new URL(typeof input === 'string' ? input : input.url);
    const start = clock();
    const service = serviceOf(url.hostname);
    const ev = {
      kind: 'http', service, host: url.hostname, path: url.pathname, method: init.method || 'GET', start: rel(start),
      params: Object.fromEntries([...url.searchParams].map(([k, v]) => [k, blank(k, clip(v, 200))])),
    };
    let body = null;
    if (typeof init.body === 'string') { try { body = JSON.parse(init.body); } catch { /* not JSON */ } }
    if (service === 'llm' && body) ev.req = llmRequest(body);
    else if (body) ev.sent = scrub(body);
    push(ev);
    let res;
    try {
      res = await origFetch.call(this, input, init);
    } catch (error) {
      ev.end = rel(clock());
      ev.error = clip(String(error?.message || error), 200);
      throw error;
    }
    ev.status = res.status;
    const copy = res.clone();
    (async () => {
      try {
        const reader = copy.body.getReader();
        const dec = new TextDecoder();
        let text = '', first = null;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = dec.decode(value, { stream: true });
          if (first === null && service === 'llm' && /delta/.test(chunk)) first = clock();
          text += chunk;
        }
        ev.end = rel(clock());
        if (first !== null) ev.firstDelta = rel(first);
        if (service === 'llm') ev.res = llmResponse(text);
        else {
          try { ev.summary = summarize(service, JSON.parse(text)); } catch { ev.summary = clip(text, 300); }
        }
      } catch {
        ev.end = rel(clock());
        ev.cut = true;
      }
    })();
    return res;
  };
}

/**
 * One recorded run. `fn` gets `event(e)` for the app's own events (stages, items shown) and
 * `turn(work)` to time one turn of a multi-turn run; anything `fn` returns is stored with the run
 * (keep it small: the result's answer, list and counts, never the whole person's data).
 */
export async function scenario(meta, fn) {
  if (!OPTS) throw new Error('Call install() first.');
  current = { t0: clock(), events: [], turns: [], appEvents: [] };
  const run = current;
  const event = (e) => run.appEvents.push({ t: rel(clock()), ...e });
  const turn = async (work) => {
    const began = rel(clock());
    const at = run.appEvents.length;
    const result = await work();
    run.turns.push({ began, ended: rel(clock()), appEvents: run.appEvents.slice(at), result });
    return result;
  };
  console.log(`▶ ${meta.id}`);
  let data = {}, error = null;
  try {
    data = (await fn({ event, turn })) || {};
  } catch (err) {
    error = String(err?.stack || err);
    console.error(err);
  }
  await new Promise((r) => setTimeout(r, 1500)); // let response readers finish
  const total = Math.round(clock() - run.t0);
  if (!run.turns.length) run.turns.push({ began: 0, ended: total, appEvents: run.appEvents, result: data.result ?? null });
  const llm = run.events.filter((e) => e.kind === 'http' && e.service === 'llm' && e.res?.usage);
  const tokens = llm.reduce((a, e) => ({ input: a.input + (e.res.usage.input || 0), cached: a.cached + (e.res.usage.cached || 0), output: a.output + (e.res.usage.output || 0) }), { input: 0, cached: 0, output: 0 });
  const counts = {};
  for (const e of run.events) {
    const k = `${e.kind}:${e.service}${e.kind === 'cache' ? (e.hit ? ':hit' : ':miss') : ''}`;
    counts[k] = (counts[k] || 0) + 1;
  }
  console.log(`  ${total} ms · ${llm.length} model calls · tokens`, tokens);
  runs.push({ ...meta, total, tokens, counts, events: run.events, turns: run.turns, ...data, ...(error ? { error } : {}) });
  current = null;
  await save();
}

export async function save() {
  await fs.promises.writeFile(OPTS.out, JSON.stringify(runs, null, 1));
  return OPTS.out;
}
