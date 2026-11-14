# Orchestrator integration

This document is the contract any research-orchestration skill must satisfy when it produces durable conclusions that should land in a research vault. It complements the per-vault `AGENTS.md` (generated from `schema/`) and is aimed at skill authors rather than end users.

## Why this document exists

Consider this illustrative failure mode. A fully-capable orchestrator (or a vanilla agent with vault access) reads upstream docs. It then writes one large markdown file under `synthesis/` that compresses sources, distillation, open questions, and reproducibility notes into a single prose blob. No `note`, `question`, `experiment`, or `snippet` entries get created. The vault ends up looking superficially populated but is missing the distilled and decomposed layers that make it actually re-usable across sessions.

The contract below makes that failure mode visibly non-conforming.

## Lifecycle boundary

Three roles, three responsibilities:

| Role | Owns |
|---|---|
| `research-vault-usage` skill | Retrieval, freshness checks, **pre-synthesis artifact planning** (the capture plan in AGENTS.md §2.6). |
| `research-capture` skill + CLI | Persistence once an artifact type is chosen; correct frontmatter; dedup; supersede discipline. |
| Orchestrator (yours, or any other) | Running the capture plan **before** invoking synthesis capture. Decomposing output into atomic entries. |

An orchestrator that produces only `sources/` and `synthesis/` entries (skipping `notes/`, `questions/`, `experiments/`, `snippets/`) is non-conforming, regardless of prose quality. The two lint warnings (`WARN_SYNTHESIS_NO_NOTE_COVERAGE` and `WARN_SYNTHESIS_MONOLITHIC`) check narrower structural conditions, with the primary-rollup exception and length threshold described below.

## Authoring entry point (`research-authoring`)

Research does not only enter the vault through an orchestrator answering a question. It also enters when someone *authors a document* — a brief, an ADR, a chapter, a docs page — that cites external facts. That write-side path has its own skill, `research-authoring`, and its own trigger: a citation (an external URL, a version pin, an asserted API behavior) about to land in prose, in a repo bound by a `.research-vault.json`.

The boundary mirrors the orchestrator one. `research-vault-usage` owns answering a question *from* the vault; `research-authoring` owns the moment a citation enters a document; the `research-capture` skill and CLI own persistence for both. The authoring lifecycle is **consult → capture → verify**: search the vault before a citation lands (cite an existing entry, check its freshness), capture what is missing as the appropriate type (a versioned `source` with `subject.version`, a `question` for an unresolved assumption), then run `research-vault check` so the document's citations are confirmed `ok` rather than `uncovered`/`stale`. `check --check` checks citation status in consuming documents; lint checks vault structure. Neither alone establishes research correctness.

## The verification tenet (fetch before you assert)

An entry or a finding is authoritative only if its facts were **fetched**, not recalled. This is non-negotiable for any agent writing to or auditing the vault:

- A version, release date, or API-behavior claim must be confirmed against the authoritative source (web fetch / cross-reference) and recorded as a `refetched-source` or `cross-referenced` verification with the URL and date. **Model recall is not verification** — a remembered "latest version" may be outdated and requires verification.
- `capture` seeds only a `captured` provenance marker, which is explicitly **not** a verification. A `source` whose every verification is `captured` is not authoritative; it trips the `WARN_SOURCE_UNVERIFIED` lint warning and is surfaced by `advise` until a real verification is recorded.
- What cannot be fetched is an open `question` (or `unverified-offline`), **never** a `source` stated as fact and never a reported defect. Without authoritative evidence for current upstream facts, an audit must state that limitation rather than guess; read-only local probes can still establish local facts.

A vault that records recalled facts as authoritative is worse than no vault: it launders a guess into something that looks verified. The lint warning is the mechanical floor; this tenet is why it exists.

## The capture plan (AGENTS.md §2.6)

Before drafting a `synthesis`, an orchestrator must produce a plan covering four prompts. The plan is conceptual; it need not be persisted. What gets persisted is the entries it generates.

1. **Notes to write.** Which load-bearing sources need distillation? One note can cover several sources. A synthesis may skip notes only for primary-source factual rollups (release-note matrices, version diffs, standards summaries), and only by declaring `synthesis_basis: primary-rollup` on the synthesis.
2. **Questions opened or answered.** Any ambiguity that affects a claim, recommendation, confidence, or future retrieval. "I don't know" is a `question` entry, not a parenthetical in prose. Routine trivia does not count.
3. **Experiments to log.** Any tool/model/empirical run whose result you'll cite as evidence. Routine source-reading does not count; an actual reproduction, benchmark, or model eval does.
4. **Snippets to extract.** Any reusable YAML/config/code block intended for copy-paste reuse. Illustrative-only fragments inside synthesis prose do not count.

The synthesis then references the resulting entries via `contributing_ids`.

## Conformance rules

An orchestrator conforms when:

- For every external URL whose content informs a durable conclusion, a `source` entry exists.
- For every load-bearing source used for interpretation, recommendation, conflict resolution, prioritization, or reuse, at least one `note` entry covers it (one note may cover several sources). The exception is a synthesis that declares `synthesis_basis: primary-rollup`.
- Every unresolved ambiguity that affects a claim or recommendation has a `question` entry.
- Every empirical run whose output is cited as evidence has an `experiment` entry with an explicit `outcome`.
- Every reusable code/config fragment is a `snippet` entry, not embedded prose.
- The final `synthesis` cites all of the above through `contributing_ids` and follows the chain-of-verification from the `research-vault-usage` skill, §4.

An orchestrator is non-conforming when its only durable output is one `synthesis/*.md` file with sources cited inline or via `contributing_ids` but no atomic decomposition. Reports are views; vault entries are the system of record.

## Worked example

A research task: *"how does API Priority and Fairness (APF) behave inside a vCluster tenant?"*

A conforming run produces, in order:

1. **Sources**, fetched and captured raw:
   - `2026-05-28-kubernetes-apf-concept-docs.md` (`authority_tier: primary`, `authority_basis: official-docs`, `subject.name: kubernetes`, `subject.version: 1.34`)
   - `2026-05-28-kep-1040-apf.md` (`authority_basis: spec`)
   - `2026-05-28-vcluster-apiserver-request-handling.md` (`authority_basis: official-docs`)

2. **Notes**, your distillation of the load-bearing material:
   - `2026-05-28-note-apf-flowschema-priorityclass-essentials.md` covers the two upstream sources, condensing them to the FlowSchema/PriorityLevelConfiguration matching path you actually care about.

3. **Snippets**, reusable artifacts extracted before they get buried:
   - `2026-05-28-snippet-flowschema-throttle-tenant-sa.yaml.md` (`language: yaml`); a proposed FlowSchema + PriorityLevelConfiguration pair whose throttling behavior would need verification.

4. **Experiment**, the empirical run that informs the isolation claim:
   - `2026-05-28-experiment-apf-tenant-noisy-neighbor.md` with `outcome: success|partial|failure|inconclusive`, the metrics captured, and the observed behavior. References the snippet's id.

5. **Questions**, open after the docs were exhausted:
   - `2026-05-28-question-syncer-apf-bucket-shared-with-host-consumers.md` (`state: open`)
   - `2026-05-28-question-tenant-flowschema-sync-direction.md` (`state: open`)

6. **Synthesis**, the cross-source claim, with all of the above in `contributing_ids`:
   - `2026-05-28-tenant-apf-isolation-boundary.md`, ~600 words, ends with a recommendation. `confidence: medium` because two questions remain open.

A non-conforming run produces, in order:

1. Three `source` entries.
2. One 2000-word synthesis citing the sources directly via `contributing_ids`, with the FlowSchema YAML embedded inline, "we tested this and it throttled correctly" as a sentence, and "it's unclear whether the syncer shares the host APF bucket" as a parenthetical.

These hypothetical examples illustrate the conditions for `WARN_SYNTHESIS_NO_NOTE_COVERAGE` and `WARN_SYNTHESIS_MONOLITHIC`; they are not recorded fixture runs.

## Anti-patterns to avoid

- **Monolithic report files.** A single long markdown document, whether it lives inside the vault as a synthesis or outside the vault as a stray `Report.md`, is the failure mode this contract addresses.
- **Source → synthesis with no notes.** Acceptable only for a primary-source factual rollup. Declare `synthesis_basis: primary-rollup` and justify it in the body.
- **"I don't know" as prose.** Open questions get `questions/` entries with `state: open`, not parenthetical hedges in synthesis text.
- **Inline code blocks.** A reusable YAML or shell fragment belongs in `snippets/`. Keep it separately reusable instead of making future readers extract it from synthesis prose.
- **Stub notes to silence the lint.** A one-line note that says "see source" is worse than no note. If a note would be a stub, the synthesis probably belongs in the `synthesis_basis: primary-rollup` exception path.
- **Capture plan as a vault entry.** The plan is conceptual. Persist its *outputs* (the actual entries), not the plan itself.

## Mechanical signals

Two lint warnings catch the most common conformance failures:

- `WARN_SYNTHESIS_NO_NOTE_COVERAGE`: synthesis cites sources directly with no `note` in `contributing_ids` and no `synthesis_basis: primary-rollup`.
- `WARN_SYNTHESIS_MONOLITHIC`: synthesis body exceeds 1500 words with no `note` contributors and no `synthesis_basis: primary-rollup` declaration.

Both are warnings, not errors; both can be silenced by either fixing the decomposition or declaring the rollup exception. A clean `research-vault lint` is the minimum bar for "conforming" but it does not by itself certify good research; it confirms that the implemented structural checks passed.

## Implementing your own orchestrator
<!-- evidence: 2026-11-13-reliability-code-v2 2026-11-13-reliability-tests-v2 -->

The plugin ships a reference implementation: the `research-orchestrate` skill (`skills/research-orchestrate/SKILL.md`), which captures sources eagerly at fetch time and persists the distilled layers through validated batch capture. The batch plan is a JSON array of camelCase capture specs, validated entry-by-entry (enums, required note/synthesis links, intra-batch id references) before anything is written. Validation precedes writes, but batch persistence is not a transaction. For retained operation keys, opt-in recovery and controller completion checks, see [Research persistence and recovery](RELIABILITY.md). Existing external orchestrators can continue using legacy capture. When writing your own orchestration skill instead:

1. Narrow your skill description so it captures research-task entry points, not retrieval/citation/capture (those belong to `research-vault-usage`).
2. After source intake, explicitly walk the four-prompt capture plan from AGENTS.md §2.6 before drafting any synthesis.
3. Persist each artifact via `research-vault capture --type <t> ...`. The CLI accepts every field needed for the lifecycle, including `--synthesis-basis`, `--authority-tier`, `--authority-basis`, `--contributing-ids`, `--sources`, `--state`, `--outcome`, `--confidence`. For multi-entry persistence, prefer one validated `capture --batch <plan.json>` call; duplicates come back as `skipped`, validation failures as a per-entry error report with nothing written. Batch specs for authored types carry their prose in a `body` key; a synthesis or note without one is a stub that the `advise` stub-bodies signal will surface.
4. Before the final synthesis capture, run `research-vault lint` mentally (or actually) and confirm no `WARN_SYNTHESIS_*` would fire. If they would, decompose more, or declare `synthesis_basis: primary-rollup` honestly.
5. Make the resulting synthesis short. Cross-source claims and a recommendation, not a re-statement of the underlying material.

## Codex workflow adapter
<!-- evidence: 2026-11-13-codex-adapter-implementation 2026-11-13-codex-adapter-validation -->

The Codex installation generates shared research skills with explicit package paths and a sequential fallback when Workflow is absent. The capture/evidence requirements remain in the shared skill bodies. Fresh CLI review dispatch and manual ledger recording are documented in [Codex setup](CODEX.md); an author must not substitute self-review when a reviewer process fails.
