# Process completeness

The build pipeline reasons from what an operator said. That is the right way to choose between two
ways of doing a thing, and a poor way to notice that a whole thing is absent: nobody lists what they
forgot to mention. A bakery describes selling bread and never mentions buying flour, and a workspace
assembled faithfully from the interview ships a business with a way to sell and no way to buy.

This layer is the second question — *what must be true for this company to run at all* — asked
against published process frameworks rather than against Wesify's own idea of a business.

## What it checks against

| Framework | Where it applies | In the code |
|---|---|---|
| APQC Process Classification Framework, cross-industry | Every company. The master checklist, at level two | `apqcProcesses` |
| SCOR | Wherever goods or materials move | `scorProcesses` |
| ISA-95 | Wherever inputs are converted into output | `isa95Processes` |
| COSO | Wherever money moves or evidence must exist | `controlObjectives` |
| Regulatory subjects | Trade, goods and data that an authority governs | `regulatoryDomains` |

All of it lives in [`src/data/processFrameworks.ts`](../src/data/processFrameworks.ts). Each entry
carries the capabilities that would actually carry the process, so a finding is actionable rather
than an observation.

## The passes

```text
description + interview + selected capabilities
                 │
                 ▼
   archetypes.ts        every operating model this company holds, not the closest one
                 │
                 ▼
   processCoverage.ts   each framework process: required / applicable / potentially applicable /
                        not applicable / unknown — always with the reason
                 │
                 ▼
   completeness.ts      sixteen flows over the compiled workspace: money in, money out, customers,
                        suppliers, delivery, resources, capacity, stock, quality, obligations,
                        people, finance, exceptions, management, risk, evidence
                 │
                 ▼
   scenarios.ts         twelve real events — supplier delay, quality rejection, late payment,
                        equipment breakdown — each asked: can it detect, know what it affects,
                        reach a number, name an owner, recommend, act, record, and follow the money
                 │
                 ▼
   operatingCoverage.ts one report: blocking gaps, questions worth asking, subjects to verify
```

The result is stored on the workspace configuration as `coverage`, so it is the record of what was
checked when that version was built rather than a description of today.

## Where it changes the build

1. **Before the compile.** The architecture review pass (`REVIEW_ARCHITECTURE` in
   `discoveryModel.ts`) used to re-run the architect prompt over its own output. It now runs the
   process check on the proposal and calls the architect back only when a company of this shape must
   be able to do something nothing selected carries. The model is told what is missing and decides —
   an instruction that selected capabilities itself would rebuild the module bloat the product
   exists to avoid.
2. **On the proposal screen.** Assumptions about money or legal responsibility, and regulatory
   subjects, appear under *Worth confirming* before anybody presses the button.
3. **Inside the workspace.** Access & control shows how Wesify read the company, what it could not
   close, and what nobody has verified.

## The two failures it exists to prevent

Both matter, and they pull against each other.

- A bakery with no way to buy flour, because the interview covered selling and ran out of questions.
- A coursework tracker with a procurement module, because a checklist said businesses buy things.

The second is why nothing is required of a company until something says it *trades*, why an
archetype needs two independent words in the description before it can make anything required, and
why every not-applicable verdict carries the reason it was ruled out.

## Regulation

Never a rule, always a subject. Wesify does not know which jurisdiction a sentence about food refers
to, and a specific obligation asserted at the wrong one is worse than none — somebody will go and act
on it. Every regulatory finding names the kind of authority to confirm with and the kind of record
commonly required, and is always classified as requiring verification.

## Tests

- [`archetypes.test.ts`](../src/engine/archetypes.test.ts) — multi-archetype detection
- [`processCoverage.test.ts`](../src/engine/processCoverage.test.ts) — classification, dedup between
  frameworks, controls, regulation
- [`operatingCoverage.test.ts`](../src/engine/operatingCoverage.test.ts) — the whole check end to end
  through the real compiler, on a bakery and on a coursework tracker
