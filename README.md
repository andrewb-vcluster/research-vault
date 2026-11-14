# 🗃️ research-vault

A research notes folder with provenance and freshness metadata for your coding agent.

![CI](https://github.com/andrew-brooks-GA/research-vault/actions/workflows/ci.yml/badge.svg)
![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)
![Node ≥22](https://img.shields.io/badge/node-%E2%89%A522-brightgreen.svg)
![dependencies: 0](https://img.shields.io/badge/dependencies-0-brightgreen.svg)

## The problem

An answer without a source or freshness date leaves you to decide how much to trust it. Keep the evidence alongside your notes so it is available for later checks.

## What this does

research-vault gives the agent a folder of Markdown notes and instructions to search, cite and maintain it.

- **Capture for later use.** Ask the agent to capture a doc page, a paper or a decision. It writes an entry with the right metadata. The entry stays on disk for later sessions; retain and back up your vault.
- **Every entry has a review interval.** Fundamentals get three years, mature practices one year, tool-specific facts ninety days, and prices or "current best model" claims are always flagged for re-checking. The instructions require the agent, before citing an entry, to compare the last check against the interval and report when it might have aged.
- **Answers come from your notes first.** Each vault carries an instructions file that tells the agent to search it before guessing, and to say how fresh what it found is.
- **Your code can cite it too.** In a repo bound to a vault inside it, a comment above a function names the entry the function was written against, optionally pinned to the dependency version your project declares. When that version changes, `check` reports exactly those functions as stale and `check --check` exits 1; the review gate re-checks only the functions that changed.
- **Plain files and a CLI.** A Claude Code plugin and a Node command-line tool. Other agents can use the files and instructions with an appropriate host integration; this is not an arbitrary-host compatibility guarantee.

Plain Markdown. Nothing to install beyond Node. Source ingest and embedding have explicit network opt-ins.

## What it looks like

The dialogue and transcript below are illustrative, not captured acceptance runs.

```text
You:    digging into vcluster sleep mode — capture https://docs.vcluster.com/sleep-mode
Claude: Captured · vcluster 0.20 · topics: kubernetes, vcluster, cost-optimization

  …four months later, a brand-new session…

You:    how does vcluster sleep mode work again?
Claude: From your vault (vcluster 0.20 · last verified 4 months ago):
        sleep mode scales idle workloads to zero and wakes them on demand…
        ⚠ fast-moving and past its 90-day window — want me to re-verify against the live docs first?
```

And from code, in a repo whose vault lives inside it:

```text
-- sleep call order per 2026-03-03-sleep-mode-api@sdk=0.20.4
local function sleep(client)
  ...

$ research-vault check          # after package-lock.json moves the sdk to 0.21.0
STALE     src/sleep.lua:1 sleep  2026-03-03-sleep-mode-api  (sdk 0.20.4 -> 0.21.0)
check: 4 file(s); 2 ok, 1 stale, 0 uncovered, 0 unattached, 3 code link(s)
versions: sdk=0.21.0
```

## Install

The Claude commands below are an installation recipe; authenticated Claude acceptance has not been run for this update.

In Claude Code:

```text
/plugin marketplace add https://github.com/andrew-brooks-GA/research-vault.git
/plugin install research-vault@research-vault
/reload-plugins
/research-vault:research-init
```

Without Claude Code:

```text
git clone https://github.com/andrew-brooks-GA/research-vault.git
node research-vault/bin/research-vault.mjs init
```

<!-- evidence: 2026-11-13-codex-adapter-implementation 2026-11-13-codex-adapter-validation -->

For Codex, install the project-local integration with `node research-vault/bin/research-vault.mjs host install codex --at /absolute/path/to/project`. See [Codex setup, review workflows, hooks, and uninstall](docs/CODEX.md). This keeps the existing Claude plugin configuration intact.

In a repo you work in, `research-vault init --project` writes a `.research-vault.json` that points the repo at a vault, so commands run inside it resolve there unless `--vault` is passed. To keep the vault inside the repo and let its code cite entries, run `research-vault init --vault research` first, then `research-vault init --project --vault research --code-links 'src/**/*.ts'`; the plugin ships comment and declaration patterns for Lua, JavaScript and TypeScript, Python, Go, Rust, Zig, Ruby, shell and C/C++, and a project adds or overrides a language as two regexes in that file. [Adopting in a code project](docs/ADOPTING.md) walks the whole path from first link to CI to graph.

## Day to day

Skills declare descriptions for the following requests. The table summarizes their instructions; actual host selection and model adherence require host validation.

| You say | Instructed workflow |
|---|---|
| "capture this page" | A source entry is written with the URL, version and topics. Duplicates are caught. |
| "what do I know about X?" | The vault is searched first. You're told how fresh the answer is and offered a re-check if it's past its interval. |
| "research X" | Answered from the vault if possible. Otherwise the agent searches the web and files every source, note and open question as entries, not a one-off report. |
| "what needs attention?" | A report of entries past their interval, conclusions resting on aged evidence, entries nothing links to, and sources nobody has written up yet. |
| "teach me X" | A teaching workspace: mission, short lessons with quizzes, reference sheets. Every fact comes from the vault or a kept probe run, and a fresh reviewer agent fails any lesson that claims more than the evidence shows. |
| "gate this draft" | A fresh reviewer agent checks every claim against the vault entries on its evidence list, plus any contradicting entry it finds in the vault; the verdict is stored per unit of the file, so an edit reopens only the units it touches (the whole file for a draft with no units). |
| "verify this" | The entry is checked by a suitable method (re-fetching, cross-referencing, a local probe, or your say-so) and the result recorded. A wrong entry is marked as replaced by a corrected one. |
| "this function follows that entry" | A comment line above the declaration cites the entry, pinned to the version your project declares when the call is to a versioned dependency. The link is checked with the rest of the repo, and the gate reviews that one symbol, by its own line range, when its body changes. |

Explicit commands are listed in the reference. Agent workflows such as teaching and claims review also require their skill steps.

## Learning something

This section is for someone learning a topic rather than building software, and it assumes Claude Code. You need Node 22 or newer; the four install lines above are typed into Claude Code, and the last of them prints a `RESEARCH_VAULT_PATH` line to add to your shell profile so later sessions find your vault.

Start Claude Code in a project folder (a repo) you want the lessons kept in and say "teach me X". The teaching skill instructs the agent to bind the folder to your vault, then ask an interview as multiple-choice questions in its dialog, one per term or tool it needs to know about, in groups of up to four, and write a mission and a path of lessons from your answers. Each lesson is a web page served on your own machine, with an index of every lesson and a navigation bar. Concept, diagnose and review lessons carry a quiz; answered on the served page, it records your score. The lesson format requires a reminder to ask follow-up questions in the terminal; answering them remains an agent task.

For the terminal workflow described here, start Claude Code in the project folder before beginning.

## How a vault is organized

Captured pages go in `sources/`, your take on them in `notes/`, and conclusions drawn across several notes in `synthesis/`. Code fragments, trial runs and open questions have folders of their own.

Notes point at their sources and syntheses at their notes, so the agent can trace what a conclusion rests on and what breaks when a source turns out to be wrong. The Obsidian export generates wikilink notes and graph configuration for opening in Obsidian.

## Learn more

- [Reference](docs/REFERENCE.md): commands and flags, where the vault lives, binding a repo, code links, extending the vocabulary, safety rules, design notes.
- [Adopting in a code project](docs/ADOPTING.md): the ordered steps from a vault in the repo to a cited function, a failing CI check, a gated symbol and a graph, with the join for your own graph tool in `examples/graph-dot.mjs`.
- [Migrating existing notes](docs/MIGRATION.md) · [Building your own orchestrator](docs/ORCHESTRATOR-INTEGRATION.md) · [Exporting for fine-tuning](docs/FINETUNING.md)
- [Security](SECURITY.md) · [Changelog](CHANGELOG.md)

## License

[MIT](LICENSE) © Andrew Brooks
