// A worked page.js: the template's help-desk agent (one state machine with a redraft loop, findings,
// a warning, a before/after table and limits). assemble.py adds RUNS, PROMPTS and SCHEMAS from
// build_runs.py; box() and the columns A, B and C come from the template.
// The page's words and the sequence view's lanes. Lane ids match event kinds: 'llm' for model
// calls, 'cache' for cache reads, any other id for an outside service (the `k` of its calls).
const META = {
  title: 'Support Agent Replay',
  eyebrow: ['Help desk agent', 'main at 1a2b3c4', '2 runs recorded 11 Oct 2026', 'model-x'],
  thesis: 'Two support tickets, recorded call by call and played back. **The model drafts; code checks every reply against the refund rules.** Pick a run, press Play, and click any box to see what it sent and what came back.',
  findsNote: 'Read straight from the recordings. Each one opens the run at the moment it happens.',
  app: { name: 'Help desk app' },
  lanes: [
    { id: 'you', name: 'Customer', sub: 'ticket' },
    { id: 'code', name: 'App', sub: 'server code' },
    { id: 'llm', name: 'OpenAI', sub: 'model-x' },
    { id: 'search', name: 'Search', sub: 'help center', color: 'data' },
    { id: 'helpdesk', name: 'Help desk', sub: 'API', color: 'web' },
    { id: 'cache', name: 'Cache', sub: '1-day store' },
  ],
  services: { llm: { name: 'OpenAI' }, search: { name: 'Help-center search' }, helpdesk: { name: 'Help desk API' } },
  callNames: { classify_ticket: 'classify', draft_reply: 'draft' },
  ctxLabels: { ticket: 'ticket', customer: 'customer', articles: 'articles', intent: 'intent', fix: 'fix note' },
  contextKeys: ['intent', 'fix'],
  recorded: [
    'Each run called the agent’s own entry point locally on main at 1a2b3c4, with a test customer and a warm one-day search cache. A wrapper timed every OpenAI, search and help desk request and every cache read.',
  ],
};

// One state machine per kind of run. Boxes sit on a 760-wide grid (columns A, B, C); each edge is
// [id 'from>to', SVG path, label, dashed, { at, up }].
const FLOWS = {
  agent: {
    h: 506,
    regions: [{ x: 16, y: 84, w: 728, h: 256, label: 'AGENT · 30 S BUDGET' }],
    nodes: [
      box(B, 20, 46, 'in', 'Ticket in', 'from the help desk', 'code'),
      box(B, 96, 50, 'classify', 'Classify', 'triage-v2 · low', 'model'),
      box(C, 96, 50, 'search', 'Search help center', 'top 5 articles', 'data'),
      box(B, 176, 54, 'draft', 'Draft the reply', 'reply-v4 · medium', 'model'),
      { id: 'check', x: 290, y: 262, w: 180, h: 64, title: 'Policy OK?', sub: 'refund rules', kind: 'code', diamond: true },
      box(A, 268, 52, 'fix', 'Note what to fix', 'code tells the model', 'code'),
      box(B, 356, 50, 'send', 'Send the reply', 'help desk API', 'data'),
      box(B, 436, 50, 'save', 'Log the ticket', 'tokens · outcome', 'code'),
    ],
    edges: [
      ['in>classify', 'M380,66 V96'],
      ['classify>search', 'M470,121 H540', 'intent'],
      ['search>draft', 'M630,146 V203 H470', '5 articles'],
      ['classify>draft', 'M380,146 V176'],
      ['draft>check', 'M380,230 V262'],
      ['check>fix', 'M290,294 H220', 'no'],
      ['fix>draft', 'M130,268 V203 H290', 'redraft', false, { at: 0.2 }],
      ['check>send', 'M380,326 V356', 'yes', false, { at: 0.75 }],
      ['send>save', 'M380,406 V436'],
    ],
    alias: {},
  },
};

// Findings, read from the recordings only. go: [run id, view, time in ms].
const FINDS = [
  { sev: 'good', tag: 'Caught', title: 'The policy check stopped a refund the rules don’t allow', body: 'The first draft promised a full refund 41 days after purchase. Code checked it against the 30-day rule, turned it back with a fix note, and the second draft offered account credit.', ev: 'After 41 days: draft 1 fails “within 30 days”, draft 2 passes', go: ['refund-late', 'loop', 4722] },
  { sev: 'waste', tag: 'Input', title: 'The first draft never sees the refund rule', body: 'The draft’s input has the ticket and five articles but not the purchase rule code checks it against, so a late refund always costs a second draft.', ev: 'After 41 days: redraft 2.9 s and 2,735 input tokens', go: ['refund-late', 'seq', 4785] },
  { sev: 'good', tag: 'Speed', title: 'A repeated search costs nothing', body: 'The same query ran an hour earlier, so the five articles came from the cache in 2 ms instead of a 0.3 s live search.', ev: 'After 41 days: 1 cache hit, 0 live searches', go: ['refund-late', 'seq', 1325] },
];
// One warning per run, shown under its final answer.
const FLAGS = {
  'refund-late': 'The first draft promised a refund the rules don’t allow; only the policy check caught it.',
};
// Optional: the same requests on an earlier version (null hides the section).
const COMPARE = {
  title: 'Before and after, the same tickets',
  note: 'reply-v3 (2 Oct) beside reply-v4, same tickets, same cache.',
  cols: ['reply-v3 · 2 Oct', 'reply-v4 · 11 Oct'],
  rows: [
    { label: 'Within 30 days', ask: 'T-1042', before: { total: 6900, calls: 2, tin: 3810, out: '1 reply' }, after: { total: 5230, calls: 2, tin: 3022, out: '1 reply' }, why: 'Shorter instructions.' },
    { label: 'After 41 days', ask: 'T-1057', before: { total: 11800, calls: 4, tin: 8950, out: '1 reply', bad: '2 redrafts' }, after: { total: 8010, calls: 3, tin: 5735, out: '1 reply' }, why: 'The fix note names the rule.' },
  ],
  foot: 'Totals for the two tickets.',
  changes: [{ h: 'A fix note, not a retry', p: 'A failed check now tells the model which rule it broke.', code: 'agent.mjs fixNote' }],
};
// Optional: budgets in code and where each run landed (null hides the section).
const LIMITS = [
  { n: 'Turn time', code: 'AGENT_BUDGET_MS 30 s', cap: 30000, unit: 'ms', hitAt: 29000, pts: [['refund-simple', 5230], ['refund-late', 8010]], e: 'Both tickets finished well inside it.' },
  { n: 'Redrafts', code: 'MAX_REDRAFTS 2', cap: 2, unit: 'n', hitAt: 2, pts: [['refund-simple', 0], ['refund-late', 1]], e: 'One redraft, for the late refund.' },
];
