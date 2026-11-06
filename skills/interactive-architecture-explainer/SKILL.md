---
name: interactive-architecture-explainer
description: "Build an interactive architecture or workflow explainer page (an HTML Artifact) that a product owner or other non-builder can review with ease. It has one SVG diagram with tinted regions for live, background, follow-up and on-demand work that hand off through shared stores, scenario buttons that play one path step by step, a side panel with plain-language steps and tiny concrete examples, then the decisions the reviewer needs to make. Use it whenever someone wants to see, review, explain or compare how the parts of any system talk to each other (payments, data platform, ML pipeline, app backend), for example 'show me the architecture', 'diagram this workflow for review', 'explain how the pieces talk', 'walk me through the data flow', 'make an interactive system diagram' or 'compare the current and proposed design', even when they do not say interactive. Not for charts or dashboards of numbers, UI mockups, a short linear process where a list or a mermaid diagram is enough, or replaying real recorded runs of an AI workflow with each call's input and output (use workflow-trace-replay for that)."
---

# Interactive architecture explainer

Build one page that lets a product owner, or anyone who didn't build the system, see how it works by clicking through it. It has one diagram with a region for each kind of work, a few scenarios that light up one path at a time, and a side panel that explains each step in plain words with a tiny concrete example. The decisions the reviewer needs to make come after. It ships as a claude.ai Artifact (an HTML page) and works for any system: a payments pipeline, a data platform, an ML workflow, a mobile app backend.

The page shows more than it tells. A reviewer should answer "what happens when X?" by pressing a button and watching, not by reading paragraphs.

## When to use it

Use it when someone wants to:
- review a system design, data flow, pipeline or workflow ("show me the architecture", "how do the pieces talk?", "diagram this for review")
- get onboarded onto an architecture: what runs when, who waits on what, where data lives
- compare the current design with a proposed one. Status marks show what's built, changing or new, and scenarios walk the new paths.
- make a decision about a system after seeing the mechanism

Don't use it when:
- the process is a straight line with no hand-offs and no parallel kinds of work. Write a short numbered list or a mermaid flowchart instead (Artifacts render mermaid natively).
- the ask is a chart of numbers or a dashboard (use the dataviz skill), a UI mockup, or a sequence or class diagram for engineers only
- the answer is one sentence ("does checkout call the cache?")

## Files in this skill

| File | What it is | When to open it |
|---|---|---|
| `template/explorer.html` | A working page for a small "order checkout" system: 10 boxes, 12 lines, 3 scenarios, plus the sections under the diagram. | Always. Copy it and replace the data. |
| `scripts/verify.mjs` | Renders the page in headless Chrome, clicks every step and box, checks overlaps, overflow, themes, keyboard, motion and console errors, and saves screenshots. | Step 7. |
| `reference/research-notes.md` | The presentation research behind these rules, with links. | When the domain is unusual, or the reviewer questions the format. |

Before writing the page, load the `artifact-design` skill; the Artifact tool requires it. This skill adds to it. Where the two differ on checking the page, see step 7.

## The page, top to bottom

1. **Header.** A meta line (system · what this page is · date), the page name, a 2–3 sentence summary that states the main idea in the reader's words, and a jump link such as "2 decisions need you".
2. **Explorer**, the centre of the page: a row of scenario buttons, then the diagram with a side panel.
   - Diagram: tinted regions by kind of work; shared stores drawn as cylinders in a middle band; outside services in a dashed box; a small status mark on every box; a label on every line; solid lines where someone waits, dashed where nobody does.
   - Panel at rest: what to do, the legend, keyboard hints. During a scenario: the lane tag, "Step N of M", the step title, 1–2 sentences, Reads/Writes chips naming stores, an Example box, a clickable step list, and Back / Play / Next / Reset. After a click on a box: what it is, what it holds (with an example), who can see it, and its status.
3. **One to three compact visuals** for questions the diagram can't answer: a funnel drawn as rows (what goes in, what stops and why, what comes out), tap-to-explain chips (what each state or answer means), a who-sees-what matrix. Include only the ones the reviewer needs.
4. **Decisions.** Open ones as cards, settled ones as quiet rows (see the checklist).
5. **For builders.** A muted appendix: table and field names, limits, retry rules, file:line references. Implementation detail lives here so the diagram and panel can stay plain.

The shape follows the martini-glass pattern: a guided stem first (the summary, then Play), then open exploration (any box, any step).

## Process

### 1. Extract the facts

Read the code, docs or conversation, and list:
- **Components** (things that run), **stores** (things that hold data: tables, queues, caches, buckets, topics) and **outside services**.
- The **kind** of each piece of work: live (someone is waiting), background (runs on its own after something happens), later follow-up (scheduled, hours or days later) or on demand (runs only when someone asks).
- Every **hand-off**: who reads or writes what, and whether the caller waits.
- The **status** of each part: built, changing or new.

Write these straight into the data model below before designing anything. Reviewers trust the diagram, so mark anything uncertain and ask about it rather than guess.

### 2. Pick 3–7 scenarios

One scenario answers one question the reviewer actually has, named in their words: "Place an order", "What runs overnight", "Refund a payment". Take them from the reviewer's recent questions, the open decisions and the riskiest path. Give each 3–7 steps, and cover each kind of work at least once. A few good scenarios beat an exhaustive set.

### 3. Research presentation when the domain is unusual

If the system doesn't fit live, background and stores (a streaming topology, a multi-tenant control plane, an on-device ML loop), spend ten minutes on how good teams draw that kind of system before inventing a layout. Look at official docs and well-known engineering write-ups for the domain, note 3–5 takeaways, and adapt the lane grammar rather than replace it. `reference/research-notes.md` has the general sources.

### 4. Lay out regions by kind of work

- Put live work on top, shared stores in the middle band, and background, later follow-up and on-demand work side by side at the bottom. Outside services go on the right in a dashed box.
- Draw only the kinds of work the system has, 3–7 regions in all. Don't invent a lane to fill the grammar.
- Put each box above or below the stores it touches most, so lines stay short and mostly vertical.
- Aim for 8–16 boxes. Merge boxes the reviewer would never tell apart.

The lanes map onto most systems:

| System | Live | Background | Later, scheduled | On demand |
|---|---|---|---|---|
| Payments | card authorisation | capture, webhooks | nightly settlement | refunds, disputes |
| Data platform | dashboard queries | ingestion jobs | nightly rebuilds | backfills, exports |
| ML workflow | inference requests | feature updates | weekly retraining | evaluation runs |
| Mobile backend | app API calls | push notifications | daily digest | admin exports |

Layout arithmetic for the template's viewBox (1080 wide; set `H` to fit, usually 520–600):
- Use 16px outer margins and 16px gaps between regions. A region holding one row of boxes is about 130–140 tall. Put a top region's name at its top left and a bottom region's name at its bottom left, clear of the boxes.
- Components are 56 tall, stores 68 and outside boxes 52–56. Leave at least 40px between boxes in a row, and about 50px between rows so lines have room to curve.
- A box name at 14px takes about 8px per character. A 180-wide box fits about 18 characters beside its status mark.
- To add a kind of work, give it an id in `REGIONS` and `LANE_NAME`, three tokens (`--lane-<id>`, `--lane-<id>-line`, `--lane-<id>-ink`) in each of the three theme blocks, and two CSS rules (`.rg-<id>` and `.lt-<id>`), copying an existing lane.

### 5. Write plain-language copy

- Name things by what people recognise: "Orders", not `orders_v2`; "Job queue", not "SQS"; "Card processor", not "PSP". Code names go in the box panel's small print and the appendix.
- Write each step as who does what, and what the reader would notice. Use the active voice and the present tense.
- Give every step and every box a tiny example with real-looking values: a name, an amount, a time, a count.
- Use one running example (the same person, the same order) through every scenario, panel and visual. The reader then follows one thing through the whole system.
- Read each panel as the reviewer would. If a word needs explaining, change the word.

### 6. Build

Copy `template/explorer.html` into the scratchpad (not the user's repo, unless they ask for a file there). Replace, in this order:
1. the `<title>` and header
2. `LANE_NAME` and `REGIONS`
3. `NODES`, with coordinates on the grid
4. `EDGES`
5. `SCENARIOS`
6. the sections under the explorer and the appendix

Delete any section the reviewer doesn't need. Keep the element ids and the `window.__explorer` test hook: the verifier needs them, and the hook exists only on `file://` pages, never on the published one.

### 7. Verify

Run `scripts/verify.mjs` (see the recipe below), fix what it reports, then look at the screenshots it lists. The `artifact-design` default is a single look before publishing. For this page type the user wants the scripted pass instead, because its failures (a label on top of a box in step 4 of one scenario) appear only in states you reach by clicking. Keep it bounded: one run once the page is complete, the fixes, then one confirming run.

### 8. Iterate with the reviewer

Publish, share the link, and ask the reviewer to play two scenarios and say what they still can't answer. Map each kind of feedback to the layer it points at:
- "What do I understand from this?" means there's no clear main idea. Rewrite the summary and rebuild the scenarios around their questions.
- "Too busy" means too many boxes or labels. Merge boxes, and keep labels for hover and lit steps.
- "Is it 1999?" is about the visual style. Fix the type and chrome, not the content.
- "What does X mean?" means rename X.

Republish the same file path to keep the URL.

## Principles checklist

- [ ] **Layout grammar.** Regions by kind of work: live on top, stores in the middle band, work nobody waits for below, outside services on the right. Colour marks the region; position and labels carry the meaning.
- [ ] **Every hand-off between kinds of work goes through a store.** A queue or a topic counts as a store. If the real system makes a direct call across lanes, draw it and flag it (status "changing", or a decision) instead of hiding it. The diagram must be true.
- [ ] **Solid means the caller waits; dashed means nothing waits.** Say so in the legend in words ("someone is waiting", "runs on its own"). Don't rely on notation the reader has to know.
- [ ] **Status marks** on every box: built, changing, new. They differ in shape as well as colour (circle, half circle, diamond), so they still read for colour-blind readers and in greyscale.
- [ ] **Every line has a label** that says what moves along it: "new order", "receipt", "charge · yes or no". Never "uses", "calls" or "data". Lines go one way; use `bi` only for a real read-and-write pair, or a call and its answer.
- [ ] **One path lit at a time.** The current step is bright, with arrowheads in this step's direction. Visited steps are grey with number badges, the rest of the scenario is at 45%, and everything else is dimmed, including unused regions.
- [ ] **A concrete example in every panel**, for each step and each box.
- [ ] **A glossary only if unavoidable.** First try renaming. If a product term must stay, define it once in that box's "what" line.
- [ ] **Decisions are concrete options with a recommendation.** Each has:
  - an id (D1) and a one-line question
  - 1–2 sentences of context
  - a small picture if the difference is visual
  - options A and B, each with an example, and the recommended one marked
  - "Why A" in one sentence
  - the exact reply to send ("Reply 'D1: A'")

  Settled decisions stay as quiet rows, so the reviewer can see their answers were applied.
- [ ] **Implementation detail goes in the appendix**, muted and at the bottom.
- [ ] **Text budget:**

| Element | Budget |
|---|---|
| Summary | 2–3 sentences |
| Box name, sub-line | 1–3 words, up to 5 words |
| Line label | 1–4 words |
| Step title, text, example | 2–5 words, 1–2 sentences (under 40 words), under 15 words |
| Box panel fields | one short sentence each |
| Caption under the diagram | 1–2 sentences |

## Anti-patterns

A real reviewer rejected pages that did these things ("What do I understand from this?", "is it 1999?"):
- **Walls of text in boxed lists.** Cards full of bullets make the reader assemble the system in their head. Lead with the picture and put the detail beside it, one step at a time.
- **Builder jargon instead of the reader's words.** This covers internal model terms (the rejected pages said "arms", "impressions", "surfaces", "eligibility" and "hypotheses"), table names, acronyms and infrastructure words (idempotent, fan-out, TTL, DLQ). Test each word: would the reviewer say it out loud about their own product?
- **An overview with ~20 boxes and crossing arrows.** Keep to 8–16 boxes and let the scenarios carry the detail.
- **A step flow written as rows of Reads/Writes text.** Animate the path on the diagram instead. Reads and Writes become small chips next to one sentence.
- **A dated look:** condensed uppercase headings, typewriter mono labels, gimmick headers such as a "camera slate" or a fake blueprint. Use one clean sans in sentence case. Keep mono for data values in small pills and for code names.
- **Organising the page around database tables.** Name scenarios by what people do, and stores by what they hold, in the reader's words. Table names go in small print.
- **Drawing sync and async work the same way.** The reviewer can't see what's slow or who waits. Use separate regions and solid versus dashed lines.
- **Labels everywhere at rest.** They collide and bury the structure. Show labels on hover and on lit steps only.
- **Motion as decoration.** No zooms, camera moves or pulsing. Move one token along the real lines, and only where order matters.
- **Hijacking scroll or keys.** Arrow keys work only while focus is inside the explorer.

## Data model

The template's script has one DATA block, and everything after it is engine. This excerpt from the checkout example shows the fields. Coordinates are in viewBox units.

```js
const REGIONS = [   // tinted areas; ids double as lane ids and CSS hooks (.rg-<id>, .lt-<id>)
  { id: "live", x: 16, y: 16, w: 848, h: 140, name: "Live", when: "while the shopper waits", at: [32, 40] },
  { id: "band", x: 16, y: 206, w: 848, h: 140, name: "Shared\nstores", at: [30, 258], cap: ["every hand-off", "goes through", "one of these"] }
];                  // the template's ids: live, bg, later, demand, band (stores), outside

const NODES = {
  checkout: {
    kind: "comp",                 // "comp" runs, "store" holds data (a cylinder), "ext" is an outside service
    lane: "live",                 // the region it sits in
    x: 470, y: 64, w: 190, h: 56, // components 56 tall, stores 68, outside boxes 52–56
    name: "Checkout", sub: "cart, address, pay",   // stores use lines: ["Job", "queue"] instead of sub
    status: "changing",           // "built" | "changing" | "new"
    what: "Takes the shopper from cart to a paid order.",
    holdsLabel: "Uses", holds: "Mug ×1, socks ×2, $42.50, card ending 4242.",
    who: "The shopper. Support sees the finished order, never the card.",
    statusText: "Changing. Stock and receipts move to the worker."
    // code: "orders"             // optional: its name in the code, shown in small print
  }
};

const EDGES = [     // a → b is the way data moves
  { id: "checkout_orders", a: "checkout", b: "orders", label: "new order" },
  { id: "jobs_worker", a: "jobs", b: "worker", async: true, label: "next job" },                  // dashed
  { id: "checkout_cards", a: "checkout", b: "cards", bi: true, route: "h", label: "charge · yes or no" }
];                  // route: "h" side to side, "over" up and across (optional y), "side" up the right margin (optional x)

const SCENARIOS = {
  order: { name: "Place an order", tag: "Live", title: "Sam places an order", lane: "live", steps: [
    { title: "Charge the card",
      text: "Checkout asks the card processor to charge the card and waits for a yes or no.",
      io: [["Sends to", "cards"]],                          // chips: a verb and a box id
      example: "$42.50 on the card ending 4242 → approved in 1.2 s",
      edges: [["checkout_cards", "b", "$42.50 → approved"]] // "f" a→b, "r" b→a, "b" there and back; optional label
      // nodes: ["checkout"]  lights a box when the step happens inside it
      // lane: "bg"           when this step runs in another kind of work
      // note: "…"            an optional footnote
    }
  ] }
};
```

The sections under the explorer are plain HTML. The chips keep each explanation in a `data-detail` attribute, so you can delete any of those sections without touching the script.

## Implementation notes

The template's engine already does all of this. These notes explain why, for when you need to change it.

- **SVG and vanilla JS, no libraries.** Artifacts load scripts only from cdnjs.cloudflare.com, cdn.jsdelivr.net/npm, unpkg.com, cdn.tailwindcss.com and code.jquery.com, and stylesheets only from Google Fonts. Everything else is blocked without an error. Layout libraries don't know the lane grammar anyway. Hand-placed SVG gives exact ports, labels and motion in about 450 lines, with nothing to load.
- **Theme tokens.** Every colour is a custom property on `:root`. SVG parts get classes that read tokens (`.edge .line { stroke: var(--edge) }`), and state classes (`is-current`, `is-visited`, `is-pending`, `is-dim`) only swap tokens and opacity. The template is dark first. Its light palette sits under `prefers-color-scheme: light`, guarded by `:root:not([data-theme="dark"])`, and is repeated under `:root[data-theme="light"]`.
- **Ports.** `assignPorts()` groups line ends by box side (top and bottom, or left and right for `route: "h"`), and sorts each group by where the other end is. It spreads them up to 26px apart, keeping 20px from the corners. Lines leaving one side then fan out in order instead of stacking. On a store, ports sit on the cylinder's curved lid or base.
- **Routing.** By default a line is a vertical cubic curve between ports, with control points 55% of the gap above and below each end, so it reads as a soft S. Per-line overrides: `"h"` runs side to side in one row, `"over"` goes up and across when a box is in the way, and `"side"` leaves the right side and climbs the margin to the outside box. When a curve cuts through a box, move a box or add an override. Don't hand-draw bends.
- **Label placement.**
  - Labels show on hover at rest, and on the current step's lit lines with the step number inside. Visited lines show only a number badge.
  - There are 23 candidate spots along each path, middle first (t = 0.5, 0.46, 0.54 … 0.06, 0.94). Each is scored: overlap with boxes and region text ×10, overlap with placed labels ×20, points of other lit lines under it ×60, plus a small penalty for distance from the middle.
  - Up to 3 labels in one step are placed jointly (a small branch-and-bound over their candidates), so one label can't take another's only clear spot. More than 3 are placed one by one.
  - A label that still collides falls back to its number badge; the panel carries the full text.
  - Obstacles are measured again after the web fonts load, because text widths change.
- **Token animation.** One dot with a soft halo per lit line, moved along the real path with `getPointAtLength`. It eases in and out (cubic) over 0.7–1.3 s, depending on length. A two-way step goes out and back. Autoplay stays on a step for max(4.2 s, animation + 1.8 s, 230 ms per word), so reading time sets the pace.
- **Reduced motion.** Under `prefers-reduced-motion: reduce`, picking a scenario doesn't start autoplay, and there are no tokens or CSS transitions. Lit paths, badges and labels still show, so the still frame carries the meaning. The page also listens for the setting changing.
- **Keyboard and screen readers.**
  - Boxes are `<g role="button" tabindex="0">` with an aria-label (name, lane, status); Enter or Space opens the panel.
  - The arrow-key listener sits on the explorer section, not the document, and ignores the step list. Esc resets.
  - Step content is in an `aria-live="polite"` region.
  - The SVG is `role="group"` with a `<title>` and `<desc>`. Don't use `role="img"`: it would hide the interactive boxes.
- **State.** There are three modes: rest, scenario (id and step), and node (id, plus the step to go back to). Every render clears all state classes and recomputes them from `state`, so Back, Next and jumps can't leave stale highlights.

## Verification recipe

```bash
node <skill>/scripts/verify.mjs <scratch>/page.html <scratch>/verify
```

It needs Node 22+ and Chrome or Chromium (set `CHROME=/path` if it isn't found). `--width=` and `--height=` change the desktop size (default 1440 × 1000). It writes only into the output folder. Keep the page copy and any helper scripts in the scratchpad, never in the user's repo.

What it does:
1. **Wraps the fragment** in a skeleton like the publish skeleton (doctype, charset, viewport and the same small reset). It checks the contract: a 2–4 word `<title>`, no html/head/body, allowed hosts only, no alert/confirm/prompt, and a reduced-motion rule.
2. **Checks the data:** every line, step and chip points at a real box, the panel fields are filled, and the text budget holds.
3. **At rest:** runs the overlap checks, shows the hover label for every line, and renders light and dark. Any text colour that stays the same in both is flagged, because it's a literal instead of a token.
4. **Every scenario step:** clicks the real button, then Next, and at each step runs the overlap checks, checks the "Step N of M" count and panel overflow, and takes a screenshot.
5. **Every box, then the keyboard, motion and phone width.** Arrow keys must step only inside the explorer, Esc must reset, and Enter must open a box. A token must move and autoplay must advance. At 390px the page must not scroll sideways.
6. **Console errors** throughout.

The overlap checks look for:
- text on text
- labels on boxes, on other labels, on region text, or outside the drawing
- box text wider than its box, or touching its status mark
- boxes on region text
- visible lines through box or region text
- lines through boxes they don't connect
- lit lines running under another line's label

The script reports each issue once, under the first state where it appears, and exits 1 if there are any. Then open the screenshots it lists: rest, the last step of each scenario, one box panel, and both themes. The script catches geometry; only looking catches "this reads badly".

## Artifact contract reminders

- Load `artifact-design` before writing the page. It holds the full contract; these are the parts this page type tends to trip on.
- The page is a fragment: no doctype, html, head or body. Put `<title>` first (a 2–4 word name, never "Name: explainer"), then the Google Fonts `<link>`, then the `<style>`.
- Use allowed hosts only: scripts from the five CDNs above, stylesheets from fonts.googleapis.com. The template needs nothing but Google Fonts.
- Make every colour a token. A dark-only page is fine when the user asks for one (delete the two light blocks); otherwise keep both palettes.
- Keep a side gutter of at least 16px (`padding-inline` on body). The diagram and wide tables scroll inside their own `overflow-x: auto` boxes, and the page body never scrolls sideways at about 400px.
- Make it readable at rest: the diagram, legend and first panel show without any interaction, and nothing waits at `opacity: 0` for a scroll.
- Don't use alert/confirm/prompt dialogs. Toggle visibility with `el.hidden`, because the skeleton forces `[hidden]` to `display: none`.
- Read the whole file before publishing. Republish the same file path to keep the URL, and pass `icon` (for example "diagram") only on the first publish.
