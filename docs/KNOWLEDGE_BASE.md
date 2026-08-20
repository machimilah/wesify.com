# BO's business knowledge base

BO needs to recognise any business a person can describe and know what it needs to run. That is three
separate layers, and only one of them is imported.

| Layer | What it holds | Where it comes from |
|---|---|---|
| Industry taxonomy | 20 sectors, 96 subsectors, 1,923 industry titles | **Imported** — NAICS 2022, US Census Bureau |
| Operating archetypes | 25 packs mapping an industry to the systems it runs on | **Authored** for BO |
| Capability catalog | 120 buildable business systems with entities, views, metrics, workflows | **Authored** for BO |

## What is imported, and why only this

**NAICS 2022** — the North American Industry Classification System, published by the US Census Bureau.
As a work of the US federal government it is public domain and freely redistributable.

It is the only imported dataset because it is the only one that solves a problem BO cannot solve by
authoring: enumerating *every kind of business there is*. NAICS already did that, exhaustively, with
the vocabulary operators actually use about themselves — "Nail Salons", "Title Abstract and Settlement
Offices", "Dimension Stone Mining and Quarrying".

- Source file: `data/sources/naics-2022.xlsx` (as published)
- Extracted: `data/sources/naics-2022.json`
- Generated module: `src/data/naics.generated.ts` — rebuild with `node scripts/build-taxonomy.mjs`

## What is deliberately not imported

Vendor documentation and data models from Odoo, SAP, Microsoft Dynamics, Salesforce, NetSuite and
similar products are copyrighted. Copying them into BO would be infringement, and no amount of
reformatting changes that.

It would also be the wrong input. Those documents describe *their* menus, objects and terminology —
"Opportunity Line Item", "Business Partner Master". BO's job is to decide what a company needs, which
is a question about the company, not about another product's schema. An imported vendor model would
push BO toward reproducing that vendor's shape for every business, which is the exact failure BO
exists to avoid.

Open-source ERP models (Apache OFBiz under Apache 2.0, ERPNext and Odoo Community under GPL/LGPL) are
legitimate to *read* for domain understanding. Only OFBiz's licence permits reuse in a proprietary
product, and even then with attribution. Nothing from any of them is copied here.

## How a description becomes an operating model

```
"We run a bowling centre and host league nights"
        │
        ├─ 1. Hand-written signals  ─── matched? ──▶ archetype (precise, curated)
        │                                 │ no
        ├─ 2. Industry taxonomy  ─────────┘
        │      stem + rarity-weight the words, pool evidence per subsector
        │      → 713 Amusement, Gambling, and Recreation → `events`
        │
        └─ 3. Operating-model dimensions (businessResearch.ts)
               what is sold, how money enters, how work is delivered, who does it …
               → capabilities, with the evidence for each
```

Signals run first because a curated signal is more precise than a lexical match. The taxonomy is the
safety net, and it is what makes the difference between an unusual business getting a real operating
base and getting the conservative general one.

### Why matching is pooled per subsector

Scoring individual industry titles rewards short ones. "Dairy farm" scores higher against "Dairy
Product Manufacturing" (three words, one hit) than against "Dairy Cattle and Milk Production" (four
words, one hit) — and puts a farm in a factory. Pooling every title under a subsector fixes it:
"farm" and "dairy" both appear somewhere under Animal Production, while only "dairy" appears under
Food Manufacturing. It is also the level BO maps at, so nothing is lost by aggregating there.

Terms are weighted by rarity across the taxonomy. "Dairy" appears in a handful of titles and nearly
identifies the business; "production" appears in hundreds and identifies nothing. A single rare word
can classify a company; common words never can, however many match.

## Extending it

- **A new industry mapping** — add the subsector code to `src/data/industryTaxonomy.ts`. The test
  suite fails if any of the 96 subsectors is unmapped or points at a pack that does not exist.
- **A new operating archetype** — add a pack to `src/data/industryPacks.ts`. Every capability id must
  exist and bring its dependencies; the catalog test enforces both.
- **A new capability** — add it to the domain file it belongs to (`src/data/capabilities.commerce.ts`,
  `.operations.ts` or `.finance.ts`; the original 59 stay in `capabilityCatalog.ts`) with its entities,
  pages, metrics and dependencies. Field builders come from `capabilityHelpers.ts` — importing values
  from `capabilityCatalog.ts` would create an import cycle, since it imports the domain files back.

## Catalog integrity

`capabilityIntegrity.test.ts` checks every definition, not just the ones a pack happens to select:
unique ids, a real module, resolvable dependencies with no cycles, every relation pointing at an
entity some dependency actually provides, every metric and workflow pointing at a field that exists,
and no signal generic enough to fire on an unrelated business.

That last pair matters more than it sounds. A relation whose target no dependency provides compiles
fine and produces a dropdown with nothing in it; writing the check found nineteen of them, nine
already in the original catalog. A signal is substring-matched against everything the company said,
so `account` was quietly matching *accounting firm* and *accountant*.

## Known gap

Coverage is now broad rather than deep. Each capability models the records and status flow of its
domain, not its full computation — `finance.fixed-assets` holds the method and accumulated
depreciation but does not run the depreciation schedule; `manufacturing.mrp` records requirements and
shortfalls but does not explode a multi-level BOM. That is the right shape for BO, whose job is to
give a business the records it needs to operate, but it means the catalog is not a drop-in
replacement for a specialist system in any one of these areas.
