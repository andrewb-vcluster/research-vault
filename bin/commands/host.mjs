import { manageCodex, PACKAGE_ROOT } from '../lib/host-install.mjs';
import { resolveVault } from '../lib/resolve.mjs';
import { join } from 'node:path';
import { runCodexReview } from '../lib/codex-review.mjs';
import { csvList } from '../lib/args.mjs';

export async function run(args) {
  const [, action, host] = args._;
  if (action === 'review' && host === 'codex') {
    if (!args.draft || !args.out) throw new Error('host review codex requires --draft and a new --out report path');
    const report = runCodexReview({ draft: args.draft, out: args.out, vault: args.vault, extra: csvList(args.extra), ...(args.role ? { role: args.role } : {}), ...(args.model ? { model: args.model } : {}), ...(args.effort ? { effort: args.effort } : {}) });
    console.log(report.response);
    console.error(`Codex review report: ${args.out}; ledger unchanged`);
    return ['PASS', 'READS'].includes(report.verdict) ? 0 : 1;
  }
  if (action === 'paths') {
    console.log(JSON.stringify({ package: PACKAGE_ROOT, cli: join(PACKAGE_ROOT, 'bin/research-vault.mjs'), assets: join(PACKAGE_ROOT, 'skills/research-teach/assets'), vault: resolveVault({ flag: args.vault, cwd: args.cwd }).path }, null, 2));
    return 0;
  }
  if (host !== 'codex' || !['install', 'status', 'uninstall'].includes(action)) {
    console.error('usage: research-vault host paths | install|status|uninstall codex [--at directory] [--dry-run] [--without-hooks] [--model name] [--effort high] | review codex --draft file --out report [--role claims-reviewer|lesson-reader] [--extra ids]');
    return 2;
  }
  const result = manageCodex(args.at ?? args.cwd ?? process.cwd(), action, { dryRun: args['dry-run'], withoutHooks: args['without-hooks'], ...(args.model ? { model: args.model } : {}), ...(args.effort ? { effort: args.effort } : {}) });
  console.log(JSON.stringify(result, null, 2));
  if (action === 'install' && !args['dry-run']) console.error('Codex: restart/discover project skills and agents; review and trust hooks before use. Existing Claude configuration was not changed.');
  return result.changed?.length ? 1 : 0;
}
