# Frontier research tier

BO decides what a company needs in two tiers. The first always runs; the second runs when you give
it an API key.

| Tier | Where it runs | What it knows | Availability |
|---|---|---|---|
| Business researcher (`src/engine/businessResearch.ts`) | The browser | An operating-model ontology, plus what the operator said | Always |
| Frontier researcher (`server/reasoning.mjs`) | Your machine, server-side | The open web, read live by Claude with web search and web fetch | Only with an API key |

The second tier never replaces the first. It produces conclusions in the same evidence-carrying shape
and they are merged, so if the key is missing, the request fails, or safety review declines it, BO
keeps working exactly as it does without it — and says so in the reasoning journal.

## Enabling it

```bash
setx ANTHROPIC_API_KEY "sk-ant-..."     # Windows, new shell afterwards
export ANTHROPIC_API_KEY="sk-ant-..."   # macOS / Linux
npm run dev
```

The key is read by the Node service only. It is never sent to the browser, never written to
`localStorage`, and never included in a workspace export. `GET /api/research/status` reports
`{available, model}` so the interface can show which tier is running without exposing anything else.

Optional: `BO_REASONING_MODEL` overrides the model (default `claude-opus-5`).

## What it actually does

`POST /api/research` runs two passes.

**Pass one — research.** Claude Opus 5 with adaptive thinking, `web_search_20260209`, and
`web_fetch_20260209`. It researches the named company where one is public, and otherwise the
industry and operating model: what is sold, who buys, how and when money arrives, how work reaches
the customer, what must be bought in to deliver, who does the work, what regulation or contract
obligations gate it. Output is a business-facing brief where every conclusion carries its evidence
and source. Server tools pause the sampling loop at their iteration limit, so the call resumes on
`pause_turn` up to four times.

**Pass two — compile.** The brief goes to a second call with no tools and a JSON schema
(`output_config.format`), which turns it into findings, capability selections, exclusions, an open
question, and sources. Splitting research from compilation is deliberate: one prompt asked to
research, decide, and emit schema-valid JSON at once does all three worse.

Both passes opt into server-side refusal fallbacks (`fallbacks: "default"`), so a safety decline is
re-run on the recommended fallback model rather than lost. A refusal that survives that is surfaced
to the user as a normal, non-fatal message and BO continues on tier one.

## How the two tiers combine

`mergeFrontierResearch` (`src/engine/researchClient.ts`) is a pure function, and the merge rules are
deliberately conservative:

- Researched findings sort ahead of local ones; duplicates by conclusion are dropped.
- Researched capability selections are added with their reason recorded.
- Researched exclusions win over researched inclusions.
- Local questions, readings, and coverage are untouched — question selection stays with the local
  information-gain engine, so the interview does not depend on the network.

`applyFrontierArchitecture` folds the same decisions into the `ArchitectureContext` before BO
compiles the workspace, so researched conclusions reach the actual product and not just the journal.

## What the user sees

- Live reasoning journal entries with the conclusion, the evidence, and the source URL.
- The sources BO opened, listed on the approval screen and linked.
- `Researching` in the builder header while pass one runs, then `researched` once it lands.
- An explicit, non-fatal note if research was unavailable — never a silent downgrade.

## Cost and limits

One research call per workspace, at the start of discovery, running alongside the interview rather
than blocking it. Requests are capped server-side: 4,000 characters of description, 20 conversation
turns, 8 searches, and 5 fetches. Pricing for Claude Opus 5 is $5 per million input tokens and $25
per million output.

## Testing it without a key

Both frontier tests point the SDK at a local mock through `ANTHROPIC_BASE_URL`, so the whole path is
exercised on every run with no key and no network:

- `npm run test:reasoning` drives `server/reasoning.mjs` at the wire level — the two passes and their
  request shapes, a paused server-tool loop resuming without inventing a user turn, a rejected beta
  retrying without it, a safety refusal on either pass, malformed and empty model output, capability
  ids being sanitized before they reach the prompt, conversation trimming, and the HTTP endpoint's
  auth and validation.
- `npm run test:research-ui` runs the browser against the same mock and asserts the researched
  conclusion, its evidence, and its sources appear in the reasoning journal and on the approval
  screen — and that researched capability selections and exclusions reach the compiled workspace.

The scripted mock is deliberately better than a live key here: it can produce a refusal, a paused
loop, and malformed output on demand, which a real call will not do reliably.

## Deliberate limits

BO does not let the researcher write to the workspace. It selects capabilities, states conclusions,
and cites sources; record creation and structural changes still go through the existing tested-preview
approval path. Nothing researched is presented as an operational fact about the company's own data.
