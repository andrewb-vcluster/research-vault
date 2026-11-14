const BOOL = new Set(['json', 'check', 'fix', 'force', 'stale', 'rebuild', 'succession', 'tested', 'set-default', 'scaffold', 'stdout', 'store-body', 'ack-data-egress', 'dry-run', 'include-bodies', 'report', 'project', 'refresh-docs', 'include-superseded', 'changed', 'continue', 'fresh-only', 'prose', 'skip-ungated', 'labs', 'without-hooks']);
// A flag given more than once whose values all count: an array, in order.
const REPEAT = new Set(['needle']);
export const csvList = s => String(s ?? '').split(',').map(t => t.trim()).filter(Boolean);

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok.startsWith('--')) {
      const key = tok.slice(2);
      if (BOOL.has(key)) out[key] = true;
      else {
        const next = argv[i + 1];
        const v = next === undefined || next.startsWith('--') ? undefined : argv[++i];
        out[key] = REPEAT.has(key) ? [...(out[key] ?? []), v] : v;
      }
    } else out._.push(tok);
  }
  return out;
}
