import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpVault, fixtureVault, put, codeRepo } from './helpers.mjs';
import { reviewRequest, runCodexReview } from '../bin/lib/codex-review.mjs';

function setup(t) {
  const root = tmpVault('rv-review-');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const vault = fixtureVault(join(root, 'research'));
  const draft = join(root, 'draft.md');
  writeFileSync(join(root, '.research-vault.json'), JSON.stringify({ vault: 'research' }));
  writeFileSync(draft, '# Claim\n\nSee 2026-01-01-fx-experiment.\n');
  return { root, vault, draft, out: join(root, 'review.json') };
}
const response = text => ({ status: 0, stdout: JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text } }) + '\n' + JSON.stringify({ type: 'turn.completed' }), stderr: '' });

test('fresh Codex review declares exact evidence and preserves policy, without writing a ledger', t => {
  const options = setup(t);
  const request = reviewRequest(options);
  assert.match(request.prompt, /2026-01-01-fx-experiment \[experiment, active\]/);
  assert.match(request.prompt, /changed units: sec:claim/);
  const r = runCodexReview(options, { spawn: (command, args, opts) => {
    assert.equal(command, 'codex'); assert.ok(args.includes('--ephemeral'));
    assert.ok(args.includes('read-only')); assert.ok(args.includes('project_doc_max_bytes=0'));
    assert.ok(!args.includes('resume')); assert.ok(!args.includes('fork'));
    assert.notEqual(opts.cwd, options.root);
    assert.equal(opts.input, request.prompt);
    return response('Evidence table\nVERDICT: PASS');
  } });
  assert.equal(r.verdict, 'PASS'); assert.equal(r.actualModel, null);
  assert.equal(JSON.parse(readFileSync(options.out)).configuredModel, 'gpt-6.1-sol');
  assert.equal(existsSync(join(options.root, '.research-vault-ledger.jsonl')), false);
});

test('review rejects process failure, missing/conflicting verdicts and changed inputs', t => {
  const o = setup(t);
  for (const result of [{ status: 1, stderr: 'no auth' }, response('No verdict'), response('VERDICT: PASS\nVERDICT: FAIL-as-sent')]) {
    assert.throws(() => runCodexReview(o, { spawn: () => result }));
    assert.equal(existsSync(o.out), false);
  }
  assert.throws(() => runCodexReview(o, { spawn: () => { writeFileSync(o.draft, 'changed'); return response('VERDICT: PASS'); } }), /draft changed/);
  assert.equal(existsSync(o.out), false);
});

test('review refuses stale extra evidence and detects a new contradictory entry during execution', t => {
  const o = setup(t);
  assert.throws(() => reviewRequest({ ...o, extra: ['2026-01-01-old'] }), /stale/);
  assert.throws(() => runCodexReview(o, { spawn: () => {
    put(o.vault, 'note', '2026-11-13-contradiction', { sources: [], confidence: 'high' }, 'Not so.');
    return response('VERDICT: PASS');
  } }), /evidence changed/);
  assert.equal(existsSync(o.out), false);
});

test('lesson reader needs no vault and refuses to replace an existing report', t => {
  const root = tmpVault('rv-reader-'); t.after(() => rmSync(root, { recursive: true, force: true }));
  const draft = join(root, 'README.md'), out = join(root, 'reader.json');
  writeFileSync(draft, '# Read this\n');
  const result = runCodexReview({ draft, out, role: 'lesson-reader' }, { spawn: () => response('Findings\nVERDICT: REVISE') });
  assert.equal(result.verdict, 'REVISE');
  assert.throws(() => runCodexReview({ draft, out, role: 'lesson-reader' }), /already exists/);
});

test('relative --vault becomes absolute before the fresh session starts', t => {
  const o = setup(t);
  const request = reviewRequest({ ...o, vault: relative(process.cwd(), o.vault) });
  assert.equal(request.vaultPath, o.vault);
  assert.ok(request.prompt.includes(`Vault: ${o.vault}`));
});

test('code drafts use code links instead of treating runtime URL literals as prose citations', t => {
  const { root, vault } = codeRepo();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const draft = join(root, 'src/a.lua');
  writeFileSync(draft, readFileSync(draft, 'utf8').replace('return 1', 'return "https://example.org/runtime-url"'));
  const request = reviewRequest({ draft, vault });
  assert.match(request.prompt, /unit sym:f/);
  assert.ok(!request.prompt.includes('https://example.org/runtime-url'));
});

test('unattached code citations stop review just as they stop check --check', t => {
  const { root, vault } = codeRepo();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const draft = join(root, 'src/a.lua');
  writeFileSync(draft, readFileSync(draft, 'utf8') + '\n-- per 2026-01-01-fx-doc\n');
  assert.throws(() => reviewRequest({ draft, vault }), /code evidence is not clean/);
});
