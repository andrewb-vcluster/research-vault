# Codex and Claude scaffolding parity plan

Make research-vault usable from both Claude Code and Codex without maintaining two research workflows. Deliver the same vault operations, teaching flow, evidence requirements, and review outcomes through a shared core and small host adapters. Preserve the existing Claude entry points while adding a documented Codex installation.

This is an implementation proposal. The phases and acceptance criteria below are requirements, not claims that the proposed integration already works. Initial release scope is the local Claude Code CLI and Codex CLI on macOS and Linux. Desktop and hosted sessions require their own compatibility runs before being advertised as supported.

## Current contracts and design constraints
<!-- evidence: 2026-11-13-parity-plan-repository-contracts 2026-11-13-parity-implementation-boundaries-acceptance -->

The repository declares two Claude plugin manifests, four plugin hook events, one repository-local dependency hook, seven commands, nine skills, two agent definitions, and a vault CLAUDE.md import shim. The three skills with explicit host dispatch/path dependencies are research-claims-gate, research-orchestrate, and research-teach. Treat the remaining skills as shared candidates that still require host acceptance tests.

The reviewer definitions declare Opus/high and omitClaudeMd, with read-oriented tool lists. The gate source hashes the whole claims-reviewer definition and compares that hash when selecting passing rows. Its ledger writer records the installed definition hash, not the actual executing host or model. Preserve that distinction during migration; a Codex review must never be presented as a run of the Claude reviewer.

Keep the zero-dependency ESM CLI, existing vault schema, IDs, binding lookup, and evidence ledger available to both hosts. Do not rename or remove existing public commands or files in this work. Before any later removal, run the dependency script and update its dependents. Add COUPLINGS entries for shared identifiers, generated content, dispatch names, prompt text, and ledger contracts.

## User outcomes and acceptable differences
<!-- evidence: 2026-11-13-parity-implementation-boundaries-acceptance 2026-11-11-codex-docs-hooks -->

Require these outcomes in both hosts:

- Install, initialize or bind a vault, discover research tasks, and resolve the CLI and assets from a nested working directory.
- Search, capture, verify, curate, lint, compile, inspect relations, and generate an Obsidian view.
- Research a question using vault-first lookup, capture supporting evidence, and report created entry IDs.
- Interview a learner, create lessons and a workspace README, run a fresh reader, run an evidence-only claims reviewer, and record their results accurately.
- Receive a session summary, post-edit citation advice, and a clear way to check unfinished gated work. Run explicit checks even when hooks are disabled.
- Switch hosts against the same vault and bound project without duplicating entries or silently accepting a review under a different reviewer policy.

Do not require identical slash syntax, model names, question dialogs, or parallel scheduling. Require documented equivalents and equal evidence standards. For example, the captured Codex hooks documentation says hosted WebSearch does not enter the local tool-hook path. Plan an explicit vault lookup before research as the supported fallback, and label the missing automatic interception in the compatibility table. Do not describe the fallback as automatic hook parity.

## Phase 1 Prove the host contracts
<!-- evidence: 2026-11-13-parity-target-host-loading-reviewer-isolation 2026-11-11-codex-docs-build-skills 2026-11-11-codex-docs-subagents-custom-agents 2026-11-11-codex-docs-hooks -->

Owner: host-integration implementer. This phase blocks final installation instructions, agent configuration, and release claims. Make enforced review isolation the first go/no-go probe: Phase 4 deliberately hardens review beyond what the current Claude configuration declarations alone establish. If neither host can meet it, revise the scope explicitly rather than calling weaker controls equivalent.

Create isolated fixture projects and a versioned capability report for each host. Capture the binary version, operating system, invocation, package location, model/effort configuration, observed input/output, and whether each result is a live run or a stub. Do not install or modify a maintainer's global configuration as part of the probe.

Probe package discovery, skill discovery and explicit invocation, command aliases, plugin-relative paths, asset lookup, nested directories, spaces in paths, reviewer dispatch, fresh history, inherited instructions, available tools, hook loading/trust, all four lifecycle events, post-edit payloads, and Stop recursion/session boundaries. Test both fresh installs and upgrades with existing user configuration. Derive minimum supported versions from successful runs rather than guessing a release number.

Use the documented repository-local skill location as a Codex installation candidate. The captured subagent documentation describes inherited permissions and says custom-agent instructions do not create a separate read-only sandbox. Therefore test a separate review process as well as custom-agent dispatch; select the route that actually meets Phase 4's isolation requirements. If neither route qualifies, keep the release blocked for automatic claims review rather than substituting self-review.

Output: a checked compatibility matrix and captured probe experiments. Close the linked vault question only for verified surfaces; leave unsupported surfaces explicitly open. Recheck documentation for the tested host versions before turning candidate formats into shipped configuration.

## Phase 2 Establish shared task and installation contracts
<!-- evidence: 2026-11-13-parity-plan-repository-contracts 2026-11-13-parity-implementation-boundaries-acceptance -->

Owner: packaging implementer. Depends on Phase 1 discovery results.

Keep one maintained body for each research skill and each reviewer role. Put host dispatch, question-tool selection, path resolution, and hook registration in explicit adapters. Prefer shared skill prose plus short host-specific instructions; generate host wrappers only where the validated formats require duplication. Add deterministic generation and drift checks if generation is introduced.

Define a package-root resolver that returns absolute CLI, schema, and asset paths. Use the installed package's location as authority, with a tested PATH-based entry point for standalone users. Do not depend on the invoking shell retaining CLAUDE_PLUGIN_ROOT, on the repository being the working directory, or on a global npm install. Include package identity/version checks to reject an accidental mismatch between the CLI and skill assets.

Build a Codex distribution using the Phase 1 validated mechanism. Prefer one host-managed plugin installation when it loads every required component; otherwise provide a project-local installer that registers skills, reviewers, and supported hooks from a pinned package copy. Record owned files in an installation manifest. Support dry-run, idempotent repeat install, upgrade, and uninstall; refuse conflicting edits rather than overwriting user configuration. If plugin installation is used, keep its lifecycle under the host's manager. Never activate both installation routes in the same project.

Keep the Claude manifests and command names compatible. The Codex entry-point mapping must cover research, research-init, research-search, research-related, research-lint, research-compile, and research-obsidian. Where native command definitions do not load, expose explicit task skills generated from the same task definitions. Preserve explicit-only initialization and prevent duplicate implicit triggers between aliases and full skills.

Acceptance: clean installs of each distribution discover every task; repeated installs do not duplicate tasks/hooks; nested paths and paths with spaces work; switching hosts preserves the binding and vault; user-owned settings survive uninstall. Test the packaged artifact, not only a source checkout.

## Phase 3 Make workflows and teaching host neutral
<!-- evidence: 2026-11-13-parity-plan-repository-contracts -->

Owner: workflow implementer. Depends on Phase 2 paths and entry points; reader/claims dispatch waits for Phase 4.

Update all nine skills and all seven command mappings. The research orchestrator must retain one capture/checklist contract whether a host provides Workflow, independent workers, or sequential execution. Use a question dialog when available and one conversational question at a time otherwise. Preserve the non-delegated learner interview and its ordering.

Update teaching asset installation, README reader mode, lesson reader dispatch, claims dispatch, and both teaching format files containing plugin-root commands or Claude-facing prompts. Replace new learner-facing Claude-specific prompt text with host-neutral wording. Teach lint and export must accept existing Claude wording during migration as well as the new canonical text; do not require rewriting every stored lesson. Update the prompt constant, lint requirement, export replacement and refusal checks, format documentation, fixture expectations, and coupling records together. Do not broaden export rewriting into arbitrary code or cited source text.

Keep vault AGENTS instructions canonical and the Claude shim intact. Give Codex users an explicit route to load the bound vault's instructions when working outside the vault. A project installer may propose a small managed reference block in project instructions; it must preserve existing text, avoid duplicate blocks and require an explicit install action. Do not mutate unrelated Gemini guidance merely because it mentions Claude.

Acceptance: exercise every skill's discovery and main path on both hosts; run research capture end to end; interview a learner; create one lesson and one workspace README; exercise both reader modes and both modern and legacy lesson export. Confirm that absence of a question dialog or Workflow changes presentation/scheduling, not evidence requirements.

## Phase 4 Implement reviewers and truthful provenance
<!-- evidence: 2026-11-13-parity-plan-repository-contracts 2026-11-13-parity-implementation-boundaries-acceptance -->

Owner: review/gate implementer. Depends on Phase 1 isolation probes and Phase 2 packaging. This is a release-critical phase.

Keep claims-reviewer and lesson-reader policy bodies shared. Emit the required host definitions with explicit supported model and effort settings. Allow deliberate overrides, record the resolved settings, and fail clearly on unavailable models instead of silently downgrading. Do not rank models across vendors as equivalent without evidence; the acceptance contract is review quality and isolation.

Require a fresh review with no author conversation, no editing or network access, no inherited project instructions influencing the verdict, and no unrelated tools. The claims reviewer receives the exact draft, evidence list, cited vault bodies and authorized images; it may search the allowed vault entry folders for contradictions. The reader receives only the lesson or README. Prefer a restricted review bundle/process when a native agent cannot enforce those boundaries. Include an immutable snapshot of all permitted vault entry folders, or a bounded read/search broker over that snapshot, so the omitted-entry contradiction search remains possible. Mark the original evidence list separately: a newly discovered entry can contradict a claim but cannot silently become positive support. Refuse truncated evidence, inaccessible required bodies, unsupported required images, or a snapshot exceeding tested capacity; never shrink the evidence scope silently. A read-only sandbox alone is insufficient if it still exposes unrelated files or execution tools. If these controls cannot be enforced on a target, document that limitation and do not mark that route as the qualifying automated gate.

Implement one review runner that creates the immutable input manifest, launches the adapter, observes runtime metadata, stores the response, validates it and records the result. Keep the manual gate record command compatible, but classify its assertions as manual/unverified under the new strict policy; caller-supplied fields alone cannot qualify as an automated run. The maintainer approves versioned execution profiles. Missing reported model identity may qualify only when a tested profile can establish the effective model from a pinned invocation with no fallback; otherwise it stays unverified. This boundary addresses accidental or agent-authored misattribution, not a malicious owner who can rewrite the program and ledger.

Add versioned review provenance: policy digest, host adapter digest, actual host, configured and reported model/effort, isolation mode, and review artifact reference. Bind the response to the draft/unit hashes and evidence hashes that were actually reviewed; refuse recording if those inputs changed during the review. Record unavailable runtime metadata as unknown rather than invented. Reject malformed or conflicting verdict output; never translate FAIL-as-sent to PASS. Keep MERIT a separately logged decision under the two-round policy.

Define strict validity per unit identity, content hash, reviewer policy, accepted execution profile and input dependencies. Persist exactly the unit IDs reviewed in that invocation; never re-attest inherited units when another unit passes. Include evidence bodies, verification/status metadata, version pins and authorized image hashes. Also include the permitted contradiction-search corpus digest: adding, removing or changing a permitted entry conservatively reopens dependent claims reviews even when draft text is unchanged. This intentionally costs more reviews; optimize it only with a separately reviewed invalidation rule. Reader results depend on the reader input rather than the vault corpus. Different vendor models may satisfy the same approved policy; switching hosts alone must not invalidate coverage. Policy or profile revocation must reopen affected units. For an identical policy/input snapshot and unit, an accepted FAIL revokes earlier passing coverage until a later qualifying review passes or an explicit permitted MERIT decision resolves it. Aggregate only currently valid unit coverage.

Use a new claims-v2 event for strict automated rows, with a versioned policy sidecar and a reader in the updated CLI. Keep legacy rows readable and append-only, labelled legacy/unverified-execution; require a fresh review before they satisfy strict automated checks. Route every strict consumer, including status, changed units, staged checks, Stop and teaching/export eligibility, through the same validity evaluator. The installer/launcher must reject unsupported CLI versions when strict policy is selected. The captured legacy acceptance predicate has no strict-policy or execution-profile check. Treat direct execution of pre-migration binaries as an unsupported downgrade and verify its behavior with the planned released-binary experiment. Support rollback only to compatibility-aware releases that understand the policy; do not promise safe downgrade to older binaries. Document the one-time re-review cost and this downgrade limitation before activation.

Acceptance: seed an author-only false hint and unrelated-file canary; show the reviewer does not receive them. Inspect the actual input manifest and allowed-search results, and prove forbidden write/network/tool access fails; a canary absent from the final answer is insufficient. Check a supported claim, an unsupported claim, an omitted contradictory entry, an image claim, README reader mode, timeout, unavailable model, malformed response, and edit-during-review. Run the same cases through both adapters; require policy-correct outcomes, not identical wording. Test evidence changes after PASS, corpus additions, mixed-profile partial coverage, legacy/new mixtures, revoked profiles and PASS followed by FAIL on unchanged content. Test a pre-migration binary against a ledger containing a legacy PASS to demonstrate the documented downgrade limitation. Preserve the original reviewer definition hash in historical records.

## Phase 5 Adapt hooks and explicit fallbacks
<!-- evidence: 2026-11-13-parity-plan-repository-contracts 2026-11-11-codex-docs-hooks -->

Owner: hook implementer. Depends on Phase 1 event fixtures, Phase 2 installation, and Phase 4 gate validity.

Extract shared hook operations from host event parsing. Normalize observed payloads to event name, working directory, affected file set, query/URL, and session information, then encode output in each host's validated format. Retain existing Claude behavior as a regression target. Validate command quoting and timeouts through real host invocation; do not assume a command-plus-args representation works on both.

Cover the session brief, pre-web lookup/blocklist advice and usage logging, post-edit repair/citation/version checks and usage logging, Stop gating, and the repository-local dependency notification. Multi-file patches must include creates, updates, moves and deletes. Reject paths escaping the project/vault boundary. Do not execute patch text or parse shell commands as trusted edit events. Where the host provides no usable edit event, surface the limitation and require explicit checks at task completion and before commit.

Specify Stop behavior for missing transcripts, recursion, disabled hooks, concurrent sessions and changed images/version files. Keep advisory errors visible without blocking unrelated operations; use the explicit gate command for the completion decision. Respect host hook trust and avoid registering the same handler through both project settings and plugin settings.

Document a manual equivalent for every hook: session brief, vault-first search, post-edit lint/citation/dependency checks, and gate status/staged checks. Label reduced automation. Git pre-commit checks are a local enforcement option, not a claim that commits or pushes cannot bypass policy.

Acceptance: replay recorded event fixtures, then exercise both real hosts with hooks enabled and disabled. Verify multi-file edits, rename/delete, absent vault, malformed payloads, duplicate registration, missing transcript, nested repo, spaces, stale pins and changed images. Assert that explicit checks still identify invalid work when hooks never fire.

## Phase 6 Cover the full supporting surface
<!-- evidence: 2026-11-13-parity-plan-repository-contracts -->

Owner: documentation/test implementer. Starts alongside Phases 3–5; completes after their contracts stabilize.

Maintain a component checklist covering manifests, local settings, hook handlers, commands, all skills and supporting teaching formats, both agent definitions, vault templates, gate provenance, prompt lint/export code, dependency coupling rules, install instructions, security documentation and tests. Add a Codex counterpart to the repository's own dependency notification where supported; otherwise document the explicit dependency command for contributors.

Update README, reference, adoption, orchestrator integration, migration, security, and the existing parity matrix. Publish host-specific installation, invocation, trust, troubleshooting, model configuration, upgrade/uninstall and fallback instructions. Separate active integration from ignored historical specs, execution records and gate logs; link relevant design records without bulk-editing history or counting keyword matches as components.

Extend tests at the integration boundaries, including gate provenance, session teaching summaries, hook configuration and events, command/skill registration, agent definitions, package manifests, dependency graph, and teaching exports. Recheck generated AGENTS drift and keep the existing golden-file generation rule. Add a changelog entry for every implementation change.

## Phase 7 Validate and release
<!-- evidence: 2026-11-13-parity-plan-repository-contracts 2026-11-13-parity-implementation-boundaries-acceptance -->

Owner: release maintainer. Depends on all prior acceptance criteria.

Keep credential-free CI for unit/contract tests, generated-file drift, install lifecycle tests and stubbed process failures. Do not call a stubbed reviewer a real-model test. Run npm test, npm run lint:self, the AGENTS drift check, encoding check, dependency checks, and claims checks for each changed gated document.

Run separate authenticated release acceptance on the minimum supported version and the release-tested current version of each CLI, on macOS and Linux. Use throwaway user homes and repositories, never production vaults; scope credentials to the host invocation and keep them out of artifacts. Record actual models/efforts and sanitized transcripts. Require successful install/upgrade/uninstall, task discovery, all nine workflow smoke checks, seven entry-point equivalents, two reviewer roles, enabled/disabled hook cases, and alternating-host use of one vault/ledger.

For quality-critical review fixtures require expected supported/unsupported outcomes on both hosts, including adversarial instruction injection in evidence. Treat any unexpected PASS, contaminated review, silent fallback, or missing core task as release-blocking. A maintainer-owned live acceptance job may run separately from pull-request CI, but its results must exist before release. If access to either host is unavailable, mark the release candidate unverified and stop short of claiming parity.

Release an additive compatibility version with a migration guide and explicit supported-version table. Stage provenance migration before enabling strict acceptance. Supply a rollback path between compatibility-aware releases that restores adapter installation and owned configuration from backups while preserving vault content and ledger history. Updated launchers must refuse unsupported CLI versions; direct use of pre-migration binaries remains an explicitly unsupported downgrade. No parity release is complete until both-host acceptance artifacts are attached and remaining automatic-hook differences are visible to users.

## Execution order and review checkpoints
<!-- evidence: 2026-11-13-parity-implementation-boundaries-acceptance -->

Use small reviewable changes in this order: capability probes; shared path/install contracts; reviewer provenance and adapters; shared workflows and teaching compatibility; hook adapters; documentation and acceptance automation; live acceptance and release. Documentation work may proceed alongside implementation, but final compatibility statements wait for live results.

At each boundary, run an adversarial review of lost guarantees and migration risks. Run a claims gate on the resulting documentation against captured source/probe evidence, fix findings, and record the actual review mechanism. Do not confuse a plan's claims verdict with proof that the planned implementation exists. The release maintainer owns the final go/no-go decision against Phase 7's checklist.
