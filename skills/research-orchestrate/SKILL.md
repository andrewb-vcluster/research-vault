---
name: research-orchestrate
description: Use when entering a fresh research task — a question that needs new external research, not yet at retrieval/citation/capture — and a research vault resolves (via .research-vault.json, $RESEARCH_VAULT_PATH, the config pointer, or the OS default). Owns the end-to-end research workflow — vault-first lookup, web fan-out, eager source capture, the §2.6 capture plan, and a lint-gated synthesis — and supersedes generic deep-research skills in vault-bound contexts. For retrieval/citation from the vault use research-vault-usage; for single-entry persistence use research-capture.
---
# Orchestrating research into the vault
<!-- evidence: 2026-11-13-reliability-code-v2 2026-11-13-reliability-tests-v2 2026-11-13-reliability-instruction-dependencies 2026-11-13-reliability-instruction-checks -->

The reference implementation of `docs/ORCHESTRATOR-INTEGRATION.md`. Durable conclusions land as atomic vault entries — sources, notes, questions, snippets, experiments, synthesis — never as a monolithic report. Reports are views; the vault is the system of record.

## 0. Resolve paths once

- CLI: `node "${CLAUDE_PLUGIN_ROOT}/bin/research-vault.mjs"`. Resolve `${CLAUDE_PLUGIN_ROOT}` to an absolute path now — do not rely on workers inheriting it.
- Resolve the selected vault to an absolute canonical path once. Pass both CLI and vault explicitly to every worker; append `--vault <absolute vault>` to every CLI call, including reads. Vault path resolves in order: `--vault` flag → the repo's `.research-vault.json` binding (which outranks the env var) → `$RESEARCH_VAULT_PATH` → the global config pointer → the OS default (see README's "Where the vault lives").

## 1. Clarify, then check the vault first

1. If the question is underspecified (no version, environment, or success criterion), ask 2–3 narrowing questions before researching.
2. Search the vault (`search --topic`, `--text`, `--body`). If fresh entries (per §2 of research-vault-usage) already cover the question, answer from the vault and stop. If coverage is partial, note the gap — it becomes a `question` entry or the workflow's focus.

## 2. Run the workflow

Use the Workflow tool with the reference script below, adapted to the question. Pass absolute paths via `args` — never rely on env vars inside the script. Use the executable primitives in `bin/lib/research-controller.mjs` in the controller (via a Node adapter if the Workflow runtime cannot import Node modules). Workers only fetch/evaluate and propose changes. The controller saves intent and awaits each mutation; no worker writes to the vault. Schema-shaped output alone is not evidence of capture or verification.

| Phase | Does |
|---|---|
| Recon | Map existing vault coverage and gaps |
| Sweep | Parallel multi-modal search: official docs, release notes, issue trackers, community |
| Fetch+Seed | Fetch in parallel; controller serially captures proposed sources eagerly, resolves actual IDs, then validates handoffs against disk |
| Verify | Adversarial check of load-bearing claims — fetched, not recalled; tool-bearing claims also probed per `meta/prompt-templates/probe-tool.md` when a manifest exists |
| Plan | Walk the §2.6 four prompts; emit the batch plan JSON (notes, questions, snippets, experiments, synthesis) |
| Persist+Gate | Save immutable plan/key, opt-in batch capture, current artifact/reference checks, lint and claims gate, then reconciled closure of questions actually answered |

The reference below uses host adapters `fetchProposal`, `evaluateClaim`, `executeJson`, `lint`, and `gate`. They preserve the existing specialist selection and tools: `fetchProposal` returns `{spec, claims}` without mutation; `evaluateClaim` returns `{claimId, verified, method, evidence:{url,version,scope,observation,fingerprint}}` from actual fetched evidence or a read-only probe. `executeJson` executes the supplied Node argument array without a shell and parses its single JSON result. `gate` invokes the existing research-claims-gate skill on the current synthesis and returns its recorded verdict; lint is a separate check. Keep transient source text in the permitted fetch context; task storage contains locators/hashes and scoped observations, never unconsented copies of source text.

```javascript
// args: { question, cli, vault, today }; both paths are absolute.
// Import these primitives from the absolute plugin path in the controller.
const ctx = context(args.cli, args.vault)
const task = createTask(ctx) // before the first vault mutation; keep task.dir for resume
const mode = workflowAvailable ? 'workflow' : 'sequential'
const CLI_ARGS = tail => command(ctx, tail) // Node argv; never interpolate prose into shell

phase('Recon')
const recon = await agent({ question: args.question, cli: ctx.cli, vault: ctx.vault,
  instruction: 'Search vault coverage, including related incoming sources/contributing_ids. Read only; use explicit --vault.' })
phase('Sweep')
const lanes = ['official documentation', 'release notes and changelogs', 'issue trackers and bug reports', 'community posts and practitioner writeups']
const sweeps = await workers(lanes, mode,
  lane => agent({ lane, question: args.question, gaps: recon, cli: ctx.cli, vault: ctx.vault, instruction: 'Web search; return urls with why. No mutations.' }),
  (lane, result) => result.error ? { lane, error: result.error, urls: [] } : result)
const found = sweeps.flatMap(r => r.urls || []) // retain sweeps' errors in evidence status

phase('Fetch+Seed')
const extractions = await workers(found, mode,
  (request, i) => fetchProposal({ ...request, worker: `fetch-${i}`, ...ctx }),
  async (request, proposal, i) => {
    if (proposal.error) return { status: 'unresolved', worker: `fetch-${i}`, reason: proposal.error }
    const batch = saveBatch(task, `seed-${i}`, [proposal.spec])
    const captured = await persistBatch(task, batch, executeJson)
    if (captured.errors.length || captured.operation?.phase !== 'complete')
      return { status: 'unresolved', worker: `fetch-${i}`, recovery: captured.recovery }
    const sourceId = captured.operation.results[0].id
    return associateClaims(task, { ...request, worker: `fetch-${i}` }, { sourceId, claims: proposal.claims })
  })
const claims = extractions.flat().filter(e => e.claimId) // keep all other outcomes as limitations

phase('Verify')
const verdicts = await workers(claims, mode,
  claim => evaluateClaim({ ...claim, ...ctx }),
  (claim, evaluation) => verifyClaim(task, claim, evaluation))
// Only recorded, scoped verified outcomes support conclusions. captured freshness is separate.
// Missing/null workers and false verified=true remain explicit unresolved outcomes.

phase('Plan')
const PLAN = { type: 'object', required: ['planJson'], properties: { planJson: { type: 'string' } } }
const plan = await agent(`Selected CLI: ${ctx.cli}; selected vault: ${ctx.vault}. You are walking AGENTS.md §2.6 for: ${args.question}.
Verified claims: ${JSON.stringify(verdicts)}. Source extractions: ${JSON.stringify(extractions)}.
Walk the four prompts: (1) notes distilling load-bearing sources, (2) questions for every unresolved ambiguity (including every unverified claim), (3) experiments for any empirical run cited as evidence, (4) snippets for reusable fragments. Then ONE synthesis (cross-source claims + recommendation, with summary and confidence) whose contributingIds reference the notes (and other entries) by their deterministic ids (${args.today}-<slug>). Sources already exist in the vault — reference, do not recreate.
Every entry MUST carry a body field with real prose. Notes: load-bearing claims + caveats + how-I'd-use. Snippets: usage context + fenced code block + caveats. Questions: why it matters + what would answer it. Synthesis: written for a colleague who reads it once, cold, to decide what to do: the answer first, then the reasoning in paragraphs with each checked claim (research-vault-usage §4) as a sentence, then the recommendation; detail stays in the notes. summary stays ONE sentence — the substance lives in body. Return planJson: a JSON array string for capture --batch using camelCase capture opts keys (type, title, body, sources, contributingIds, topics, summary, confidence, state, question, language, tested, synthesisBasis...).`, { phase: 'Plan', schema: PLAN })

phase('Persist+Gate')
const batch = saveBatch(task, 'authored-1', JSON.parse(plan.planJson))
const persisted = await persistBatch(task, batch, executeJson)
const outcome = await closeOut(task, persisted.operation, { sweeps, extractions, verdicts },
  { lint, gate }, questionsActuallyResolved)
return { recon, persisted, outcome, taskDirectory: task.dir }
```

Pass `cli` and `vault` explicitly to the Plan worker too. Use structured prompt data or a payload file for questions, URLs and prose. If the host only accepts shell commands, use `shellCommand` with its actual shell (`posix` or `powershell`) for paths; do not concatenate payload text. Do not change fetch/network permission or source-body consent requirements.

`persistBatch` retries only explicitly retryable storage errors, with the identical plan and key, at most three attempts total. Permission denial, disk exhaustion, conflicts, changed input and uncertain lock ownership stop immediately. Keep every failed outcome; a partial research answer is allowed under the current question/artifact policy.

## 3. Degraded mode and recovery

With no Workflow tool, use the same primitives with `mode = 'sequential'`: vault search → web fetch → serialized eager capture → scoped verification → §2.6 Plan → opt-in batch persistence → current artifact/reference checks → lint → claims gate → justified question closure. Only retrieval/evaluation parallelism changes. Preserve the Plan prose and the existing artifact-selection exceptions.

Resume the existing research-orchestrate skill with the absolute task directory, from any cwd. `loadTask` loads saved paths, associations, batch locations and action intents. Inspect current artifacts and receipts before selecting remaining actions. Missing original plans or referenced inputs block recovery; never fabricate replacements. For an incomplete batch, `recovery(task, batch)` provides the exact absolute replay command with its original key. A complete receipt is historical: `persistBatch` skips capture and `currentPersistence` validates current artifacts and manifest. Run outstanding lint and claims review on current authored content.

Before retrying verification, reconstruct the original claim/evaluation from saved associations and verification intent. `verifyClaim` checks the stable marker and exact method/result/scope/evidence in existing notes; a match repairs manifest finalization without appending. A mismatch requires review. Verification intents are saved before any verification, including before the final plan exists. Before retrying question closure, `closeQuestion` compares current fields to saved pre-state and intended post-state, using the frozen summary. Matching post-state repairs finalization only; pre-state permits the original update; neither permits mutation. Do not blindly rerun successful actions.

If WARN_SYNTHESIS_NO_NOTE_COVERAGE or WARN_SYNTHESIS_MONOLITHIC requires decomposition, or claims review requires corrections after persistence, use research-authoring to edit the existing synthesis in place. Save that edit's intent before mutation. Capture only newly added notes/artifacts under a new key, then rerun lint and claims review with existing review caps. Never submit a modified synthesis through capture under its existing ID or reuse a key for a revised plan. Serialize these edits and manifest rebuilds too. Save action intent with `intent` before each task mutation, and inspect disk before retrying any uncertain action.

Keep the private task directory until explicit user cleanup; do not automatically delete it. For an abandoned opt-in writer lock, inspect its owner diagnostic and confirm that process is gone before explicitly removing the lock. The lock coordinates opt-in capture writers only; neither controller reconciliation nor that lock protects against concurrent legacy/external writers. Stop for review on conflicting human edits.

## 4. Close out

1. Confirm returned IDs against current disk, validate references and manifest, then run lint with the explicit vault — clean, or explain every warning. Track persistence, manifest/reference validity and lint disposition separately from research evidence.
2. Run the `research-claims-gate` skill on the synthesis entry file (evidence derives from its `contributing_ids` and `sources`), then present it to the user the way you would tell a colleague: the answer, why, how confident, and what is still open (question ids).
3. Only after persistence and the required claims gate pass, close questions the synthesis actually resolves. Keep question-update failures visible as partial lifecycle outcomes. List created and reused IDs; report claims-gate verdict and question closure separately from evidence status.
4. Offline or fetch-blocked? Do not fabricate: answer from the vault, record what could not be verified as open `question` entries, and say so.

## Anti-patterns (from ORCHESTRATOR-INTEGRATION.md)

Monolithic report files; source→synthesis with no notes (unless a declared `primary-rollup`); "I don't know" as prose instead of a `question`; reusable fragments inline instead of `snippets/`; stub notes written only to silence the lint.

Keep the normal final answer format. Show exact replay commands and the research-orchestrate resume instruction only for failure or unresolved work; successful runs need no receipt dump or extra confirmation.
