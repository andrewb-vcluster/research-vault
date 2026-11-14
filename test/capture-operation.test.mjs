import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { captureOperation } from '../bin/lib/capture-operation.mjs';
import { walkEntries } from '../bin/lib/fsutil.mjs';
import { defaultVaultPath } from '../bin/lib/resolve.mjs';
const now = '2026-11-13';
function fixture(plan = [{ type: 'question', title: 'First' }, { type: 'question', title: 'Second' }]) {
  const root = fs.mkdtempSync(join(tmpdir(), 'rv-op $; ')), vault = join(root, 'vault B');
  fs.mkdirSync(vault); const path = join(root, 'plan.json'); fs.writeFileSync(path, JSON.stringify(plan));
  return { root, vault, path, run: opts => captureOperation(vault, path, 'stable_key', { now, ...opts }) };
}
const fail = code => { throw Object.assign(new Error(`injected ${code}`), { code }); };
const bytes = v => walkEntries(v).map(p => [p, fs.readFileSync(p, 'utf8')]);
test('opt-in replay is historical, immutable inputs still checked, frozen date and bytes', () => {
  const f = fixture(), first = f.run(); assert.equal(first.errors.length, 0); const original = bytes(f.vault);
  const replay = f.run({ now: '2026-11-14' }); assert.equal(replay.historical, true); assert.deepEqual(bytes(f.vault), original);
  fs.appendFileSync(first.created[0].path, '\nlegitimate edit');
  assert.equal(f.run().historical, true);
  fs.unlinkSync(first.created[1].path); assert.equal(f.run().historical, true);
  fs.writeFileSync(f.path, '[{"type":"question","title":"Changed"}]');
  assert.notEqual(f.run().errors.length, 0); assert.equal(walkEntries(f.vault).length, 1);
});
test('invalid fields/references/collision leave all artifact bytes unchanged', () => {
  for (const bad of [{ type: 'note', title: 'Bad', sources: ['invented'] }, { type: 'source', title: 'Bad' }, { type: 'question', title: 'Bad', state: 'nonsense' }]) {
    const f = fixture([{ type: 'question', title: 'Good' }, bad]); assert.ok(f.run().errors.length); assert.deepEqual(bytes(f.vault), []);
  }
  const f = fixture(); const r = f.run(); const before = bytes(f.vault);
  fs.writeFileSync(f.path, JSON.stringify([{ type: 'question', title: 'First', body: 'unrelated content' }]));
  const c = captureOperation(f.vault, f.path, 'new_key', { now }); assert.equal(c.errors[0].code, 'DESTINATION_CONFLICT'); assert.deepEqual(bytes(f.vault), before);
  assert.ok(r.created.length);
});
test('first/middle failures: pending stays pending, deterministic permission failures never retry', () => {
  for (const index of [0, 1]) for (const code of ['EACCES', 'ENOSPC', 'EAGAIN']) {
    const f = fixture(); const r = f.run({ event: (event, row) => { if (event === 'artifact' && row.index === index) fail(code); } });
    assert.equal(r.created.length, index); assert.equal(bytes(f.vault).length, index);
    assert.equal(r.operation.results[index].state, 'pending'); assert.equal(r.errors[0].retryable, code === 'EAGAIN');
    const before = bytes(f.vault); const resumed = f.run({ now: '2026-11-14' }); assert.equal(resumed.operation.phase, 'complete');
    assert.deepEqual(bytes(f.vault).slice(0, index), before); assert.ok(resumed.created.every(c => c.id.startsWith(now)));
  }
});
test('receipt initial/update failure and manifest failure retain recovery and created IDs', () => {
  const initial = fixture(); const r = initial.run({ event: e => { if (e === 'receipt') fail('EACCES'); } });
  assert.equal(r.recoveryStateCreated, false); assert.equal(bytes(initial.vault).length, 0);
  const f = fixture(); let calls = 0;
  const broken = f.run({ event: e => { if (e === 'receipt' && ++calls === 3) fail('EIO'); } });
  assert.equal(broken.created.length, 1); assert.equal(bytes(f.vault).length, 1);
  const prior = JSON.parse(fs.readFileSync(join(f.vault, '.capture-operations/stable_key.json'))); assert.equal(prior.results[0].state, 'pending');
  assert.equal(f.run().operation.phase, 'complete'); assert.equal(bytes(f.vault).length, 2);
  const m = fixture(); const bad = m.run({ event: e => { if (e === 'manifest') fail('EIO'); } });
  assert.equal(bad.created.length, 2); assert.equal(bad.operation.phase, 'needs-repair'); const before = bytes(m.vault);
  assert.equal(m.run().operation.manifest, 'complete'); assert.deepEqual(bytes(m.vault), before);
});
test('incomplete reconciliation refuses changed, missing, malformed or unreadable completed files', () => {
  for (const mutate of [p => fs.appendFileSync(p, 'changed'), p => fs.unlinkSync(p), p => fs.writeFileSync(p, '---\ninvalid'), p => { fs.unlinkSync(p); fs.mkdirSync(p); }]) {
    const f = fixture(); const r = f.run({ event: (e, row) => { if (e === 'artifact' && row.index === 1) fail('EBUSY'); } });
    mutate(r.created[0].path); const after = f.run(); assert.equal(after.errors[0].code, 'DESTINATION_CONFLICT');
    assert.equal(fs.existsSync(join(f.vault, 'questions', `${now}-second.md`)), false);
  }
});
test('relative content inputs, missing/changed inputs and schema drift block replay', () => {
  const f = fixture([{ type: 'source', title: 'Source', url: 'https://example.test/a', contentFile: 'body.txt' }]);
  fs.writeFileSync(join(f.root, 'body.txt'), 'original'); assert.equal(f.run().errors.length, 0);
  const before = bytes(f.vault); fs.writeFileSync(join(f.root, 'body.txt'), 'changed'); assert.equal(f.run().errors[0].code, 'INPUT_CHANGED');
  fs.unlinkSync(join(f.root, 'body.txt')); assert.ok(f.run().errors.length); assert.deepEqual(bytes(f.vault), before);
  const s = fixture(); s.run(); const repo = join(s.root, 'repo'); fs.mkdirSync(repo); fs.cpSync('schema', join(repo, 'schema'), { recursive: true });
  const taxonomy = join(repo, 'schema/taxonomy.json'); const data = JSON.parse(fs.readFileSync(taxonomy)); data.extra = 'changed'; fs.writeFileSync(taxonomy, JSON.stringify(data));
  assert.equal(s.run({ repoRoot: repo }).errors[0].code, 'INPUT_CHANGED');
});
test('source dedup resolves actual ID and alias references reject whole plan', () => {
  const f = fixture([{ type: 'source', title: 'Original', url: 'https://example.test/a' }]); f.run(); const before = bytes(f.vault);
  fs.writeFileSync(f.path, JSON.stringify([{ type: 'source', title: 'Alias', url: 'https://example.test/a' }, { type: 'note', title: 'Dependent', sources: [`${now}-alias`] }]));
  const bad = captureOperation(f.vault, f.path, 'alias', { now }); assert.ok(bad.errors.length); assert.equal(bad.results[0].id, `${now}-original`); assert.deepEqual(bytes(f.vault), before);
  const plan = JSON.parse(fs.readFileSync(f.path)); plan[1].sources = [`${now}-original`]; fs.writeFileSync(f.path, JSON.stringify(plan));
  const good = captureOperation(f.vault, f.path, 'actual', { now }); assert.equal(good.skipped[0].id, `${now}-original`); assert.equal(good.created.length, 1);
});
test('process interruption after publication retains lock; explicit recovery reconciles prepared fingerprint', () => {
  const f = fixture(); const module = new URL('../bin/lib/capture-operation.mjs', import.meta.url).href;
  const code = `import { captureOperation } from ${JSON.stringify(module)}; captureOperation(${JSON.stringify(f.vault)},${JSON.stringify(f.path)},'stable_key',{now:${JSON.stringify(now)},event:e=>{if(e==='published')process.kill(process.pid,'SIGKILL')}})`;
  const killed = spawnSync(process.execPath, ['--input-type=module', '-e', code]); assert.equal(killed.signal, 'SIGKILL'); assert.equal(bytes(f.vault).length, 1);
  const lock = join(f.vault, '.capture-operations/writer.lock'); const owner = JSON.parse(fs.readFileSync(join(lock, 'owner.json'))); assert.equal(owner.operationId, 'stable_key');
  const blocked = f.run(); assert.equal(blocked.errors[0].code, 'LOCK_BUSY'); assert.equal(blocked.errors[0].retryable, false);
  // Test owns and has waited for the killed child; manual recovery is explicit.
  fs.rmSync(lock, { recursive: true }); const before = bytes(f.vault); assert.equal(f.run().operation.phase, 'complete'); assert.deepEqual(bytes(f.vault).slice(0, 1), before);
});
test('exclusive publication refuses a late destination collision; discovery ignores private dirs', () => {
  const f = fixture(); const r = f.run({ event: (e, row) => { if (e === 'artifact' && row.index === 0) { fs.mkdirSync(join(f.vault, 'questions')); fs.writeFileSync(join(f.vault, row.path), 'human data'); } } });
  assert.equal(r.errors[0].code, 'DESTINATION_CONFLICT'); assert.equal(fs.readFileSync(join(f.vault, 'questions', `${now}-first.md`), 'utf8'), 'human data');
  fs.mkdirSync(join(f.vault, '.research-tasks')); fs.writeFileSync(join(f.vault, '.research-tasks/hidden.md'), 'not an entry'); assert.equal(walkEntries(f.vault).length, 1);
});
test('CLI explicit vault overrides binding/env from unrelated cwd with metacharacters; invalid combinations exit 2', () => {
  const f = fixture([{ type: 'question', title: 'payload $(); quote "', body: '$(touch forbidden); `literal`' }]);
  const a = join(f.root, 'vault A'), d = join(f.root, 'default'), cwd = join(f.root, 'cwd'); for (const dir of [a, d, cwd]) fs.mkdirSync(dir);
  fs.writeFileSync(join(cwd, '.research-vault.json'), JSON.stringify({ vault: a }));
  const cli = resolve('bin/research-vault.mjs'); const env = { ...process.env, RESEARCH_VAULT_PATH: d, HOME: f.root, XDG_CONFIG_HOME: join(f.root, 'config') };
  const osDefault = defaultVaultPath({ platform: process.platform, home: f.root, env });
  fs.mkdirSync(osDefault, { recursive: true }); fs.writeFileSync(join(osDefault, 'sentinel'), 'unchanged');
  const args = [cli, 'capture', '--batch', f.path, '--operation-id', 'explicit', '--vault', f.vault];
  const r = spawnSync(process.execPath, args, { cwd, env, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr + r.stdout); assert.equal(JSON.parse(r.stdout).created.length, 1);
  assert.deepEqual(fs.readdirSync(a), []); assert.deepEqual(fs.readdirSync(d), []); assert.equal(fs.existsSync(join(cwd, 'forbidden')), false); assert.deepEqual(fs.readdirSync(osDefault), ['sentinel']); assert.equal(fs.readFileSync(join(osDefault, 'sentinel'), 'utf8'), 'unchanged');
  const bad = spawnSync(process.execPath, [...args, '--continue'], { cwd, env, encoding: 'utf8' }); assert.equal(bad.status, 2); assert.equal(JSON.parse(bad.stdout).recoveryStateCreated, false);
});
test('adversarial: normalized empty references rejected and intra-plan source reuse completes', () => {
  for (const spec of [{ type: 'note', title: 'Bad', sources: ',' }, { type: 'synthesis', title: 'Bad', contributingIds: ',' }]) {
    const f = fixture([spec]); assert.ok(f.run().errors.length); assert.deepEqual(bytes(f.vault), []);
  }
  const f = fixture([{ type: 'source', title: 'One', url: 'https://example.test' }, { type: 'source', title: 'Alias', url: 'https://example.test' }]);
  const r = f.run(); assert.equal(r.errors.length, 0); assert.equal(r.created.length, 1); assert.equal(r.skipped.length, 1); assert.equal(f.run().historical, true);
});
test('adversarial: reload receipt under lock; competing completed key cannot be replaced', () => {
  const f = fixture([{ type: 'question', title: 'A' }]); const other = join(f.root, 'other.json'); fs.writeFileSync(other, '[{"type":"question","title":"B"}]');
  const module = new URL('../bin/lib/capture-operation.mjs', import.meta.url).href;
  const r = f.run({ event: event => {
    if (event !== 'before-lock') return;
    const code = `import {captureOperation} from ${JSON.stringify(module)};const r=captureOperation(${JSON.stringify(f.vault)},${JSON.stringify(other)},'stable_key',{now:${JSON.stringify(now)}});process.exit(r.errors.length?1:0)`;
    assert.equal(spawnSync(process.execPath, ['--input-type=module', '-e', code]).status, 0);
  } });
  assert.equal(r.errors[0].code, 'INPUT_CHANGED'); assert.equal(bytes(f.vault).length, 1); assert.match(bytes(f.vault)[0][0], /-b.md$/);
  assert.equal(captureOperation(f.vault, other, 'stable_key', { now }).historical, true);
});
test('two live opt-in writers cannot share the vault lock', () => {
  const f = fixture(); const module = new URL('../bin/lib/capture-operation.mjs', import.meta.url).href;
  f.run({ event: event => {
    if (event !== 'locked') return;
    const code = `import {captureOperation} from ${JSON.stringify(module)};console.log(JSON.stringify(captureOperation(${JSON.stringify(f.vault)},${JSON.stringify(f.path)},'competitor',{now:${JSON.stringify(now)}})))`;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' });
    assert.equal(JSON.parse(child.stdout).errors[0].code, 'LOCK_BUSY'); assert.deepEqual(bytes(f.vault), []);
  } });
  assert.equal(bytes(f.vault).length, 2);
});
test('canonical object keys replay identically; array order and semantic options change identity', () => {
  const f = fixture([{ type: 'question', title: 'One', topics: ['a', 'b'] }]); assert.equal(f.run().errors.length, 0);
  fs.writeFileSync(f.path, JSON.stringify([{ topics: ['a', 'b'], title: 'One', type: 'question' }])); assert.equal(f.run().historical, true);
  assert.equal(f.run({ ackDataEgress: true }).errors[0].code, 'INPUT_CHANGED');
  fs.writeFileSync(f.path, JSON.stringify([{ topics: ['b', 'a'], title: 'One', type: 'question' }])); assert.equal(f.run().errors[0].code, 'INPUT_CHANGED');
});
test('CLI historical flags, ingest/consent refusals, and validation/conflict/storage/finalization exits', () => {
  const cli = resolve('bin/research-vault.mjs');
  const run = (f, key, extra = [], nodeArgs = []) => {
    const r = spawnSync(process.execPath, [...nodeArgs, cli, 'capture', '--batch', f.path, '--operation-id', key, '--vault', f.vault, ...extra], { encoding: 'utf8' });
    return { status: r.status, report: JSON.parse(r.stdout) };
  };
  const f = fixture(); assert.equal(run(f, 'key').status, 0); const before = bytes(f.vault);
  const replay = run(f, 'key'); assert.equal(replay.status, 0); assert.equal(replay.report.replay, true); assert.equal(replay.report.historical, true); assert.deepEqual(bytes(f.vault), before);
  const bad = fixture([{ type: 'note', title: 'Bad' }]); assert.equal(run(bad, 'bad').status, 1); assert.deepEqual(bytes(bad.vault), []);
  const ingest = fixture(); ingest.path = join(ingest.root, 'urls.txt'); fs.writeFileSync(ingest.path, 'https://example.test'); assert.equal(run(ingest, 'ingest').status, 2); assert.deepEqual(bytes(ingest.vault), []);
  const consent = fixture([{ type: 'source', title: 'Body', url: 'https://example.test', content: 'consented fixture text', storeBody: true }]);
  assert.equal(run(consent, 'body').status, 1); assert.deepEqual(bytes(consent.vault), []); assert.equal(run(consent, 'body', ['--ack-data-egress']).status, 0);
  fs.writeFileSync(f.path, '[{"type":"question","title":"First","body":"collision"}]'); assert.equal(run(f, 'conflict').status, 1); assert.deepEqual(bytes(f.vault), before);
  const manifest = fixture(); fs.mkdirSync(join(manifest.vault, '.vault-manifest.json.tmp')); const m = run(manifest, 'manifest'); assert.equal(m.status, 1); assert.equal(m.report.errors[0].code, 'MANIFEST_IO'); assert.equal(bytes(manifest.vault).length, 2);
  const storage = fixture(); const inject = join(storage.root, 'inject.mjs');
  fs.writeFileSync(inject, "import fs from 'node:fs';import{syncBuiltinESMExports}from'node:module';fs.linkSync=()=>{throw Object.assign(new Error('injected EACCES'),{code:'EACCES'})};syncBuiltinESMExports();");
  const s = run(storage, 'storage', [], ['--import', inject]); assert.equal(s.status, 1); assert.equal(s.report.errors[0].code, 'ARTIFACT_IO'); assert.equal(s.report.errors[0].retryable, false); assert.deepEqual(bytes(storage.vault), []);
});
test('actual temporary-write and rename failures preserve prior receipt bytes', async () => {
  const mutable = (await import('node:fs')).default; const { syncBuiltinESMExports } = await import('node:module');
  for (const method of ['writeFileSync', 'renameSync']) {
    const f = fixture(); const original = mutable[method]; let calls = 0; let prior;
    mutable[method] = (...args) => {
      const destination = String(args[method === 'renameSync' ? 1 : 0]);
      if (destination.includes('stable_key.json') && ++calls === 3) {
        prior = fs.readFileSync(join(f.vault, '.capture-operations/stable_key.json'), 'utf8');
        fail('EACCES');
      }
      return original(...args);
    };
    syncBuiltinESMExports(); let result;
    try { result = f.run(); } finally { mutable[method] = original; syncBuiltinESMExports(); }
    assert.equal(result.errors[0].code, 'RECEIPT_IO'); assert.equal(result.created.length, 1); assert.equal(bytes(f.vault).length, 1);
    assert.equal(fs.readFileSync(join(f.vault, '.capture-operations/stable_key.json'), 'utf8'), prior);
    assert.equal(f.run().operation.phase, 'complete'); assert.equal(bytes(f.vault).length, 2);
  }
});
test('connected host paths output is explicit without installing a host', () => {
  const f = fixture(); const r = spawnSync(process.execPath, [resolve('bin/research-vault.mjs'), 'host', 'paths', '--vault', f.vault], { encoding: 'utf8' });
  assert.equal(r.status, 0); const result = JSON.parse(r.stdout);
  assert.equal(result.vault, f.vault); assert.equal(result.cli, resolve('bin/research-vault.mjs')); assert.equal(result.package, resolve('.')); assert.equal(result.assets, resolve('skills/research-teach/assets'));
});
test('unwritable receipt directory reports receipt I/O and creates no artifacts', () => {
  const f = fixture(); fs.writeFileSync(join(f.vault, '.capture-operations'), 'obstruction');
  const result = f.run(); assert.equal(result.errors[0].code, 'RECEIPT_IO'); assert.equal(result.recoveryStateCreated, false); assert.deepEqual(bytes(f.vault), []);
});
