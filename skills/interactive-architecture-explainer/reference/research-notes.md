# Research notes

Why the explainer looks and behaves the way it does. Each note gives the source, the takeaway, and where the skill applies it. Read this when a domain doesn't fit the lane grammar, or when a reviewer questions the format.

## How the format was found

Two earlier pages for the same system were rejected by the product owner. The comments were "What do I understand from this?" and "is it 1999?". Those pages had:
- walls of text in boxed lists
- builder jargon ("arms", "impressions", "surfaces", "eligibility", "hypotheses")
- an overview of about 20 boxes with crossing arrows
- a step flow written as rows of Reads/Writes text
- a dated look: condensed uppercase headings, typewriter mono labels, a "camera slate" header
- sections organised around database tables
- sync and async work drawn the same way

The third page was accepted. It came from researching how good teams present architecture before designing anything, and it has:
- one interactive diagram at the top, showing more than telling
- plain words throughout
- separate lanes for live, background, follow-up and on-demand work, joined only through shared stores
- scenario playback that highlights one path at a time
- a tiny concrete example in every panel
- verification done by rendering the page and clicking through every scenario

## Sources and takeaways

### C4 model notation
https://c4model.com/diagrams/notation

- Every diagram has a title and a legend (a key) that explains shapes, line styles and colours.
- Every element states its type and gives a one-line description.
- Every line is one-directional and carries a specific label that matches its direction ("sends receipt", "reads stock"), never a vague "uses".
- The picture should stand on its own, without a narrator.

In the skill: the legend in the resting panel, each box's sub-line and "what" line, labelled lines, and the data check that flags vague labels.

### Sequence diagrams: solid and dashed
Common practice in sequence and architecture diagrams draws a synchronous call (the caller waits) as a solid line and asynchronous work as a dashed line. Strict UML marks async messages with an open arrowhead and uses dashes for replies, so readers bring different habits.

In the skill: solid versus dashed, stated in words in the legend ("someone is waiting", "runs on its own"), plus separate regions, so the reader never has to know the convention.

### Swimlanes
Swimlanes exist to show hand-offs between actors or kinds of work. About 3–7 lanes is the practical range; more and the reader loses track of which lane is which.

In the skill: regions by kind of work (live, background, later follow-up, on demand, plus the store band and the outside box), capped at 3–7, and hand-offs drawn through stores.

### Animating diagrams
- Animate only where order matters.
- Move the signal along the real connectors instead of flying things around.
- Highlight the active part and dim the rest.
- Answer one question per scenario.
- No camera moves or zooms.

In the skill: one token per lit line moving along its actual path, current and visited styling, dimming, and one reviewer question per scenario.

### Click-through architecture diagrams
Tools that play flows over an architecture diagram tend to share one pattern:
- named flow tabs
- play, pause and step controls
- visited steps styled differently from the active one
- a side panel that shows what the current step carries

In the skill: scenario buttons, Back / Play / Next / Reset, number badges on visited lines, and the step panel with Reads/Writes chips and an example.

### The martini-glass narrative
Segel and Heer, "Narrative Visualization: Telling Stories with Data" (2010): http://vis.stanford.edu/files/2010-Narrative-InfoVis.pdf

A martini-glass story starts with a short author-driven stem (a guided path), then opens into reader-driven exploration.

In the skill: the summary and Play are the stem. Clicking any box or step list item, and the sections below, are the open glass.

### Explorable explanations
Bret Victor, "Explorable Explanations" (2011): https://worrydream.com/ExplorableExplanations/

A reader learns by acting on the example, with the page steering attention to one thing at a time.

In the skill: one lit path, one step at a time, with everything else dimmed; each box answers "what is this, what does it hold, who sees it" when clicked.

### ByteByteGo-style system diagrams
Numbered steps on the drawing, very few words on the drawing itself, and the detail placed beside it.

In the skill: number badges on lines, short labels in the diagram, and sentences only in the side panel.

### Nicky Case on explorables
Start with a concrete experience before the abstraction.

In the skill: a named persona and one running example (the same order through every scenario), and an example box on every step and every box.

### Scrollytelling practice
- Keep the meaning in real text, not only in the animation.
- Give reduced motion a static fallback that still carries the meaning.
- Never hijack the page's scroll or keys.

In the skill: the aria-live step panel, lit paths and badges that work with no motion, no autoplay under reduced motion, and arrow keys handled only inside the explorer.
