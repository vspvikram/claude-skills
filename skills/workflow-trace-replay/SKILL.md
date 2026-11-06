---
name: workflow-trace-replay
description: "Record real runs of an AI or agent workflow (model calls, tool and API calls, caches, retries) and build an interactive replay page (an HTML Artifact) that shows how it actually behaves: a run picker, three linked views of one run (the workflow as a state machine that lights up as the run moves through it, every call on a timeline, a funnel of what each stage kept), a step panel, and a pop-up on every step with exactly what was sent and what came back (model parameters, instructions, full input, response format, answer, tokens; every API request with a summary of its answer). Below it, findings read straight from the recordings, an optional before/after table and the limits each run works inside. Use it whenever someone wants to see, debug, review or compare how an LLM pipeline, agent or recommendation engine really runs: 'replay real runs', 'show me what's sent to the LLM at each step', 'trace the engine', 'why does it loop or repeat', 'compare the old and new engine', 'show the internals of each call', even when they only say 'workflow diagram' about an AI system they want to watch working. Not for a design review with imagined scenarios for non-builders (use interactive-architecture-explainer), charts of numbers, or a static diagram."
---

# Workflow trace replay

Build one page that replays real recorded runs of an AI workflow, so the owner sees what the system actually did: which steps ran, in what order, how long each took, what every model call was given and answered, what each outside service returned, and where documents, products or other items were dropped along the way. Every claim on the page comes from a recording. It ships as a claude.ai Artifact and works for any workflow whose code runs in Node: a recommendation engine, a support agent, a RAG pipeline, a multi-step tool-using agent.

The page shows the mechanism, then lets the reader open anything. "What did the model see when it chose that?" is answered by clicking the box and reading the input.

## When to use it

Use it when someone wants to:
- understand how an agentic or LLM workflow behaves on real requests, call by call
- see the context sent to the model in each call, and the parameters of every step
- debug a run that looped, repeated itself, ran slow or answered about the wrong thing
- compare an old and a new version of a workflow on the same requests
- review findings with evidence they can open, not a list of assertions

Don't use it when:
- the reader didn't build the system and needs the design explained in plain words with decisions to make: use `interactive-architecture-explainer`
- there are no real runs to record (a design that isn't built yet), or recording would touch production data or cost money nobody approved
- the ask is a chart of metrics, a dashboard or a one-line answer

## Files in this skill

| File | What it is | When to open it |
|---|---|---|
| `template/replay.html` | A working page for a small support-reply agent: two recorded tickets, one state machine, the three views, the pop-up, findings, a before/after table and limits. Its DATA block is the format reference. | Always. Copy it; scripts/assemble.py fills it. |
| `scripts/record.mjs` | Records runs of a Node workflow: every model call's full request and answer (OpenAI Responses and Chat Completions, Anthropic Messages, Azure, Gemini; JSON or streamed), every other HTTP call with a summary of its answer, optional cache reads, the app's own events. Never reads headers; blanks key-like fields. | Step 4. |
| `scripts/build_runs.py` | Turns the recording into the page's data: steps, calls, sequence events, funnels, summaries, and each instruction text and schema once. Works with no setup (one step per model call); `--steps steps.py` gives a real workflow its named steps. | Steps 5–6. |
| `scripts/assemble.py` | Fills the template with your page.js and the built data. | Step 8. |
| `scripts/verify.mjs` | Renders the page in headless Chrome: checks the data, opens every run in every view, steps through every step, opens every step's pop-up, checks text fit, label collisions, clipped cards, phone width, both themes and console errors, and saves screenshots. | Step 8. |
| `reference/example-steps.py` | A worked steps.py for the template's help-desk agent: its recordings turned into named steps (model calls, a cached search, a code check, a redraft), a staged funnel and summary cards. | When writing steps.py. |
| `reference/example-page.js` | That agent's page.js: META, one state machine with a redraft loop, findings, a warning, a before/after table and limits. | When writing page.js. |
| `reference/research-notes.md` | How engineering teams draw traces, loops and funnels, and what this format learned from a real review. | When the workflow is unusual, or the reader questions the format. |

Before writing the page, load the `artifact-design` skill; the Artifact tool requires it. This skill adds to it.

## The page, top to bottom

1. **Header.** A meta line (system · commit · when recorded · model), the page name, and a 2–3 sentence thesis that states the workflow's main idea in one bold sentence.
2. **Runs.** One card per recorded run: its kind, a short title, the request, a time bar split into model time and the rest.
3. **One run, three views**, driven by one transport (Play, Back, Next, speed, a scrubbable track):
   - **Loop**: the workflow as a state machine. Boxes are what the reader should see happen; colour says who does the work (model, code, outside data); a diamond is a decision; dashed boxes are rare exits. The run lights its path, counts repeat visits (×2), and moves a token along each step's edge. A small "i/o" tag marks boxes whose steps made outside calls. Clicking a box jumps to its next visit and opens its pop-up.
   - **Sequence**: lanes for the person, the app, the model, each outside service and the cache, on a time axis. Model calls are bars with their first token marked; service calls are clustered; clicking either opens it.
   - **Funnel**: each turn's stages (what the sources found, what passed, what was chosen, what was shown), filling in as the replay reaches them, with the reasons items were dropped when the code recorded them.
   - **Step panel** beside the views: the step's kind, "step N of M", what it did in one or two sentences, chips, which parts of the prompt it carried, the code reference, and "Inspect input and output".
4. **The pop-up**, one per step: for a model call, the parameters, the instructions, the full input as a foldable tree, the response format, the answer and the tokens, side by side as request and response, with "Copy the request as JSON"; for a service call, the request (keys blanked) and a summary of what came back; cache reads as a list of what each one answered; for a code step, what the code checked against. Previous and Next step walk the run without closing it.
5. **What this run ended with**: the asks as the code read them, the final list or answer, a warning for that run if any, and the spend (wall time and model share, calls, tokens, cache reads, live calls).
6. **What the recordings caught**: findings, each with a tag, a one-line claim, two or three sentences, the evidence in numbers, and "Show me", which opens the run at that moment.
7. **Before and after** (optional): the same requests on an earlier version, time, calls, tokens and outcome side by side, with what changed.
8. **Limits** (optional): each budget in code, with a mark where every run landed; red when a run hit it.
9. **How this was recorded**: entry points, commit, data, what was and wasn't part of the runs, total spend.

## Process

### 1. Map the workflow from the code

Read the code, not the docs, and list:
- the **entry points** a request goes through, and which one to call directly
- every **model call**: its name (the response format's name is best), prompt version, reasoning effort and what it decides
- every **outside service** (search, catalogue, scores, payments) and any cache in front of it
- the **code checks and decisions**: filters, validators, "enough?" tests, fallbacks
- the **loops**: retries, "dig deeper", redrafts, agent tool loops, and what ends them
- the **limits**: time budgets, call caps, pool and list sizes, timeouts, with file references

Sketch the state machine from that list: 8–17 boxes, one per thing a reader should see happen. Keep rare paths (fallbacks, conflicts) as dashed exits.

### 2. Pick the runs

Pick 4–8 runs, each answering a question someone has. A good set: an easy request, a hard one that comes up short, one that needs a fact the code can't check, a multi-turn follow-up, a different surface (a group, a scheduled job), and the background job if there is one. When comparing versions, record the same requests on both.

### 3. Get the spend approved

Recording calls the real models. Estimate it before running: about 15–40k input tokens for a simple run, 70k+ for a multi-turn one with retries, plus outside API quotas. Say the estimate, wait for a yes, and report the actual spend afterwards. Record locally against a copy of the data, never against production, and only with test or the owner's own data.

### 4. Record

Write a small driver in the scratchpad, never in the user's repo:

```js
import { install, scenario, save } from '<skill>/scripts/record.mjs';
install({ out: '<scratch>/traces.json', cache: { dir: '/cache/v2/', hashedUrls: true } });
const { runTurn } = await import(pathToFileURL(resolve(repo, 'src/agent.mjs')).href); // after install()
await scenario({ id: 'refund-late', title: 'After 41 days', ask: ['I upgraded last month…'] }, async ({ event, turn }) => {
  const result = await turn(() => runTurn(ticket, { onEvent: event }));   // one turn per message
  return { answer: result.reply };                                          // small: never the whole person
});
await save();
```

- Call `install()` before importing the app: ESM named imports bind at import time, so the app must load the wrapped `fetch`, `readFile` and `createHash`.
- Pass the app's own events to `event()`: stages, items shown as they stream. They give steps their boundaries.
- `turn()` times each message of a multi-turn run and keeps its result (the reply, the final list, counts).
- `services: { search: /help\.example\.com/ }` names hosts; anything matching a model host is recorded in full.
- A cache keyed by hashed URLs needs `cache: { hashedUrls: true }` so each read can say which request it answered.
- When a result your page needs is dropped by a wrapper on its way out (a round that keeps only its own shape), wrap the inner call too and keep what it returned.
- After recording, check every run's counts, tokens and errors, and grep the file for anything key-like (`sk-`, `Bearer`, `AIza`) before going on.

### 5. Build the steps

Run `python3 build_runs.py traces.json data` first: it prints every step name it found and gives a working, plain page. Then write `steps.py` with `build(trace, kit)` returning `(steps, funnels, summary)`. See `reference/example-steps.py`:

- One step per thing the reader should see: "Read the asks", "Gather from every source", "Enough pass?", "Choose and say". Name `st` after its box (or add an alias).
- Give model steps the call's meta line (version, effort, tokens, time) and the one-sentence story of what it decided, quoting the answer.
- Link each step to its calls (`calls: [ids]`): its model call, or the requests and cache reads inside its time window.
- Code steps get `ctx_call`: the model call whose input carries the limits the code checked against (the one that carries this turn's requirements, not last turn's).
- `say` puts what the person saw on the sequence view's first lane; `sub: true` marks items streaming inside a step; `kind: 'cut'` marks a cut-off call; `mark: true` puts a red tick on the track.
- Funnels: headline numbers and stages with an `at` time, so they fill in during playback; reasons only where the code recorded them.

### 6. Write page.js

Write META (words, lanes, service names, short call names, prompt-part labels, the keys code steps show), FLOWS, FINDS, FLAGS, and optionally COMPARE and LIMITS. `reference/example-page.js` has all of them. Layout arithmetic for FLOWS (viewBox 760 wide):
- Columns A, B, C are `{x: 40|290|540, w: 180}`; `box(col, y, h, id, title, sub, kind)`. Rows about 80 apart; boxes 46–54 tall, a diamond 64.
- Titles fit about 20 characters; the mono sub-line about 26.
- Edges are SVG paths: `M380,66 V96` down, `M470,121 H540` across, `M630,146 V203 H470` around. `{ at: 0–1 }` moves the label along the edge, `{ up: true }` stands it upright on a vertical run. Labels near a diamond need `at` past it.
- Add an edge for every move the runs make; the verifier lists the ones you missed.

### 7. Write the findings from the recordings

- Read every run's choices, answers, checks and timings, and write only what the recordings show. Each finding gets a tag (good, bug or waste), a one-line claim, two or three sentences, the evidence in numbers, and a `go` link to the moment.
- Check a suspected cause in the code before writing it down. Run the function on the recorded input if you can (one test caught a title-matching false positive this way). When you know where something happened but not why, say only where.
- A fresh recording is a new set of facts. After any re-record, read everything again: findings from the last recording may not happen this time, and new ones will.
- Put a run-level warning in FLAGS, under that run's answer.

### 8. Assemble and verify

```bash
python3 <skill>/scripts/assemble.py <skill>/template/replay.html page.js data <scratch>/page.html
node <skill>/scripts/verify.mjs <scratch>/page.html <scratch>/verify
```

Fix everything it reports, then look at the screenshots it lists: the loop for every run, the sequence and funnel, a pop-up, the phone page and pop-up, and both themes. One run once the page is complete, the fixes, one confirming run.

### 9. Publish

Publish with the Artifact tool, and republish the same file path to keep the URL. Tell the owner the page now contains the workflow's prompts and the test person's data, so anyone they share it with sees them. Report the recording's spend. Offer the next step the findings point to.

## Data model

The template's DATA block is the reference; in short:

```js
const RUNS = [{
  id: 'refund-late', flow: 'agent', label: 'Refund', title: 'After 41 days', ask: ['…'], you: 'Room',   // you: optional lane name
  total: 8010, calls: 3, tokens: { in: 5735, cached: 1210, out: 391 }, turns: [{ a: 0, b: 8010 }],
  steps: [{ a: 4722, b: 4760, st: 'check', title: 'Policy OK?', meta: '…', body: '…', chips: [{ t: 'within 30 days', k: 'fail' }],
            calls: [], ctx_call: 2, ref: 'policy.mjs checkReply', mark: true }],         // plus fr, sub, kind, say, ctx, draft
  net: [{ i: 2, k: 'llm', name: 'draft_reply', pv: 'reply-v4', a, b, f, model, params: { reasoning, max_output_tokens, format, other },
          prompt: '<key in PROMPTS>', schema: '<key in SCHEMAS>', input: { … }, output: { … }, toolCalls: [], usage: { input, cached, output } },
        { i: 4, k: 'helpdesk', a, b, method: 'POST', host, path, params, sent, status: 201, summary: { … } },
        { i: 1, k: 'cache', s: 'search', a, b, hit: true, asked: '/api/search?q=…', summary: { … } }],
  events: [{ k: 'llm', a, b, n: 'draft_reply', c: 2, tin, tc, tout, o: '→ answer' }, { k: 'cache', s, a, b, n: 3, miss: 0 }],
  funnels: [{ a, b, stats: [{ n, label, at, cls }], stages: [{ lab, n, at, sub, chips }], away: { at, title, list: [{ reason, count, examples }] }, note }],
  summary: [{ h: 'Reply sent', text: '“…”', flag: true }, { h: 'Final list · 5', items: [{ t, y, dots: [['Funny', 'strong']] }] }],
}];
```

## Principles checklist

- [ ] **Real runs only.** Every step, number and quote comes from a recording. Nothing is drawn as an example or estimated without saying so.
- [ ] **Every step opens its calls.** A model call shows its whole request and answer; a service call its request and what came back; a code step what it checked against.
- [ ] **Three linked views, one clock.** Loop, sequence and funnel always show the same moment; any click jumps the clock there.
- [ ] **Colour says who does the work**: model, app code, outside data. Same colours in every view and the pop-up.
- [ ] **Findings link to moments** and quote numbers. Causes are checked in code; open findings say "Open".
- [ ] **Numbers in prose match the data.** Re-read counts and times after every rebuild.
- [ ] **Secrets stay out**: headers are never recorded, key-like fields are blanked, and the trace is grepped before publishing.
- [ ] **Instructions and schemas appear once** (PROMPTS, SCHEMAS by hash), not once per call.

## Anti-patterns

A real build of this page hit each of these:
- **Recording only the sizes of the input** ("24 rated, 54 seen"). The owner asked what was sent; the only fix was a full re-record. Record full request bodies from the start.
- **Carrying findings over to a new recording.** Two of five findings didn't happen again. Re-read after every recording.
- **Naming a cause you didn't check.** Say where it happened; check why in code before saying why.
- **A pop-up body that squeezes instead of scrolling.** A flex column with `min-height: 0` and `overflow: auto` on the body, `flex: none` on its children.
- **Labels on boxes and captions wider than boxes.** The verifier measures both; fix the data, not the engine.
- **Screenshots taken mid-transition.** Wait for colour transitions before judging a theme.
- **A wrapper that drops what the page needs.** Wrap the inner call too.
- **Context taken from the wrong call.** On a first message, an ideas call has no requirements yet; the choosing call does.

## Verification recipe

`node scripts/verify.mjs <page.html> <out-dir>` needs Node 22+ and Chrome or Chromium (`CHROME=/path` if not found). It writes only into `<out-dir>`. It:
1. checks the Artifact contract on the fragment (title, no doctype/html/body, allowed hosts, no alert, reduced motion);
2. checks the data: every step lands on a box, every call it names exists, prompts and schemas resolve, findings point at real moments, and the moves with no edge drawn (as notes);
3. draws each run's loop and measures box text and edge labels against boxes;
4. opens every run in every view and steps through every step;
5. opens every step's pop-up and checks for empty pop-ups, clipped cards and sideways scrolling, and that clicking a box opens one;
6. renders dark and light, then a 390px phone page and pop-up;
7. collects console errors throughout.

It exits 1 on any issue. Then look at the screenshots.

## Artifact contract reminders

- Load `artifact-design` before writing the page; it holds the full contract.
- The page is a fragment: `<title>` first (2–4 words), the Google Fonts link, the style, the markup, one script. No doctype, html, head or body.
- Allowed hosts only. The template needs nothing but Google Fonts.
- Every colour is a token with a light and a dark palette; keep both.
- The page never scrolls sideways at 390px; the loop, sequence and tables scroll inside their own boxes.
- Toggle visibility with `hidden` (the skeleton forces `[hidden]` to `display: none`), never `style.display`.
- A page with full recordings runs 1–2 MB; that is fine (the limit is 16 MB).
- Read the whole file before publishing. Republish the same path to keep the URL; pass `icon` only on the first publish.
