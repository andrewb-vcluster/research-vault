# Research persistence and recovery
<!-- evidence: 2026-11-13-reliability-code-v2 2026-11-13-reliability-tests-v2 -->

The opt-in capture protocol separates validation-before-write from crash recovery. It is not an all-or-nothing transaction or a power-loss durability guarantee. Research verification, lint and the claims gate remain separate from successful persistence.

## Immutable operations
<!-- evidence: 2026-11-13-reliability-code-v2 2026-11-13-reliability-tests-v2 -->

Create and retain one opaque operation key before the first attempt. Save the JSON-array plan and its referenced inputs; use a new key for a changed plan. Invoke capture with explicit absolute CLI, plan and vault paths and `--operation-id <key>`. Prefer argument arrays to shell interpolation. A relative `contentFile` resolves against the plan directory.

The v1 receipt stores the canonical vault identity, input and schema digests, frozen date, phase, manifest state, ordered input results and errors, without copies of source bodies. Object-key order does not affect the digest; array order and referenced file bytes do. A prepared receipt precedes artifact publication. Each destination is published exclusively; a differing collision is a conflict. Source URL/version reuse returns the actual existing ID. A dependent reference to an uncreated alias fails validation; replan with the returned ID under a new key.

## Replay and repair
<!-- evidence: 2026-11-13-reliability-code-v2 2026-11-13-reliability-tests-v2 -->

For an incomplete operation, run the original capture command again. Matching files published before their receipt update are reconciled against the prepared destination and fingerprint. A missing pending file can be published; changed files or missing previously completed files require repair and are not overwritten or recreated automatically. Manifest failure retains created outcomes; replay can retry finalization without rewriting artifacts.

If initial receipt persistence fails, `recoveryStateCreated=false` and no artifact is published. Later receipt replacement failure retains the previous readable receipt and stops publication. Inspect the structured report and disk before recovery. Errors identify an input index or finalization phase. Only explicitly classified temporary I/O errors (`EINTR`, `EBUSY`, `EAGAIN`) are retryable; permission denial, disk exhaustion and lock uncertainty require intervention.

A complete receipt is historical. Identical CLI replay returns `replay=true, historical=true` without writing artifacts or revalidating their current bytes. Supplied operation inputs must still match; missing inputs and changed plans do not return historical success. Legitimate later authoring edits belong to the existing artifact. Current completion requires a separate disk/reference/manifest check.

## Writer lock
<!-- evidence: 2026-11-13-reliability-code-v2 2026-11-13-reliability-tests-v2 -->

Opt-in writers use the vault's `.capture-operations/writer.lock` directory with an `owner.json` diagnostic naming the operation and process. A competing writer fails rather than stealing it. Interruption may leave the lock behind: inspect the diagnostic and confirm the original process is gone before explicitly removing that lock directory, then replay the original command. Never reclaim a lock just because it is old. Legacy and external writers outside this protocol are not coordinated by this lock.

## Research task recovery
<!-- evidence: 2026-11-13-reliability-code-v2 2026-11-13-reliability-tests-v2 -->

The reference controller saves a private task directory under `.research-tasks/<task-key>` before research mutations. Keep it until explicit user cleanup. These task files and capture receipts are outside artifact discovery. Workers propose mutations; the controller awaits each mutation in both Workflow and sequential modes. Retrieval and evidence evaluation may overlap.

For incomplete batch publication, use the exact absolute capture replay command returned by the controller, with the original key and inputs. For downstream lifecycle recovery, resume the existing research-orchestrate skill and name the absolute task directory. Load saved intents, inspect current artifacts, and select remaining checks; there is no new CLI task runner. Missing original inputs block resume. After a complete receipt, resume lifecycle checks without recapturing.

Verification intents save a stable marker, target, method/result, evidence and claim scope before mutation. A retry with a matching recorded row repairs finalization without appending another row. Question intents freeze the summary and pre/post fields. Matching post-state requires only finalization repair; matching pre-state permits the saved update; other edits require review. This does not guarantee safety against concurrent external writers.

After persistence, correct authored artifacts in place through research-authoring, then rerun lint and claims review. Capture newly added decomposition notes under a new key. Close only questions actually resolved by a persisted, gated synthesis. Keep evidence status, persistence, references/manifest, lint disposition, claims verdict and question closure distinct; show recovery details when work remains incomplete.

## Validation limits
<!-- evidence: 2026-11-13-reliability-tests-v2 -->

Deterministic tests exercise isolated vaults and mocked controller callbacks, including both execution modes, interrupted publication, failed storage, lost mutation acknowledgments and current-artifact checks. They do not establish model adherence or universal reliability. Real-host acceptance is **NOT RUN**: the available Claude installation reported no authenticated session. Behavioral release acceptance remains open; no routing or performance improvement is claimed.
