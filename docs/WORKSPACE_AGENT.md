# The agent inside the workspace

The interview was moved off the in-browser model long ago. The agent living inside the finished
Command Center never was: it asked Qwen2.5-0.5B, over WebGPU, for a nested action against a live
schema, in 520 tokens. Everything it could not do was read as the product not being able to do it —
when the actions, the permissions, the preview, the versioned build and the rollback were all
already there, waiting for something competent to drive them.

## Two modes

`classifyWorkspaceIntent` decides which, from the command alone.

| Intent | Mode | Model budget | What comes back |
|---|---|---|---|
| `BUSINESS_QUERY`, `BUSINESS_ACTION`, `REPORT_REQUEST`, … | `command` | 900 tokens, no thinking | one action |
| `WORKSPACE_CHANGE`, `WORKFLOW_CHANGE` | `build` | 6000 tokens, thinking on | a **plan** |

A command is something somebody is waiting on with the cursor blinking. A build is the same class of
work the architect does at build time, so it gets the same class of budget.

## Why a plan rather than an action

"Set up supplier management" is a record type, eight fields, two relations, a page, a low-stock alert
and a metric. No model builds that one action at a time, frontier or otherwise. The plan carries all
of it at once, and [`workspaceAgentPlan.ts`](../src/engine/workspaceAgentPlan.ts) compiles it into
the same `activate_module` action the capability installer already produces — so nothing downstream
changes.

Nothing in a plan is taken on trust:

- A relation pointing at a record type nobody built is dropped. An empty dropdown is worse than a
  missing field.
- A record type the workspace already has is **extended**, never built again. Two Suppliers tables is
  the worst outcome of an agent that builds — both look right, records land in whichever one somebody
  opened, and no page shows the whole picture.
- A field whose label matches one already on the record is skipped, not added beside it.
- A `sum` metric with no amount to add up would report zero forever, so it is not built.
- A workflow whose condition names a state the record does not have keeps the trigger and loses the
  condition, rather than never firing.
- Catalog capabilities are preferred over invented record types: they install dependency-aware and
  complete.

## What happens to a plan

```text
command → agent turn (server) → plan → planToWorkspaceAction → activate_module
        → evaluateActionControl (role + approval)
        → buildGeneratedChange   new version, generated, self-tested, PREVIEW_READY
        → operator approves      promoteGeneratedChange
        → or rollbackProject
```

Every structural change is a preview. The agent never changes a workspace while somebody is talking
to it: what it produces is a new, tested version they promote.

## The model

`BO_AGENT_MODEL` sets the model behind the agent, defaulting to the same `MODEL` the rest of the
server uses. The provider cascade, quota parking, schema sanitising and budgets are shared with the
interview ([`gemini.mjs`](../server/gemini.mjs), [`anthropic.mjs`](../server/anthropic.mjs)) rather
than rebuilt — Gemini's free tier costs nothing, Anthropic is used when a key is configured.

A structural command costs roughly half a cent to a cent at Haiku prices. Cost is not the constraint
here; the constraint was the 0.5B model and the one-action turn.

**The interview is deliberately untouched by all of this.** It keeps its own prompts, its own model
selection and its own budgets.

## Fallback

No key, a spent quota or an unreachable server all fall back to the browser model, which is what a
workspace with nothing configured has always used. The fallback says so once, in one line: silent
degradation is indistinguishable from the assistant getting worse at its job.

## Tests

- [`workspaceAgentPlan.test.ts`](../src/engine/workspaceAgentPlan.test.ts) — the compiler, and every
  refusal above
- [`scripts/agent.test.mjs`](../scripts/agent.test.mjs) — the route: a change reaches the building
  prompt with the larger budget, a command does not carry the catalog, turns are audited, and a call
  without a workspace token is refused
