# Business research engine

`src/engine/businessResearch.ts` is the part of Wesify that decides what a company needs. The capability
catalog knows what Wesify *can* build; the researcher decides what this specific company *should* get,
and can show its work.

## Why it exists

Selecting features by keyword produces generic software: the word "invoice" appears, so an invoice
page appears. The researcher works the other way round. It reads the operating model out of what the
operator said, and capabilities fall out of that model as consequences.

## What it produces

`researchBusiness({ text, asked })` returns:

| Field | Meaning |
|---|---|
| `archetype` | The closest known operating base, with the signal that matched it |
| `readings` | One conclusion per operating-model dimension, with basis and evidence |
| `findings` | Business-facing conclusions: what Wesify concluded, the quote it came from, what it changes |
| `questions` | Unresolved dimensions, ranked by how many capability decisions they would settle |
| `include` / `exclude` | Capability decisions with the reason behind each one |
| `coverage` | Share of the operating model that is actually resolved, 0 to 1 |

## The dimensions

Each dimension exists because its answer changes what gets built. Nothing is asked because a
questionnaire would traditionally ask it.

| Dimension | Decides | Essential |
|---|---|---|
| `offering` | What the company sells | yes |
| `revenue` | How money enters | yes |
| `delivery` | How work reaches the customer | yes |
| `workforce` | Who does the work | yes |
| `customer` | Who is served | no |
| `supply` | What is bought to deliver | no |
| `control` | What gates the work: approvals, contracts, regulation | no |

## Basis, and why it matters

Every reading carries how Wesify knows it:

- `stated` — the operator said it. Only stated readings select or exclude capabilities.
- `inferred` — implied by something stated.
- `domain-default` — typical for the archetype. It lets the live preview build, it is labelled as
  unconfirmed, and it never selects a capability. This is what stops Wesify from quietly inventing an
  operating model and presenting it as knowledge.

## Question selection

`informationGain = dimensionWeight × (1 + undecidedCapabilities)`, where a capability counts as
undecided when no resolved dimension has already included or excluded it. The highest-gain
unresolved dimension becomes the next question, which is why the interview is short and why two
different companies get different questions in a different order.

Wesify refuses to architect while an **essential** dimension is unresolved, because a wrong guess there
produces the wrong product. Non-essential dimensions fall back to the archetype default and can be
added later by prompting the workspace.

## Where it is used

- `planCapabilities` (`capabilityCatalog.ts`) merges research includes and excludes into the plan and
  keeps the reason for each, which the workspace shows under Settings → "Why Wesify built this".
- `criticalDiscoveryQuestion` (`discoveryModel.ts`) uses it to choose the next question and to decide
  when Wesify has enough to build — replacing the old fixed question ladder.
- `Builder.tsx` renders findings as the live reasoning journal and as the evidence list on the
  approval screen.

## Deliberate limits

The researcher reasons over an operating-model ontology, not over the open web. It never invents an
operational fact, and any conclusion it draws without a quote is marked as a default rather than
knowledge. Reading external sources about a named company is a separate capability and is not
implemented here.
