#!/usr/bin/env node
import { parseArgs } from './lib/args.mjs';

const USAGE = `research-vault <command> [options]
commands: init|lint|capture|verify|search|related|manifest|compile|advise|obsidian|refresh|export|check|gate|teach|embed|host`;

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];
if (!cmd || cmd === '--help' || cmd === '-h') { process.stdout.write(USAGE + '\n'); process.exit(0); }

const commands = {
  host: () => import('./commands/host.mjs'),
  init: () => import('./commands/init.mjs'),
  lint: () => import('./commands/lint.mjs'),
  capture: () => import('./commands/capture.mjs'),
  verify: () => import('./commands/verify.mjs'),
  search: () => import('./commands/search.mjs'),
  related: () => import('./commands/related.mjs'),
  manifest: () => import('./commands/manifest.mjs'),
  compile: () => import('./commands/compile.mjs'),
  advise: () => import('./commands/advise.mjs'),
  obsidian: () => import('./commands/obsidian.mjs'),
  refresh: () => import('./commands/refresh.mjs'),
  export: () => import('./commands/export.mjs'),
  check: () => import('./commands/check.mjs'),
  gate: () => import('./commands/gate.mjs'),
  teach: () => import('./commands/teach.mjs'),
  embed: () => import('./commands/embed.mjs'),
};
if (!commands[cmd]) { process.stderr.write(`unknown command: ${cmd}\n${USAGE}\n`); process.exit(1); }
try {
  const mod = await commands[cmd]();
  const code = await mod.run(args);
  process.exitCode = code ?? 0; // not process.exit(): that truncates piped stdout at 64 KB
} catch (err) {
  process.stderr.write(`error: ${err.message}\n`);
  process.exitCode = 2;
}
