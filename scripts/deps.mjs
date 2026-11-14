#!/usr/bin/env node
// Derived dependency graph of this repo (spec 14): computed from the working tree on every run, never
// stored. Who imports, reads, tests, documents or invokes a file, plus the couplings no path connects.
//   node scripts/deps.mjs          print every broken edge as `<kind> <from> -> <to>`, exit 1 if any
//   node scripts/deps.mjs <id>     distance-1 dependents of a file, cli:<cmd> or npm:<script>
//   node scripts/deps.mjs --hook   PostToolUse: additionalContext naming the edited file's dependents
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, posix, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOC_EXT = 'mjs|js|md|json|yml|css|html';
// Every extension in the tree must be in one of these two sets (test/deps.test.mjs). '' is the
// extensionless bin/research-vault shim; dotfiles and LICENSE share it and yield nothing.
export const EXTRACTED = new Set(['.mjs', '.js', '.md', '.yml', '.json', '']);
export const IGNORED = new Set(['.cast', '.css', '.html']);
// Files no extractor reads: release history legitimately names removed files; the other two quote
// every syntax (COUPLINGS rows are couples edges, the sample table is test input).
const UNSCANNED = new Set(['CHANGELOG.md', 'scripts/deps.mjs', 'test/deps.test.mjs']);

// Pairs that depend on each other through something other than a path: a copied value, a printed
// string, a name, a format. Add a row with the change that creates one (AGENTS.md); the test fails
// when either end leaves the tree. Seeded from the 2026-10-27 seven-agent inventory. A row is
// [from, to, why] or [from, to, why, literal]: the optional literal, a string or regex, is the shared
// text itself, and the test fails when either file stops containing it. Give one only when the
// literal really is in both files; a row about two values being equal stays prose.
export const COUPLINGS = [
  ['bin/lib/capture-operation.mjs', 'bin/commands/capture.mjs', 'opt-in key syntax and structured validation error protocol', 'INPUT_INVALID'],
  ['bin/lib/capture-operation.mjs', 'bin/lib/research-controller.mjs', 'receipt phases, operation identity and retryable error codes', 'complete'],
  ['bin/lib/capture-operation.mjs', 'docs/RELIABILITY.md', 'receipt v1, replay and lock recovery protocol', 'historical'],
  ['bin/commands/capture.mjs', 'docs/REFERENCE.md', 'opt-in operation-id and receipt output contract', 'operation-id'],
  ['bin/lib/research-controller.mjs', 'skills/research-orchestrate/SKILL.md', 'shared reference controller callbacks, intent and recovery protocol', 'persistBatch'],
  ['bin/lib/research-controller.mjs', 'docs/RELIABILITY.md', 'task recovery and scoped mutation reconciliation', 'research-orchestrate'],

  ['bin/lib/codex-review.mjs', 'agents/claims-reviewer.md', 'the shared policy and PASS/FAIL-as-sent review protocol'],
  ['bin/lib/codex-review.mjs', 'agents/lesson-reader.md', 'the shared reader policy and READS/REVISE protocol'],
  ['bin/lib/codex-review.mjs', 'bin/lib/host-install.mjs', 'the generated review command and default model/effort'],
  ['bin/commands/host.mjs', 'docs/CODEX.md', 'the installation and review CLI contract'],
  ['bin/commands/host.mjs', 'docs/REFERENCE.md', 'the host command reference'],
  ['bin/lib/host-install.mjs', 'hooks/codex.mjs', 'the generated Codex hook event names and adapter command'],
  ['bin/lib/host-install.mjs', 'agents/claims-reviewer.md', 'the shared reviewer body and generated Codex dispatch identity'],
  ['bin/lib/host-install.mjs', 'agents/lesson-reader.md', 'the shared reader body and generated Codex dispatch identity'],
  ['bin/lib/host-install.mjs', 'skills/research-claims-gate/SKILL.md', 'the exact Claude dispatch and plugin-root forms translated for Codex'],
  ['bin/lib/host-install.mjs', 'skills/research-teach/SKILL.md', 'the exact reader dispatch and plugin-root forms translated for Codex'],
  ['bin/lib/host-install.mjs', 'skills/research-orchestrate/SKILL.md', 'the plugin-root form translated for Codex'],
  ['hooks/codex.mjs', 'hooks/hooks.json', 'the four lifecycle event names and shared handler selection'],
  ['hooks/codex.mjs', 'scripts/deps.mjs', 'Dependencies maps to the development PostToolUse --hook protocol'],
  ['bin/research-vault', 'bin/research-vault.mjs', 'the shim execs ./research-vault.mjs by name'],
  ['bin/research-vault.mjs', 'docs/REFERENCE.md', 'the command table restates the commands map'],
  ['bin/research-vault.mjs', 'test/smoke.test.mjs', 'the --help usage line is asserted in order', '--help'],
  ['bin/lib/fsutil.mjs', 'schema/taxonomy.json', 'TYPE_FOLDER keys and folders equal artifact_type and stage_by_folder keys'],
  ['bin/lib/fsutil.mjs', 'agents/claims-reviewer.md', 'the {sources,notes,...} folder list is TYPE_FOLDER'],
  ['bin/lib/validate.mjs', 'bin/lib/lintrules.mjs', 'ENUM_META needs an entry for every CONTROLLED_FIELDS field', 'CONTROLLED_FIELDS'],
  ['bin/lib/manifest.mjs', 'bin/commands/lint.mjs', "the '.vault-manifest.json' literal is written in both", '.vault-manifest.json'],
  ['bin/lib/manifest.mjs', 'schema/taxonomy.json', 'CONFIRMING_RESULTS is a subset of verification_result'],
  ['bin/lib/ids.mjs', 'bin/lib/citations.mjs', 'makeId output must match ID_RE'],
  ['bin/lib/ids.mjs', 'bin/lib/agentsmd.mjs', 'the filename-is-the-id rule is restated in the generated AGENTS.md'],
  ['bin/lib/ids.mjs', 'bin/lib/gate.mjs', "sha256 formats differ: 'sha256:<hex>' stored, bare hex in the ledger", 'sha256:'],
  ['bin/lib/stale.mjs', 'vault-template/meta/freshness-policy.md', 'the last_verified rule and the volatility windows are restated in §2-3', 'last_verified'],
  ['bin/lib/stale.mjs', 'vault-template/meta/prompt-templates/verify-entry.md', 'steps 1-2 restate the last_verified rule and the windows', 'last_verified'],
  ['bin/lib/stale.mjs', 'skills/research-vault-usage/SKILL.md', 'the 90-day window and the last_verified rule are written out', 'last_verified'],
  ['bin/commands/search.mjs', 'docs/REFERENCE.md', 'the --sort values and the no tier / fresh / stale annotation words', 'no tier'],
  ['schema/taxonomy.json', 'vault-template/meta/freshness-policy.md', 'refresh_after_days are hand-copied into the §2 table; method and result lists into §5', 'tool-probe'],
  ['schema/taxonomy.json', 'vault-template/meta/prompt-templates/verify-entry.md', 'windows in step 2, method and result lists in steps 3-4', 'tool-probe'],
  ['schema/taxonomy.json', 'vault-template/meta/prompt-templates/probe-tool.md', 'verification method names', 'tool-probe'],
  ['schema/taxonomy.json', 'skills/research-verify/SKILL.md', 'method and result lists', 'tool-probe'],
  ['schema/taxonomy.json', 'skills/research-capture/SKILL.md', 'the enum lists under Optional fields (authority_basis among them)', 'community-report'],
  ['schema/taxonomy.json', 'docs/REFERENCE.md', 'volatility windows, domain values and the extensible fields are hand-listed', 'llm-assisted-dev'],
  ['schema/taxonomy.json', 'README.md', 'the volatility windows are written as prose', /\b90\b/],
  ['schema/taxonomy.json', 'test/helpers.mjs', 'put() hardcodes domain, method, by_type, result and volatility values', 'by_type'],
  ['schema/taxonomy.json', 'bin/commands/capture.mjs', 'the default domain, volatility, source_type, confidence, outcome, state and language values', 'source_type'],
  ['schema/teach-taxonomy.json', 'skills/research-teach/LEARNING-RECORD-FORMAT.md', 'kind values, types and the learning-records folder are hand-copied', 'learning-records'],
  ['schema/frontmatter.schema.json', 'bin/lib/graph.mjs', 'DEPENDENCY_RELS must be a subset of edge_fields.backlink'],
  ['schema/frontmatter.schema.json', 'hooks/pre-web.mjs', 'title, topics, summary, source_url, status and type are read by name', 'source_url'],
  ['bin/commands/init.mjs', 'vault-template/README.md', 'VAULT_MARKERS names this file for non-empty detection'],
  ['bin/commands/init.mjs', 'vault-template/CLAUDE.md', 'VAULT_MARKERS names this file for non-empty detection'],
  ['bin/commands/init.mjs', 'vault-template/GEMINI.md', 'VAULT_MARKERS names this file for non-empty detection'],
  ['bin/commands/init.mjs', 'commands/research-init.md', 'the non-clobber and --refresh-docs behaviour is described', 'refresh-docs'],
  ['bin/commands/init.mjs', 'bin/lib/resolve.mjs', 'init derives home from HOME||USERPROFILE, resolve from os.homedir()'],
  ['bin/lib/resolve.mjs', 'docs/REFERENCE.md', 'the vault resolution order is written out', 'RESEARCH_VAULT_PATH'],
  ['bin/lib/resolve.mjs', 'commands/research-init.md', 'the vault resolution order is written out', 'RESEARCH_VAULT_PATH'],
  ['bin/lib/resolve.mjs', 'skills/research-vault-usage/SKILL.md', 'the vault resolution order is written out', 'RESEARCH_VAULT_PATH'],
  ['bin/lib/resolve.mjs', 'skills/research-orchestrate/SKILL.md', 'the vault resolution order is written out', 'RESEARCH_VAULT_PATH'],
  ['bin/lib/resolve.mjs', 'skills/research-claims-gate/SKILL.md', 'the vault resolution order is written out', 'RESEARCH_VAULT_PATH'],
  ['bin/lib/resolve.mjs', 'hooks/session-start.mjs', "the source label 'project' gates the workspace briefs"],
  ['bin/lib/projectconfig.mjs', 'docs/REFERENCE.md', 'EXTENSIBLE_TAXONOMY_FIELDS, topic_aliases, usage.text, the embedding block, the lab block and the non-extensible list'],
  ['bin/lib/embed.mjs', 'SECURITY.md', 'the embedding request shape, the bearer key and the index file', 'RESEARCH_VAULT_EMBED_KEY'],
  ['bin/lib/embed.mjs', 'docs/REFERENCE.md', 'the index file path', 'embeddings.jsonl'],
  ['bin/commands/embed.mjs', 'SECURITY.md', 'the two gates and the batch size', 'RESEARCH_VAULT_ALLOW_NETWORK'],
  ['bin/commands/search.mjs', 'docs/REFERENCE.md', '--semantic, the stale weight and the refusals', 'semantic'],
  ['bin/lib/usagelog.mjs', 'docs/REFERENCE.md', 'the usage log path and the event kinds and fields', 'usage.jsonl'],
  ['bin/lib/usagelog.mjs', 'SECURITY.md', 'the usage log path and the usage.text flag', 'usage.jsonl'],
  ['bin/lib/usagelog.mjs', 'vault-template/.gitignore', 'the log lives under _index/, which the template ignores', '_index'],
  ['bin/lib/projectconfig.mjs', 'commands/research-init.md', "the config keys and 'volatility defaults to fast'"],
  ['bin/commands/obsidian.mjs', 'commands/research-obsidian.md', "the '_obsidian' default", '_obsidian'],
  ['bin/lib/files.mjs', 'vault-template/.gitignore', 'SKIP_DIRS and the ignore list both name _index and _obsidian', '_obsidian'],
  ['bin/lib/files.mjs', '.gitignore', 'SKIP_DIRS and the ignore list both name _index and _obsidian', '_obsidian'],
  ['bin/commands/check.mjs', 'bin/lib/gate.mjs', "checkCitations status values 'ok', 'stale', 'uncovered'"],
  ['bin/lib/gate.mjs', 'skills/research-claims-gate/SKILL.md', 'VERDICTS, LEDGER_FILENAME and the fact:N/quiz:N unit names', '.research-vault-ledger.jsonl'],
  ['bin/lib/gate.mjs', 'agents/claims-reviewer.md', 'the renderEvidence line format, unit names and verdict tokens; recordVerdict hashes this file into the reviewer field'],
  ['bin/lib/gate.mjs', 'skills/research-claims-gate/SKILL.md', "the 'image: <workspace-relative path> sha256:<hash>' evidence line and the img:<src> unit name are copied", 'image: '],
  ['bin/lib/gate.mjs', 'docs/REFERENCE.md', "the 'image: <workspace-relative path> sha256:<hash>' evidence line and the img:<src> unit name are copied", 'image: '],
  ['bin/lib/gate.mjs', 'agents/claims-reviewer.md', "the 'image: <path> sha256:<hash>' evidence line the reviewer may open", 'image: '],
  ['bin/lib/gate.mjs', 'hooks/stop-gate.mjs', 'the PASS|MERIT text the hook prints', 'MERIT'],
  ['bin/lib/gate.mjs', 'docs/REFERENCE.md', 'the ledger filename and the verdicts', '.research-vault-ledger.jsonl'],
  ['bin/lib/gate.mjs', 'bin/lib/lesson.mjs', "unitHashes depends on the data-block names 'fact' and 'quiz'"],
  ['bin/lib/gate.mjs', 'skills/research-claims-gate/SKILL.md', "changedCites's rules are restated: the changed units' citations, a changed row's section, the whole file's when none"],
  ['bin/lib/gate.mjs', 'docs/REFERENCE.md', "changedCites's rules are restated: the changed units' citations, a changed row's section, the whole file's when none"],
  ['bin/commands/gate.mjs', 'agents/claims-reviewer.md', "the 'changed units:' line the gate prints is the line the agent keys on", 'changed units:'],
  ['bin/lib/codelinks.mjs', 'agents/claims-reviewer.md', "the sym: unit name and the 'unit sym:<name> <file>:<start>-<end> <status>' line format", 'sym:'],
  ['bin/lib/codelinks.mjs', 'skills/research-authoring/SKILL.md', 'the <id>@<key>=<version> link form and the stale reason tag', '<id>@<key>=<version>'],
  ['bin/lib/codelinks.mjs', 'docs/REFERENCE.md', 'the Lua row of LANGS is quoted as the language example'],
  ['bin/lib/manifest.mjs', 'docs/REFERENCE.md', 'the manifest keys and entry fields listed under "Reading the graph from outside"'],
  ['bin/commands/check.mjs', 'docs/REFERENCE.md', 'the check --json keys and row fields listed under "Reading the graph from outside"', '--json'],
  ['bin/commands/gate.mjs', 'skills/research-claims-gate/SKILL.md', "the 'changed units:' last line is quoted", 'changed units:'],
  ['hooks/stop-gate.mjs', 'skills/research-claims-gate/SKILL.md', "the hook names the skill and the 'gate record <file> PASS|MERIT' form", 'gate record'],
  ['hooks/hooks.json', 'docs/REFERENCE.md', "'four Claude Code hooks' and their names", 'pre-web'],
  ['.claude-plugin/plugin.json', '.claude-plugin/marketplace.json', 'the plugin name'],
  ['.claude-plugin/plugin.json', 'package.json', 'the version (test/manifests.test.mjs)'],
  ['.claude-plugin/plugin.json', 'skills/research-claims-gate/SKILL.md', 'the research-vault: dispatch prefix is the plugin name'],
  ['.claude-plugin/plugin.json', 'skills/research-teach/SKILL.md', 'the research-vault: dispatch prefix is the plugin name'],
  ['skills/research-teach/assets/quiz.js', 'bin/lib/teach.mjs', 'the navigation bar: navHtml builds the same nav.lesson-nav and its three links for pages that do not load quiz.js, and renderNav builds it on a lesson page; given the index and a lesson id, navHtml also builds the previous, line N of M and next entries renderNav builds (classes, arrows, pathPosition), for an exported lesson', 'lesson-nav'],
  ['skills/research-teach/assets/quiz.js', 'bin/lib/teach.mjs', 'the /lessons.json and POST /attempt routes, the {id,score,total} shape and the lines, line fields read by pathPosition; the results file resultsFile writes and importAttempts reads: format research-vault-attempts, version 1, workspace, and the attempt keys lesson, answers, at, total, wrong; exportPage writes data-export (workspaceKey, which quiz.js reads as the storage key and resultsFile workspace) and data-lesson on <body>, and ships quiz.js with each line-initial export removed, so quiz.js must hold no import and no other export form; with the brand dividers key, each divider entry in the lessons of /lessons.json carries the id that neighbours reads and the title and path that renderNav and navHtml read', '/lessons.json'],
  ['skills/research-teach/assets/quiz.js', 'bin/lib/teach.mjs', 'the results file format name', 'research-vault-attempts'],
  ['skills/research-teach/assets/quiz.js', 'bin/lib/lesson.mjs', 'one attempt order: mergeQuizzes and lessonItems both put the predict item first (item 0), then the quiz items', 'lessonItems'],
  ['skills/research-teach/assets/quiz.js', 'skills/research-teach/LESSON-FORMAT.md', "the 'recorded <id>: <score>/<total>' and terminal strings, the Correct and Not this one marks, the role and aria-disabled attributes and the predict item 0 merge are quoted", 'Not this one'],
  ['bin/lib/cast.mjs', 'skills/research-teach/LESSON-FORMAT.md', "the Replays section restates PLAYER_FILES's two sha256 values and the version, and TOKEN_SHAPES' kinds", '752c9b528b664f5b16f27c68ba22fc7973d1d6063a1c3e4795a4c8015943acf6'],
  ['bin/lib/lesson.mjs', 'skills/research-teach/LESSON-FORMAT.md', 'block names (with complete, predict, connect and scaffold), MAX_INTRODUCES, QUIZ_MIN_ITEMS, QUIZ_SPREAD_MAX, FOLLOWUP and CONNECT_LEAD as prose, and WARN_CONNECT_LEAD named'],
  ['bin/lib/teach.mjs', 'skills/research-teach/LESSON-FORMAT.md', "EXPORT_TEXT's two replacements for FOLLOWUP and CONNECT_LEAD and MENTION_RE's three phrases are quoted in the connect rules", 'You can ask your instructor follow-up questions.'],
  ['bin/lib/lesson.mjs', 'skills/research-teach/assets/lesson.css', 'the [data-block=...] selectors name the same blocks, complete, predict, connect and scaffold among them, each in the two-column span list', 'data-block'],
  ['skills/research-teach/LESSON-FORMAT.md', 'bin/lib/lesson.mjs', 'the shape table: the Shapes section is SHAPES (shape names, required middle blocks in order, the frame; the scaffold of a project is optional and not in SHAPES) and states the LESSON_SHAPE_UNKNOWN, LESSON_SHAPE_BLOCK_MISSING, LESSON_SHAPE_MISMATCH, LESSON_COMPLETE_NOT_WORKED, LESSON_PREDICT_INVALID and LESSON_PLAN_NO_ELEMENTS rules', 'SHAPES'],
  ['bin/lib/lesson.mjs', 'skills/research-teach/LESSON-FORMAT.md', "the Checked task section's three scripts, step line and experiment citation are what LESSON_TASK_INCOMPLETE checks", 'check.sh'],
  ['bin/lib/lesson.mjs', 'skills/research-teach/LESSON-FORMAT.md', "the read-only allowlist, deny list and redirection rule of the Checked task section's safety rule 2 are TASK_READ_ONLY, TASK_DENY and the redirect test WARN_TASK_CHECK_MUTATES checks", 'api-resources'],
  ['bin/lib/lesson.mjs', 'test/fixtures/teach/lessons/0004-tool-fxctl.html', 'the shape table: the tool fixture (data-shape, data-teaches, complete) lints clean against SHAPES; its plan has an Elements part', 'data-shape'],
  ['test/fixtures/teach/assets/fxctl.cast', 'test/fixtures/teach/lessons/0004-tool-fxctl.html', 'the example block replays the cast, and the <pre> after its data-cast element is teach cast transcript of the cast: record the cast again and paste its transcript again', '$ fxctl run 7'],
  ['bin/lib/lesson.mjs', 'test/fixtures/teach/lessons/0005-diagnose-fx.html', 'the shape table: the diagnose fixture (predict with one item) lints clean against SHAPES; its plan has an Elements part', 'data-shape'],
  ['bin/lib/lesson.mjs', 'test/fixtures/teach/lessons/0006-project-fx.html', 'the shape table: the project fixture (an optional scaffold, then step) lints clean against SHAPES; its plan has an Elements part', 'data-shape'],
  ['skills/research-teach/LESSON-FORMAT.md', 'skills/research-teach/assets/lesson.css', "the block label list: the Blocks table's Label column is each block's ::before content"],
  ['skills/research-teach/LESSON-FORMAT.md', 'skills/research-teach/assets/lesson.css', 'fact and example span from 1100px, so the format may say below and above between them', '1100px'],
  ['skills/research-teach/assets/reading.html', 'skills/research-teach/LESSON-FORMAT.md', 'the reading page explains every label of the Blocks table, one data-block section per label', 'say it back'],
  ['bin/lib/teach.mjs', 'skills/research-teach/assets/reading.html', 'indexHtml links the reading page at /assets/reading.html by its title; teach export ships this page, so it must name no place to answer or ask that MENTION_RE matches', 'How to read a lesson'],
  ['skills/research-teach/assets/quiz.js', 'skills/research-teach/assets/reading.html', 'the navigation bar links the reading page at /assets/reading.html as How to read', 'How to read'],
  ['skills/research-teach/LESSON-FORMAT.md', 'bin/lib/lesson.mjs', 'the figure constants: a 440-unit viewBox, 14-unit labels and 40-character labels are FIGURE_VIEWBOX_MAX, FIGURE_LABEL_MIN and FIGURE_LABEL_MAX', /\b440\b/],
  ['bin/lib/lesson.mjs', 'skills/research-teach/assets/lesson.css', 'the figure constants: FIGURE_VIEWBOX_MAX 440 units draws at scale 1 at the figure svg min-width 27.5rem (440px)', /\b440\b/],
  ['bin/lib/lesson.mjs', 'skills/research-teach/LESSON-FORMAT.md', 'TIME_WORDS is written out in the Prose section', 'nowadays'],
  ['bin/lib/lesson.mjs', 'skills/research-teach/MISSION-FORMAT.md', 'the Floor, Known tools, Known terms and New to me headings are parsed', 'New to me'],
  ['bin/lib/lesson.mjs', 'skills/research-teach/README-FORMAT.md', 'README_SECTIONS are the five ## headings of the template, in order, and the lint reads them case-insensitively', 'Before you start'],
  ['bin/lib/lesson.mjs', 'skills/research-teach/README-FORMAT.md', 'What lint checks names README_TERM_NOT_INTRODUCED, WARN_README_EVIDENCE_LINK and WARN_README_SECTION_MISSING and what each reads', 'WARN_README_EVIDENCE_LINK'],
  ['bin/lib/lesson.mjs', 'docs/REFERENCE.md', 'the teach section names the README lint codes and WARN_CONNECT_LEAD with CONNECT_LEAD', 'README_TERM_NOT_INTRODUCED'],
  ['bin/lib/teach.mjs', 'skills/research-teach/README-FORMAT.md', "readmeDraft's output is stated: the two tables' columns, (no Project: line), (review), the lessons/files/<directory>/ cell and the no-lab line; EXPORT_TEXT.howToTake, the How to take it body in an exported index.html, is quoted", '(no Project: line)'],
  ['agents/lesson-reader.md', 'skills/research-teach/SKILL.md', 'section 5 dispatches the reader with the README path for its README mode', 'README mode'],
  ['agents/lesson-reader.md', 'skills/research-teach/README-FORMAT.md', 'the Gated like a lesson rule names the reader in README mode', 'README mode'],
  ['bin/lib/teach.mjs', 'docs/REFERENCE.md', "the teach section restates readmeDraft's output: (no Project: line), (review), the lab rows and the no-lab line, and states what markdownHtml renders on / and its escaping and link rule, and importAttempts's results file keys, checks and file:, attempt <n>:, skipped, changed and recorded lines, and exportWorkspace's file set, exportPage's rewrites, EXPORT_TEXT, MENTION_RE (what pageText and markdownText leave for it) and the not gated, ungated, skipped, mention, unknown-source, case-collision and source lines", '(no Project: line)'],
  ['bin/lib/lesson.mjs', 'skills/research-teach/PATH-FORMAT.md', 'the PATH.md line grammar is parsed; PATH_AFTER_FORWARD, PATH_AFTER_CYCLE, PATH_PROJECT_AFTER and WARN_PATH_TERM_UNPLANNED are named; the after: proposal rule of teach path edges, which skips Project: lines, and the inner fringe that counts a Project: line as a review are stated', 'PATH_PROJECT_AFTER'],
  ['bin/commands/teach.mjs', 'skills/research-teach/PATH-FORMAT.md', 'the PATH.md line grammar is parsed by next, which prints the fringe: and inner: lines (a built Project: line keeps the lines it names inner)'],
  ['bin/commands/teach.mjs', 'skills/research-teach/SKILL.md', "the teach verbs, the serving line, .teach-serve.json, the line N of M nav and the index grouped by Project: line with each shape, the fringe: and inner: lines, teach attempt add with --answers and --result pass|fail, teach attempt import, teach path candidates with its no line and term groups, teach path edges, and teach export with its mention and source lines and --skip-ungated are quoted; next's readme: missing | ungated | ok line after fringe: complete is named in section 4, quoted in section 6", '.teach-serve.json'],
  ['bin/lib/lesson.mjs', 'bin/commands/related.mjs', 'path candidates prints `related <id> --depth 2` as the query behind a linked candidate'],
  ['bin/lib/lesson.mjs', 'docs/REFERENCE.md', 'the prose line shape: paragraphs, sentences, avg words, longest', 'longest'],
  ['bin/commands/teach.mjs', 'skills/research-teach/SKILL.md', 'the --prose flag of teach lint', 'prose'],
  ['skills/research-teach/SKILL.md', 'skills/research-teach/MISSION-FORMAT.md', 'the term check, the tool question and the environment question of the interview are restated in both; the option order (the lab tooling of the repo first when it has one, then `Docker or kind on this machine`) is in SKILL.md only', 'Task environment'],
  ['bin/commands/teach.mjs', 'SECURITY.md', ".teach-serve.json and its { port, pid }, the listen(0, '127.0.0.1') binding and the serving line", '127.0.0.1'],
  ['bin/lib/teach.mjs', 'skills/research-teach/SKILL.md', "SPACING_DAYS as '21 days' and the lesson URL's /lessons/<id>.html path", '/lessons/'],
  ['bin/lib/teach.mjs', 'SECURITY.md', 'ATTEMPT_BODY_MAX, the allowlisted dirs, the exact Host 127.0.0.1:<port> check, and what GET / and /lessons.json read and return; what importAttempts checks and writes, RESULTS_MAX as 1 MiB; what exportWorkspace copies and leaves out, serveFile not following a symlinked GLOSSARY.md, what sources.html carries and escapes, the wx flag, containment check and cleanup of writeExport, and what an exported page loads', 'ATTEMPT_BODY_MAX'],
  ['bin/commands/refresh.mjs', 'SECURITY.md', 'RESEARCH_VAULT_ALLOW_NETWORK and --dry-run', 'RESEARCH_VAULT_ALLOW_NETWORK'],
  ['bin/commands/refresh.mjs', 'skills/research-verify/SKILL.md', 'the --json result keys, storedBody among them', 'storedBody'],
  ['bin/commands/refresh.mjs', 'docs/REFERENCE.md', 'the --json result keys, storedBody among them', 'storedBody'],
  ['bin/commands/export.mjs', 'SECURITY.md', 'the export flag semantics'],
  ['bin/lib/exportjsonl.mjs', 'docs/FINETUNING.md', 'the record shape, the meta fields and the chunk window rule', 'last_verified'],
  ['bin/commands/export.mjs', 'docs/REFERENCE.md', 'the chunk, overlap, fresh-only and min-authority flags', 'min-authority'],
  ['bin/commands/export.mjs', 'docs/FINETUNING.md', 'the chunk, overlap, fresh-only and min-authority flags', 'min-authority'],
  ['skills/research-teach/LESSON-FORMAT.md', 'test/fixtures/teach/lessons/0001-good.html', 'the single ```html example is byte-identical to the fixture'],
  ['bin/lib/lintrules.mjs', 'scripts/check-encoding.mjs', 'the mojibake regex and the BOM/CR checks are duplicated', '\\u00C3\\u00A2\\u00E2\\u201A\\u00AC'],
  ['bin/lib/lintrules.mjs', 'docs/REFERENCE.md', 'lint codes are documented by name'],
  ['bin/lib/lintrules.mjs', 'docs/ORCHESTRATOR-INTEGRATION.md', 'WARN_SYNTHESIS_* codes and the 1500-word limit', 'WARN_SYNTHESIS_'],
  ['bin/lib/lintrules.mjs', 'bin/lib/agentsmd.mjs', 'WARN_MISSING_SUMMARY and WARN_SOURCE_UNVERIFIED are named in the generated AGENTS.md', 'WARN_SOURCE_UNVERIFIED'],
  ['bin/lib/lintrules.mjs', 'skills/research-authoring/SKILL.md', 'lint codes are named in prose', 'WARN_SOURCE_UNVERIFIED'],
  ['bin/lib/lintrules.mjs', 'skills/research-capture/SKILL.md', 'lint codes are named in prose', 'WARN_MISSING_SUMMARY'],
  ['bin/lib/lintrules.mjs', 'skills/research-review/SKILL.md', 'lint codes are named in prose', 'WARN_SOURCE_UNVERIFIED'],
  ['bin/lib/lintrules.mjs', 'skills/research-orchestrate/SKILL.md', 'lint codes are named in prose', 'WARN_SYNTHESIS_MONOLITHIC'],
  ['bin/lib/advise.mjs', 'skills/research-librarian/SKILL.md', "'thirteen sections', their list and OPEN_QUESTION_DAYS as 60 days", /\b60\b/],
  ['bin/lib/advise.mjs', 'docs/REFERENCE.md', 'OPEN_QUESTION_DAYS is written as 60 days in the advise row', /\b60\b/],
  ['bin/lib/advise.mjs', 'bin/commands/search.mjs', 'the queried event fields kind, ids, topic and outcome that the usage report counts', 'no-match'],
  ['skills/research-teach/LESSON-FORMAT.md', 'skills/research-teach/SKILL.md', "the mission block's sentence list (the win, the idea, the activity) is restated in step 5; the checked task's setup.sh, check.sh and solution.sh and the run.sh sequence (setup, check, solution, check, setup, check, exit 0 on 1, 0, 1) are stated in section 3 and the step form in Checked task", 'the idea'],
  ['skills/research-teach/LESSON-FORMAT.md', 'skills/research-teach/MISSION-FORMAT.md', "the Checked task paragraph scopes setup.sh and solution.sh to the environment MISSION.md's Task environment: bullet names", 'Task environment'],
  ['bin/lib/advise.mjs', 'hooks/pre-web.mjs', "the queried event's kind and ids that the usage report counts", "'queried'"],
  ['bin/lib/advise.mjs', 'hooks/post-tool-use.mjs', "the cited event's kind and id that the usage report counts", "'cited'"],
  ['bin/commands/capture.mjs', 'skills/research-orchestrate/SKILL.md', 'the --batch camelCase keys', 'contributingIds'],
  ['bin/commands/capture.mjs', 'skills/research-capture/SKILL.md', 'the --batch camelCase keys', 'contributingIds'],
  ['bin/commands/capture.mjs', 'SECURITY.md', 'the network gate of the URL-list ingest', 'RESEARCH_VAULT_ALLOW_NETWORK'],
  ['bin/commands/capture.mjs', 'docs/REFERENCE.md', 'the three --batch inputs and --continue', 'continue'],
  ['bin/commands/capture.mjs', 'skills/research-capture/SKILL.md', 'the three --batch inputs and --continue', 'continue'],
  ['bin/lib/blocklist.mjs', 'docs/REFERENCE.md', 'the blocklist path, its row shape and the two scopes', 'source-blocklist.json'],
  ['bin/lib/blocklist.mjs', 'skills/research-capture/SKILL.md', 'the blocklist path and its row shape', 'source-blocklist.json'],
  ['hooks/pre-web.mjs', 'docs/REFERENCE.md', 'the blocklist warning before a fetch', 'blocklist'],
  ['bin/lib/agentsmd.mjs', 'docs/ORCHESTRATOR-INTEGRATION.md', 'AGENTS.md §2.6 is cited by number', '§2.6'],
  ['bin/lib/agentsmd.mjs', 'docs/REFERENCE.md', 'AGENTS.md §5 and §5.2 are cited by number'],
  ['bin/lib/agentsmd.mjs', 'skills/research-vault-usage/SKILL.md', 'AGENTS.md §2.7 and §5.2 are cited by number'],
  ['bin/lib/agentsmd.mjs', 'skills/research-capture/SKILL.md', 'AGENTS.md §2.5 and §2.6 are cited by number', '§2.5'],
  ['bin/lib/agentsmd.mjs', 'skills/research-orchestrate/SKILL.md', 'AGENTS.md §2.6 is cited by number', '§2.6'],
  ['bin/lib/agentsmd.mjs', 'skills/research-review/SKILL.md', 'AGENTS.md §2.6 is cited by number', '§2.6'],
  ['bin/lib/agentsmd.mjs', 'vault-template/meta/freshness-policy.md', 'freshness-policy §8 is cited by number', '§8'],
  ['vault-template/meta/freshness-policy.md', 'vault-template/meta/prompt-templates/probe-tool.md', 'freshness-policy §8 is cited by number', '§8'],
  ['.github/workflows/ci.yml', 'docs/REFERENCE.md', 'the CI matrix and steps are restated'],
  ['.gitattributes', 'scripts/check-encoding.mjs', 'eol=lf keeps the CR gate green on Windows'],
  ['bin/commands/teach.mjs', 'docs/REFERENCE.md', "the teach section states next's readme: line, its three values and when each is printed, and teach attempt import's exit 2 lines, cannot read and over 1 MiB, and teach export's exit 2 lines (no vault, inside the vault or a workspace directory, not an empty directory), its stderr refusal line, its cannot write line and its wrote line", 'readme: ungated'],
  ['bin/commands/teach.mjs', 'skills/research-teach/README-FORMAT.md', "the Gated like a lesson rule states next's readme: line and its three values", 'readme: ungated'],
  ['bin/lib/labs.mjs', 'skills/research-teach/LESSON-FORMAT.md', "the Labs section states readLabs's manifest keys, limits (cost 200, timeout 7200, checks 10), LAB_TEXT_BAD_RE as words, the three roots, the id, env and path patterns, and labPin's key order", '^[A-Za-z0-9._/-]+$'],
  ['bin/lib/lesson.mjs', 'skills/research-teach/LESSON-FORMAT.md', 'the Labs section names the eight LAB_* codes and quotes their messages', 'read the change, then copy sha256'],
  ['bin/lib/teach.mjs', 'skills/research-teach/LESSON-FORMAT.md', "the Labs section quotes labStepsHtml's elements and LAB_OPEN_LINE", 'To run this lab from the page, open the lab address teach serve printed when it started.'],
  ['bin/lib/teach.mjs', 'skills/research-teach/README-FORMAT.md', "readmeDraft's manifest row (labs/labs.json: <id>, <cost>; env: <names or none>, an escaped |) is stated", 'labs/labs.json: '],
  ['bin/lib/labs.mjs', 'SECURITY.md', 'the Lab runs section states LAB_BODY_MAX, the cookie name, LAB_ID_RE, the scripts each action hashes and every labRefusal body', 'rv-labs-'],
  ['bin/lib/labs.mjs', 'docs/REFERENCE.md', "the teach section quotes labRefusal's busy and not running bodies, the runner's final lines, the redaction marker and the limits (5 s, 10 s, 1 MiB)", 'lab: verify pass'],
  ['bin/lib/labs.mjs', 'SECURITY.md', 'the Lab runs section states STOP_GRACE, KILL_WAIT, CHECK_TIMEOUT, LAB_OUTPUT_MAX, the 65536-character line rule, LAB_ENV_ALLOW by name, the spawn options, the 503 while stopping and every final line', 'LAB_ENV_ALLOW'],
  ['bin/lib/labs.mjs', 'SECURITY.md', "the What runs bullet states launch()'s refusal of a script whose first two bytes are not #!", 'could not start: ENOEXEC'],
  ['bin/lib/lesson.mjs', 'bin/lib/labs.mjs', "launch() repeats LAB_SCRIPT_NOT_RUNNABLE's test of the first two bytes for #!", 'LAB_SCRIPT_NOT_RUNNABLE'],
  ['skills/research-teach/assets/quiz.js', 'bin/lib/teach.mjs', "renderLab acts on data-lab-live and data-lab-verify, which withLabSteps adds under --labs on a request with the cookie, and posts {\"lab\": \"<id>\"} to the /lab/<action> routes", 'data-lab-live'],
  ['skills/research-teach/assets/quiz.js', 'bin/lib/labs.mjs', "labStatus takes the status from a final line starting 'lab: ', which only the runner writes: lineRedactor puts '> ' before a script piece starting lab:", "startsWith('lab:"],
  ['skills/research-teach/assets/quiz.js', 'skills/research-teach/LESSON-FORMAT.md', "the Labs section names renderLab's buttons, its output pre and its status line", 'Check my work'],
  ['bin/commands/teach.mjs', 'SECURITY.md', "serve's start warning line and its SIGINT, SIGTERM and SIGHUP handlers under --labs are stated", 'holds the value of'],
  ['bin/lib/teach.mjs', 'SECURITY.md', "exportWorkspace's secret and lab-manifest refusals are quoted", 'lab-manifest labs/labs.json: invalid; run teach lint'],
  ['bin/lib/teach.mjs', 'docs/REFERENCE.md', "exportWorkspace's secret and lab-manifest refusals are quoted", 'lab-manifest labs/labs.json: invalid; run teach lint'],
  ['bin/lib/teach.mjs', 'SECURITY.md', "createServer's lab address flow (303, the Set-Cookie attributes, next, reusable for the life of the server), the two framing headers under --labs and the lab POST checks 1 to 5 are stated", 'HttpOnly; SameSite=Strict; Path=/'],
  ['bin/commands/teach.mjs', 'SECURITY.md', 'the labs: open line and the exit 2 on an invalid labs.json are quoted', '/labs/open?t='],
  ['bin/lib/brand.mjs', 'skills/research-teach/assets/lesson.css', "BRAND_TOKENS is read from lesson.css's first :root block, and brandCss copies its two dark selectors", ':root:not([data-theme="light"])'],
  ['bin/lib/brand.mjs', 'skills/research-teach/BRAND-FORMAT.md', "the format states readBrand's keys (dividers among them), its path, colour, family and audience rules and the eight-alias limit, and withBrand's link, style, header and footer", 'brand-footer'],
  ['bin/commands/teach.mjs', 'docs/REFERENCE.md', "serve's start line for an invalid brand.json is quoted", 'brand: brand/brand.json is invalid; run teach lint'],
  ['bin/lib/teach.mjs', 'docs/REFERENCE.md', "exportWorkspace's brand refusal is quoted", 'brand brand/brand.json: invalid; run teach lint'],
  ['bin/lib/lesson.mjs', 'skills/research-teach/BRAND-FORMAT.md', "the Lint section names lintWorkspace's BRAND_ codes (dividers.image under BRAND_FILE_MISSING, dividers under BRAND_ALT_MISSING), the contrast pairs and threshold, the style-colour forms and BRAND_VOICE's prose", 'BRAND_OFF_PALETTE'],
  ['bin/lib/teach.mjs', 'skills/research-teach/BRAND-FORMAT.md', "the Dividers section states the divider address createServer serves and exportWorkspace writes, the reading order withDividers builds and the page dividerHtml writes", '/dividers/'],
  ['bin/lib/teach.mjs', 'docs/REFERENCE.md', 'the teach section states the divider address createServer serves and exportWorkspace writes', '/dividers/'],
];

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ext = f => posix.extname(f);
const read = f => readFileSync(join(REPO_ROOT, f), 'utf8');
const lsFiles = (...flags) => execFileSync('git', ['ls-files', '-z', '--exclude-standard', ...flags], { cwd: REPO_ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);
const fmName = text => text.match(/^---\n[\s\S]*?^name:\s*(\S+)/m)?.[1];
const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(?\s*)['"](\.{1,2}\/[^'"]+)['"]/g;
const imports = (file, text) => [...text.matchAll(IMPORT_RE)].map(m => posix.normalize(posix.join(posix.dirname(file), m[1])));

// The flags a command accepts: every args.<flag> and args['<flag>'] read in its module and in the
// bin/lib modules it imports directly.
// ponytail: a flag read by a shared lib module is accepted for every command importing it, and a
// boolean flag missing from BOOL in bin/lib/args.mjs is not detected.
function flagsOf(file) {
  if (!existsSync(join(REPO_ROOT, file))) return new Set();
  const text = read(file);
  const libs = imports(file, text).filter(t => t.startsWith('bin/lib/') && existsSync(join(REPO_ROOT, t)));
  return new Set([text, ...libs.map(read)].flatMap(t => [...t.matchAll(/\bargs(?:\.([\w$]+)|\['([^']+)'\])/g)].map(m => m[1] ?? m[2]).filter(f => f !== 'mjs')));
}

// The universe: tracked and untracked files that are not ignored and still exist (a tracked file
// that .gitignore lists, such as a force-added spec, is ignored too). Names resolve from files.
export function context() {
  const ignored = new Set(lsFiles('--cached', '--ignored'));
  const files = lsFiles('--cached', '--others').filter(f => !ignored.has(f) && existsSync(join(REPO_ROOT, f))).sort();
  const commands = [...read('bin/research-vault.mjs').matchAll(/^\s+(\w+): \(\) => import\(/gm)].map(m => m[1]);
  const scripts = Object.keys(JSON.parse(read('package.json')).scripts ?? {});
  const names = {};
  for (const f of files) {
    if (/^agents\/[^/]+\.md$/.test(f)) names[fmName(read(f))] = { kind: 'invokes-agent', file: f };
    else if (/^skills\/[^/]+\/SKILL\.md$/.test(f)) names[fmName(read(f))] = { kind: 'invokes-skill', file: f };
    else if (/^commands\/[^/]+\.md$/.test(f)) names[posix.basename(f, '.md')] = { kind: 'invokes-command', file: f };
  }
  const topDirs = [...new Set(files.filter(f => f.includes('/')).map(f => f.split('/')[0]))];
  const rootFiles = files.filter(f => !f.includes('/'));
  const flags = Object.fromEntries(commands.map(c => [c, flagsOf(`bin/commands/${c}.mjs`)]));
  return { files, commands, scripts, names, topDirs, rootFiles, flags };
}

// A quoted top-level directory as a call argument followed by further quoted segments (the join(root,
// 'schema', 'x.json') form), or a single-quoted path literal. A directory expands to every file under it.
function reads(text, ctx) {
  // ponytail: docs/ is also the layout test/gate.test.mjs gives its temp repos, so literals under it
  // are skipped; a test that reads docs/ would go unseen.
  const dirs = ctx.topDirs.filter(d => d !== 'docs').map(esc).join('|');
  const out = [...text.matchAll(new RegExp(`(?<=[(,]\\s*)'(${dirs})'((?:,\\s*'[^']+')*)`, 'g'))]
    .map(m => posix.join(m[1], ...[...m[2].matchAll(/'([^']+)'/g)].map(x => x[1])));
  out.push(...[...text.matchAll(new RegExp(`'((?:${dirs})/[^'\\n*]*\\.(?:mjs|js|md|json|yml))'`, 'g'))].map(m => m[1]));
  return out.flatMap(p => { const under = ctx.files.filter(f => f.startsWith(p + '/')); return under.length ? under : [p]; });
}

function documents(file, text, ctx) {
  const t = text.replaceAll('${CLAUDE_PLUGIN_ROOT}/', ' ');
  const dirs = ctx.topDirs.map(esc).join('|');
  const out = [...t.matchAll(new RegExp(`(?<![\\w./-])(?:${dirs})/[\\w./-]*\\.(?:${DOC_EXT})(?![\\w-])`, 'g'))].map(m => m[0]);
  out.push(...[...t.matchAll(new RegExp(`(?<![\\w./-])(?:${ctx.rootFiles.map(esc).join('|')})(?![\\w-])`, 'g'))].map(m => m[0]));
  out.push(...[...t.matchAll(/(?<![\w./-])meta\/[\w./-]*\.(?:md|json|yml)(?![\w-])/g)].map(m => 'vault-template/' + m[0]));
  out.push(...[...t.matchAll(/\]\(([^)\s#]+)/g)].map(m => m[1]).filter(l => !/^[a-z]+:/.test(l))
    .map(l => posix.normalize(posix.join(posix.dirname(file), l))));
  return out;
}

// Code regions: inline spans and fenced lines in markdown, lines (minus the key) in YAML, string
// values in JSON. Running prose is never an invocation.
function codeRegions(file, text) {
  const e = ext(file);
  // A JSON string is code when it is a command line; titles and descriptions are prose.
  if (e === '.json') return [...text.matchAll(/"((?:\$|node)\s(?:[^"\\]|\\.)*)"/g)].map(m => m[1]);
  if (e === '.yml') return text.split('\n').map(l => l.replace(/^\s*(?:-\s*)?[\w-]+:\s*/, ''));
  const out = [];
  const prose = text.replace(/^[ \t]*```[^\n]*\n([\s\S]*?)^[ \t]*```/gm, (_, body) => { out.push(...body.split('\n')); return ''; });
  out.push(...[...prose.matchAll(/`([^`\n]+)`/g)].map(m => m[1]));
  return out;
}

// An invocation starts its region: `research-vault <cmd>`, `research-vault.mjs <cmd>`,
// `research-vault.mjs" <cmd>` after an optional `$`, `node` and path, or a bare command word.
const CLI_RE = /^(?:\$\s+)?(?:node\s+)?(?:"?[^\s"]*\/)?research-vault(?:\.mjs"?)?\s+(\S+)(.*)$/;
function invocation(region, ctx) {
  const m = region.trim().match(CLI_RE);
  if (m) return /^[<[-]/.test(m[1]) ? null : [m[1], m[2]]; // <command>, [options] and --help are not command words
  const [first, ...rest] = region.trim().split(/\s+/);
  return ctx.commands.includes(first) ? [first, rest.join(' ')] : null;
}

// Every edge one file contributes. Exported so test/deps.test.mjs can feed it one syntax at a time.
export function extract(file, text, ctx = context()) {
  const e = ext(file), edges = [];
  const add = (kind, to) => edges.push({ from: file, kind, to });
  if (UNSCANNED.has(file)) return edges;
  if (e === '.mjs' || e === '.js') {
    for (const to of imports(file, text)) add(file.startsWith('test/') ? 'tests' : 'import', to);
    if (e === '.mjs') for (const to of reads(text, ctx)) add('reads', to);
    return edges;
  }
  if (file === 'hooks/hooks.json') {
    for (const m of text.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^"\s]+)/g)) add('registers', m[1]);
    return edges;
  }
  if (!['.md', '.yml', '.json'].includes(e) && file !== 'bin/research-vault') return edges;
  for (const to of documents(file, text, ctx)) add('documents', to);
  if (e === '.md') {
    const names = [...text.matchAll(/research-vault:([a-z-]+)/g)].map(m => m[1]);
    names.push(...[...text.matchAll(/`\/?(research-[a-z-]+)`/g)].map(m => m[1]).filter(n => n !== 'research-vault'));
    for (const n of names) ctx.names[n] ? add(ctx.names[n].kind, ctx.names[n].file) : add('invokes-unknown', n);
  }
  if (e === '.md' || e === '.yml') for (const m of text.matchAll(/npm (?:run ([\w:-]+)|(test)\b)/g)) add('npm', `npm:${m[1] ?? m[2]}`);
  for (const region of codeRegions(file, text)) {
    const hit = invocation(region, ctx);
    if (!hit) continue;
    const [cmd, rest] = hit;
    add('invokes-cli', `cli:${cmd}`);
    if (ctx.flags[cmd]) for (const m of rest.matchAll(/--([a-z][\w-]*)/g)) if (!ctx.flags[cmd].has(m[1])) add('invokes-cli', `cli:${cmd} --${m[1]}`);
  }
  return edges;
}

export function build(ctx = context()) {
  const nodes = new Set([...ctx.files, ...ctx.commands.map(c => `cli:${c}`), ...ctx.scripts.map(s => `npm:${s}`)]);
  const seen = new Set(), edges = [];
  const add = e => { const k = `${e.from}\0${e.kind}\0${e.to}`; if (!seen.has(k)) { seen.add(k); edges.push(e); } };
  for (const f of ctx.files) if (EXTRACTED.has(ext(f))) for (const e of extract(f, read(f), ctx)) add(e);
  for (const c of ctx.commands) add({ from: `cli:${c}`, kind: 'dispatches', to: `bin/commands/${c}.mjs` });
  for (const [a, b, why] of COUPLINGS) { add({ from: a, kind: 'couples', to: b, why }); add({ from: b, kind: 'couples', to: a, why }); }
  const broken = edges.filter(e => !nodes.has(e.to));
  return { nodes, edges, broken };
}

// Distance-1 dependents of an id, one line each: `<kinds> <from>`, with the reason for a coupling.
export function dependents(id, { edges }) {
  const by = new Map();
  for (const e of edges.filter(e => e.to === id)) {
    const d = by.get(e.from) ?? { kinds: new Set(), why: undefined };
    d.kinds.add(e.kind); d.why ??= e.why; by.set(e.from, d);
  }
  return [...by].sort(([a], [b]) => a < b ? -1 : 1).map(([from, d]) => `${[...d.kinds].sort().join(',')} ${from}${d.why ? `: ${d.why}` : ''}`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const arg = process.argv[2];
  if (arg === '--hook') {
    let input = '';
    process.stdin.on('data', d => input += d);
    process.stdin.on('end', () => {
      try {
        const edited = JSON.parse(input || '{}').tool_input?.file_path || '';
        const rel = relative(REPO_ROOT, edited).replace(/\\/g, '/');
        const deps = edited && !rel.startsWith('..') ? dependents(rel, build()) : [];
        if (deps.length) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: `Files that depend on ${rel}: ${deps.join('; ')}` } }) + '\n');
      } catch { /* never block edits */ }
      process.exit(0);
    });
  } else if (arg) {
    for (const line of dependents(arg, build())) console.log(line);
  } else {
    const { broken } = build();
    for (const e of broken) console.log(`${e.kind} ${e.from} -> ${e.to}`);
    process.exit(broken.length ? 1 : 0);
  }
}
