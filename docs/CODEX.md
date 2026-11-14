# Using research-vault with Codex
<!-- evidence: 2026-11-13-codex-adapter-implementation 2026-11-13-codex-adapter-validation -->

The Codex integration installs project-local skills, reviewer definitions, a pinned CLI/package copy, and optional hooks. The Codex installer does not rewrite the source Claude plugin files. Both hosts use the same vault data and the existing claims ledger.

## Install in a project
<!-- evidence: 2026-11-13-codex-adapter-implementation 2026-11-13-codex-adapter-validation -->

From a research-vault checkout, run:

```sh
node bin/research-vault.mjs host install codex --at /absolute/path/to/your/project
```

Use Node 22 or newer. Create the destination project first. The installer defines a `launcher` result field containing the absolute launcher path. In your project, use that launcher to create and bind a vault:

```sh
node .research-vault-host/codex/run.mjs init --vault research
node .research-vault-host/codex/run.mjs init --project --vault research
```

You can instead bind an existing vault. Installation does not choose or change a vault, edit project AGENTS.md, alter global Codex settings, or change Claude configuration. Read the resolved vault's AGENTS.md before writing entries; `host paths` prints the resolved vault directory.

Start Codex in the project, trust the project configuration when appropriate, and review the installed hooks in `/hooks` before trusting them. Restart/discover skills after installation if they are not visible. The recorded live fixture used explicit project trust and hook trust; file installation alone is not evidence of successful host activation.

The installer owns these paths:

- `.research-vault-host/codex/`: a copied package and hash-checking launcher.
- `.research-vault-host/codex-install.json`: ownership and content hashes.
- `.agents/skills/`: the nine research skills and seven explicit task aliases, with teaching resources.
- `.codex/agents/`: claims-reviewer and lesson-reader definitions under research-vault-prefixed names.
- `.codex/hooks.json`: generated hook registration, unless `--without-hooks` is specified.

The installer checks ownership before replacing destination files; tests cover existing hooks, symlink and staging collisions. If you already have a hooks file, use `--without-hooks`; retain your settings and either use the explicit checks below or review and merge the adapter commands yourself. If you merge registrations manually, remove those registrations before uninstalling; they are not installer-owned. Do not register the same hook through two installations. Use one project installation rather than combining this route with another copy of the same Codex skills/plugin.

## Task equivalents
<!-- evidence: 2026-11-13-codex-adapter-implementation 2026-11-13-codex-adapter-validation -->

Use `$research` for the orchestration entry point. The other explicit aliases are `$research-init`, `$research-search`, `$research-related`, `$research-lint`, `$research-compile`, and `$research-obsidian`. They are generated from the Claude command bodies and marked explicit-only in their Codex policy metadata.

The nine full workflow skills retain their research names. Codex-generated instructions resolve CLI/assets to the installed package, use the host's question dialog or conversational questions, and select sequential research when Workflow is unavailable. Teaching format files and assets are copied with the skills. The learner interview remains in the parent conversation.

There is no automatic interception guarantee for hosted web search. Search the vault explicitly before web research. The generated instructions and session hook repeat this requirement.

## Claims review and lesson reading
<!-- evidence: 2026-11-13-codex-adapter-implementation 2026-11-13-codex-adapter-validation -->

The generated workflows use a new Codex CLI session for every review rather than resuming or forking the author's conversation:

```sh
node .research-vault-host/codex/run.mjs host review codex --role claims-reviewer --draft /absolute/path/to/draft.md --out /tmp/claims-review-1.json
node .research-vault-host/codex/run.mjs host review codex --role lesson-reader --draft lessons/0001-topic.html --out /tmp/reader-review-1.json
```

For evidence not cited in the draft, add `--extra <comma-separated-entry-ids>`. The claims path checks citations and constructs the changed-unit evidence list. It refuses stale/superseded or uncovered extra evidence. The reader can review a lesson or workspace README without a vault. Every output path must be new.

The default configured model is `gpt-6.1-sol` with `high` effort; use `--model` and `--effort` explicitly to choose another available configuration. The install-time options set the generated native agent definitions and generated review commands. Direct review-time options set the fresh CLI process; a manually entered review command without those options uses the CLI defaults. A process error is an error, not a fallback to another model or an author-written verdict.

The runner passes flags requesting disabled project instruction loading, hooks, plugins, apps, memories and web search for its new read-only CLI session. It passes the shared reviewer policy as the review request. It rejects missing/conflicting verdicts, incomplete processes, and draft/evidence changes during a claims review. Its JSON report names the mechanism, configured model/effort, policy and input hashes, verdict and response. Actual model identity is recorded as unknown because this runner does not establish it from runtime events.

The read-only sandbox is not a file-read or tool allowlist. Evidence-only access remains a reviewer instruction; this is not the same enforcement as Claude's declared Read/Grep/Glob list. Treat generated native Codex agents as operating within the host permission configuration; the generated definitions do not establish a separate file allowlist. Stronger isolated review bundles and strict ledger provenance are separate hardening work, not guarantees of this integration.

Inspect the report and follow the shared two-round claims-gate workflow. The runner does **not** record a ledger verdict. Record PASS only after a PASS response; use MERIT only with the required logged decision. Include the actual Codex mechanism and report path in GATE-LOG.md and the optional `gate record` note. The existing ledger's reviewer hash identifies the installed policy file, not the model that executed it. Reader READS/REVISE results belong in the teaching gate log, not the claims ledger.

## Hooks and explicit checks
<!-- evidence: 2026-11-13-codex-adapter-implementation 2026-11-13-codex-adapter-validation -->

The Codex adapter defines handler mappings for SessionStart, PreToolUse, PostToolUse and Stop. It translates apply_patch headers into a deduplicated set of created, updated, moved and deleted paths. The adapter error branch defines a warning system message; run the explicit checks instead of treating a skipped hook as success. Shell commands that edit files are not parsed as patches.

When hooks are unavailable or disabled, use the pinned launcher for search before web research, `lint --fix` after vault edits, `check --check <file>` for citations, `gate status <file> --check` before completing a gated draft, and `gate staged --check` before committing. For the session brief, run the installed `hooks/codex.mjs SessionStart` with a JSON event containing the current working directory. Contributors can run `node scripts/deps.mjs <edited-path>` in the source checkout for dependency advice; the adapter also offers a Dependencies event for an explicitly registered development hook.

## Upgrade and uninstall
<!-- evidence: 2026-11-13-codex-adapter-implementation 2026-11-13-codex-adapter-validation -->

Run the install command again from the desired research-vault checkout to update the pinned copy. Inspect first with `--dry-run`. The launcher checks copied package hashes; the tests demonstrate rejection of a modified package file. Project relocation requires reinstalling because generated instructions contain absolute paths.

```sh
node bin/research-vault.mjs host status codex --at /absolute/path/to/your/project
node bin/research-vault.mjs host install codex --at /absolute/path/to/your/project --dry-run
node bin/research-vault.mjs host uninstall codex --at /absolute/path/to/your/project
```

Status lists changed or missing owned files. Upgrade and uninstall refuse those conflicts: back up your edits and restore the owned files before retrying. Uninstall removes only unchanged manifest-owned files; it leaves vaults, bindings, personal files and unrelated configuration alone. Empty directories may remain. Do not remove the installation manifest while managed files are still installed.

## Validation scope
<!-- evidence: 2026-11-13-codex-adapter-implementation 2026-11-13-codex-adapter-validation -->

Live fixtures were run on macOS with Codex CLI 0.169.0: supported and unsupported claims returned PASS and FAIL-as-sent, the lesson reader returned REVISE for an incomplete page, and recorded SessionStart/PostToolUse/Stop events included a blocking Stop followed by its recursion guard. Older Codex versions and authenticated Linux runs have not been verified.

The automated tests cover installation ownership, quoting, nested-directory execution, pinned-package drift, rollback on a staging collision, event normalization, traversal rejection and review failure handling. Live Codex acceptance results are recorded separately from those tests. The current integration does not claim desktop/hosted support, enforced evidence-only filesystem access, or a strict replacement for legacy gate provenance.
