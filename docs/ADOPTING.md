# Adopting research-vault in a code project

The steps, in order, to make a repo cite its research from code, fail CI when a citation goes stale, and draw the result. Every command below is run from the repo root as `node <plugin>/bin/research-vault.mjs` followed by the command; in Claude Code the plugin is installed per the README and explicit wrappers live under `commands/`; use their documented names and arguments.

## 1. Put a vault inside the repo

```text
research-vault init --vault research
research-vault init --project --vault research --code-links 'src/**/*.ts,src/**/*.js'
```

The first command scaffolds `research/` (entry folders, `taxonomy.json`, a generated `AGENTS.md`, a `.gitignore` for the derived caches). The second writes `.research-vault.json` at the repo root, binding the repo to that vault and naming which files are code. Commit both. Code links need the vault inside the repo; a shared vault elsewhere can still be cited from prose, not from code.

The plugin ships comment and declaration patterns for Lua, the JavaScript and TypeScript family, Python, Go, Rust, Zig, Ruby, shell and C/C++. Another language, or a stricter rule, is two regexes under `code.languages` in that file; see the Reference, "Code links".

## 2. Say where the dependency version lives

Add a `versions` key for each dependency your code is checked against. The pattern's first capture group, matched against the whole file, is the declared version:

```json
"versions": {
  "sdk": { "file": "package-lock.json", "pattern": "\"node_modules/sdk\": \\{\\s*\"version\": \"([^\"]+)\"" }
}
```

For other version-file formats, supply a pattern that captures the declared version; the lockfile pattern above is an example configuration. Skip this step if nothing in the code depends on a versioned API.

## 3. Capture the research, then cite it above the code

Capture a source, note or snippet the usual way (`capture`, or in Claude Code "capture this page"). Then put its id on a comment line of its own directly above the column-0 declaration that rests on it, with a pin when the call is to a versioned dependency:

```ts
// Retry budget and backoff per 2026-03-03-sdk-retry-semantics@sdk=0.20
export async function withRetry(fn) {
```

Only blank and comment lines may sit between the comment and the declaration. One link per declaration the entry justifies; an indented method is not seen, so cite the enclosing column-0 declaration.

## 4. Check it

```text
research-vault check            # prints every link that is not ok
research-vault check --check    # exits 1 on stale, uncovered or unattached
research-vault check --json     # the rows, for tools
```

`uncovered` means the id names no entry; `unattached` means the comment reached no declaration. `stale` can indicate a superseded entry, missing version-configuration key, pinned-version mismatch, or failed freshness check. Pinned links use the version rule instead of the time rule, except volatile entries remain stale; unpinned links use freshness checks.

## 5. Fail CI on it

```yaml
research-vault:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with: { node-version: 22 }
    - run: git clone --depth 1 https://github.com/andrew-brooks-GA/research-vault.git /tmp/research-vault
    - run: node /tmp/research-vault/bin/research-vault.mjs lint --vault research
    - run: node /tmp/research-vault/bin/research-vault.mjs lint --vault research --check
    - run: node /tmp/research-vault/bin/research-vault.mjs check --check
```

The implementation defines a manifest write in the non-check `lint` path and a comparison in the `--check` path.

## 6. Gate the claims, when you want review

A linked symbol can be gated like a document: `gate evidence <file> --changed` lists the changed symbols and their evidence, a fresh `claims-reviewer` agent judges whether the code follows the entries it cites, and `gate record <file> PASS|MERIT "<note>"` stores the verdict keyed to that symbol's text. A later edit to the function reopens only that symbol. The `research-claims-gate` skill specifies this loop for Claude Code.

## 7. Look at it

```text
research-vault obsidian --vault research
```

writes `research/_obsidian/`, a derived, git-ignored view: one note per entry, one per linked code file, wikilinks for every edge, and a seeded graph configuration. Open that folder, not `research/`, as an Obsidian vault and use its graph view.

## 8. Feed your own graph

If the project already has a graph of its code, keep it and add the research as leaf nodes. Two outputs carry everything, both plain JSON: `research/.vault-manifest.json` after `lint`, and `check --json`. The keys are the integration contract in the Reference, "Reading the graph from outside", and `examples/graph-dot.mjs` is the join written out:

```text
node /path/to/research-vault/examples/graph-dot.mjs . > graph.dot
dot -Tsvg graph.dot > graph.svg
```

`examples/blast-radius.mjs` is the other direction, for the day a source is superseded: given the manifest, the entry's id and the `check --json` of every repo that cites the vault, it walks `sources` and `contributing_ids` inward and lists the entries that rest on it and every symbol or document citing one of them.

```text
node /path/to/research-vault/bin/research-vault.mjs check --json > check.json
node /path/to/research-vault/examples/blast-radius.mjs research/.vault-manifest.json <id> check.json ../other-repo/check.json
```

Rebuild the research outputs whenever the code graph is rebuilt. Keep generated outputs uncommitted and regenerate them after relevant changes.

## Codex entry points
<!-- evidence: 2026-11-13-codex-adapter-implementation 2026-11-13-codex-adapter-validation -->

Codex users can install project-local task skills and use a pinned CLI launcher from their bound repository. Follow [Codex setup](CODEX.md) for installation, review dispatch and explicit checks when hooks are unavailable. The existing vault and binding remain shared with Claude.
