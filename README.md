# Claude skills

Skills for Claude Code that turn a system into an interactive page people can review.

| Skill | What it builds | Use it when |
|---|---|---|
| [interactive-architecture-explainer](skills/interactive-architecture-explainer/SKILL.md) | One diagram of how the parts of a system talk, with scenario buttons that play one path step by step, a plain-language side panel, and the decisions the reader needs to make | Someone who doesn't build the system needs to review its design, or compare the current and proposed design |
| [workflow-trace-replay](skills/workflow-trace-replay/SKILL.md) | A replay of real recorded runs of an AI or agent workflow: the workflow as a state machine, every call on a timeline, a funnel, and a pop-up with exactly what each model call was sent and returned | You want to see how an LLM pipeline really behaves, debug it, or compare an old and a new version |

## Install

**As a plugin (Claude Code).** In Claude Code, add this repo as a marketplace, then install one skill or both:

```
/plugin marketplace add vspvikram/claude-skills
/plugin install interactive-architecture-explainer@vspvikram-skills
/plugin install workflow-trace-replay@vspvikram-skills
```

For a private repo, your git login needs read access to it.

**Or copy the folder.** Copy a folder from `skills/` into `~/.claude/skills/`. Claude Code finds it the next time it starts.

Then ask for what you want, for example "show me the architecture of this service" or "replay real runs of this agent". You can also name the skill.

## What you need

- Claude Code.
- Node 22+ and Chrome or Chromium for each skill's `scripts/verify.mjs`, which checks the finished page in a headless browser. Set `CHROME=/path` if Chrome isn't found.
- Python 3 for `workflow-trace-replay`'s `build_runs.py` and `assemble.py`.

Recording real runs calls real models and costs tokens. The replay skill says to estimate the spend first, records no request headers and blanks key-like fields. Still read a recording before you share a page made from it: it holds your prompts and your test data.

## Layout

```
.claude-plugin/marketplace.json   the plugin list
skills/<name>/SKILL.md            what Claude reads: when to use the skill and how
skills/<name>/template/           a working page with made-up data to copy
skills/<name>/scripts/            the helpers and the page checker
skills/<name>/reference/          worked examples and research notes
```

To add a skill, add its folder under `skills/` and an entry to `.claude-plugin/marketplace.json`, then run `claude plugin validate .`.
