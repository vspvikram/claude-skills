# Research notes

Why the replay looks and behaves the way it does. Read this when a workflow doesn't fit the format, or when the reader questions it.

## How the format was found

It was built for an owner who wanted to "know the engine cold": how a recommendation agent (model calls, catalogue and score lookups, a search for more candidates, and a judge) behaves on real requests. Four rounds, each driven by the owner's questions:

1. **Replay real runs, not an imagined flow.** The owner chose recorded runs over a drawn design, and three linked views over one picture. The first recordings caught defects no static diagram would show: a reply describing a different list, retries re-proposing rejected items, model time at 94–99% of the wall clock.
2. **Old engine beside the new.** After a rebuild, the same requests were recorded again and set side by side (time, calls, tokens, outcome). The table showed where the new engine was faster and where it was slower, run by run.
3. **"What context is sent to the LLM in each call?"** Only the sizes of each input part had been recorded, so the answer needed a full re-recording. Every step then opened a pop-up with the request and the response. The owner's reaction: "I like the way I can see the internal of each step of the workflow."
4. **Findings had to be re-read.** The re-recording changed the facts: two earlier findings didn't happen again, and two new problems showed up (a second choice that forgot the first, a common word matched as an item's title). Every finding is now read from the current recording, and its cause is checked in code.

## Sources and takeaways

### State machines for agent loops
GMI Cloud, AI agent workflow diagram guide: https://www.gmicloud.ai/en/blog/ai-agent-workflow-diagram-guide

- A loop drawn as a forward-only flowchart hides the retries and failure paths, which are where agents misbehave.
- Draw states and transitions, with the retry and exit paths visible.

In the skill: the Loop view is a state machine; ×N counts show repeat visits, dashed boxes are rare exits, and the verifier lists moves the drawing has no edge for.

### Traces with timing
Langfuse timeline: https://langfuse.com/changelog/2026-08-28-responsive-timeline · tracing tools overview: https://www.braintrust.dev/articles/best-llm-tracing-tools-2026 · LangSmith and Phoenix work the same way.

- LLM observability tools show a run as nested spans on a time axis, each span opening its input, output, model, tokens and latency.
- Time is the axis that makes parallel work, waits and slow calls visible.

In the skill: the Sequence view's lanes on one time axis, model bars with the first token marked, and the pop-up as the span detail.

### The request and response inspector
Chrome DevTools Network panel: https://developer.chrome.com/docs/devtools/network/reference

- Engineers already read a call as a request (method, URL, query, body) beside a response (status, timing, preview), with large bodies folded into a tree.

In the skill: the pop-up's two columns, the foldable JSON tree, keys blanked, and "Copy the request as JSON" so a call can be re-run.

### Standard names for model-call fields
OpenTelemetry semantic conventions for generative AI: https://opentelemetry.io/docs/specs/semconv/gen-ai/

- The fields that matter for a model call are settled: model, operation, input and output tokens, cached tokens, finish reason, the messages in and out.

In the skill: the pop-up's parameter and usage tables use those fields, whichever provider the call went to.

### Funnels for recommenders
Google's recommendation systems course: https://developers.google.com/machine-learning/recommendation/overview/types

- A recommender narrows in stages (candidate generation, scoring, re-ranking), and the count at each stage is the first thing to look at.

In the skill: the Funnel view's staged counts with the items at each stage, and the reasons items were dropped when the code recorded them.

### Showing more than telling
The sibling skill `interactive-architecture-explainer` (its own research notes cover C4 notation, sync and async lines, and why walls of text fail).

- One picture with a guided path first, then open exploration; a concrete example in every panel; no decoration.

In the skill: Play first, then any box, any call; every panel quotes the recording.
