import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { captureOperation, digest } from '../bin/lib/capture-operation.mjs';
import { readEntry, writeEntry } from '../bin/lib/fsutil.mjs';
import { writeManifest } from '../bin/lib/manifest.mjs';
import { applyVerification, answerQuestion } from '../bin/commands/verify.mjs';
import { context, command, createTask, loadTask, sourceHandoff, associateClaims, verifyClaim, verifiedClaim, workers, saveBatch, persistBatch, closeOut, closeQuestion, currentPersistence, recovery, intent } from '../bin/lib/research-controller.mjs';
const now = new Date().toISOString().slice(0, 10);
function fixture() {
  const vault = fs.mkdtempSync(join(tmpdir(), 'rv-controller $; '));
  const task = createTask(context(resolve('bin/research-vault.mjs'), vault), 'task');
  const batch = saveBatch(task, 'seed', [{ type: 'source', title: 'Source', url: 'https://example.test/a', subjectName: 'Tool', subjectVersion: '2' }, { type: 'question', title: 'Question' }, { type: 'synthesis', title: 'Synthesis', summary: 'Frozen summary.', contributingIds: [`${now}-source`] }]);
  const report = captureOperation(vault, batch.planPath, batch.key);
  assert.equal(report.errors.length, 0);
  const request = { worker: 'worker-1', url: 'https://example.test/a', version: '2' };
  const extraction = { sourceId: `${now}-source`, claims: ['Scoped claim one', 'Scoped claim two'] };
  return { task, batch, receipt: report.operation, request, extraction };
}
const verdict = claim => ({ claimId: claim.claimId, verified: true, method: 'refetched-source', evidence: { url: claim.url, version: claim.version, scope: claim.scope, observation: 'Matched the relevant statement in fetched evidence.', fingerprint: digest('fetched bytes') } });
const edit = (task, id, change) => { const path = join(task.vault, id === `${now}-source` ? 'sources' : id === `${now}-question` ? 'questions' : 'synthesis', `${id}.md`); const e = readEntry(path); change(e); writeEntry(path, e.data, e.body); return path; };
test('controller handoffs reject invented/wrong vault/type/version/title IDs and bodyless claims', () => {
  const f = fixture();
  for (const result of [null, { error: 'fetch failed' }, { sourceId: 'missing' }, { sourceId: `${now}-question` }]) assert.equal(sourceHandoff(f.task, f.request, result).status, 'unresolved');
  assert.equal(sourceHandoff(f.task, { ...f.request, version: 'wrong' }, f.extraction).status, 'unresolved');
  assert.equal(sourceHandoff(f.task, { ...f.request, url: 'https://unrelated.test' }, f.extraction).status, 'unresolved');
  assert.equal(sourceHandoff(f.task, { ...f.request, requiresStoredBody: true }, f.extraction).status, 'unresolved');
  const other = fs.mkdtempSync(join(tmpdir(), 'rv-other-')); assert.equal(sourceHandoff({ vault: other }, f.request, f.extraction).status, 'unresolved');
  fs.copyFileSync(join(f.task.vault, 'sources', `${now}-source.md`), join(f.task.vault, 'sources', `${now}-duplicate.md`)); assert.equal(sourceHandoff(f.task, f.request, f.extraction).status, 'unresolved');
});
test('captured-only and unsupported verified=true remain unresolved', async () => {
  const f = fixture(), [claim] = associateClaims(f.task, f.request, f.extraction);
  assert.equal(verifiedClaim(f.task, claim, verdict(claim)), false);
  const r = await verifyClaim(f.task, claim, { claimId: claim.claimId, verified: true }); assert.equal(r.status, 'unresolved');
  assert.equal(readEntry(join(f.task.vault, 'sources', `${now}-source.md`)).data.verifications.length, 1);
});
for (const mode of ['workflow', 'sequential']) test(`${mode}: mock host parallel evaluation, controller-owned identities and serialized scoped verification`, async () => {
  const f = fixture(); const claims = associateClaims(f.task, f.request, f.extraction); let active = 0, maximum = 0; const order = [];
  const results = await workers([...claims, { ...claims[0], claimId: 'failed' }], mode, async claim => claim.claimId === 'failed' ? null : verdict(claim), async (claim, result) => {
    active++; maximum = Math.max(maximum, active); order.push(claim.claimId);
    try { return await verifyClaim(f.task, claim, result, async (v, opts) => { await new Promise(r => setTimeout(r, 5)); return applyVerification(v, opts); }); }
    finally { active--; }
  });
  assert.equal(maximum, 1); assert.equal(results.length, 3); assert.equal(results[2].status, 'unresolved');
  assert.ok(claims.every(c => verifiedClaim(f.task, c, verdict(c)))); assert.deepEqual(order, [...claims.map(c => c.claimId), 'failed']);
  assert.equal(readEntry(join(f.task.vault, 'sources', `${now}-source.md`)).data.verifications.length, 3);
  assert.deepEqual(command(f.task, ['search', '--text', '$(literal); "']), [f.task.cli, 'search', '--text', '$(literal); "', '--vault', f.task.vault]);
});
test('verification lost acknowledgment resumes from disk before final plan, no duplicated row', async () => {
  const f = fixture(), [claim] = associateClaims(f.task, f.request, f.extraction), result = verdict(claim);
  await assert.rejects(verifyClaim(f.task, claim, result, (v, opts) => { applyVerification(v, opts); throw new Error('lost acknowledgment'); }), /lost/);
  const resumed = loadTask(f.task.dir); let called = false;
  await verifyClaim(resumed, resumed.claims[claim.claimId], result, () => { called = true; }); assert.equal(called, false);
  assert.equal(readEntry(join(f.task.vault, 'sources', `${now}-source.md`)).data.verifications.length, 2);
  edit(f.task, `${now}-source`, e => { e.data.verifications[1].result = 'inconclusive'; });
  await assert.rejects(verifyClaim(loadTask(f.task.dir), claim, result), /conflict/);
});
const checks = { gate: 'PASS', persistence: true, references: true, lintDisposed: true, resolves: true };
test('question lost acknowledgment freezes summary and repairs finalization, human edit blocks', async () => {
  const f = fixture();
  await assert.rejects(closeQuestion(f.task, 'close', `${now}-question`, `${now}-synthesis`, checks, (v, opts) => { answerQuestion(v, opts); throw new Error('lost'); }), /lost/);
  edit(f.task, `${now}-synthesis`, e => { e.data.summary = 'Changed synthesis'; });
  let called = false;
  await closeQuestion(loadTask(f.task.dir), 'close', `${now}-question`, `${now}-synthesis`, checks, () => { called = true; }); assert.equal(called, false);
  const p = join(f.task.vault, 'questions', `${now}-question.md`); const q = readEntry(p); assert.equal(q.data.answer_summary, 'Frozen summary.'); assert.deepEqual(q.data.contributing, [`${now}-synthesis`]);
  edit(f.task, `${now}-question`, e => { e.data.answer_summary = 'Human revision'; });
  await assert.rejects(closeQuestion(loadTask(f.task.dir), 'close', `${now}-question`, `${now}-synthesis`, checks), /review without mutation/);
  assert.equal(readEntry(p).data.answer_summary, 'Human revision');
});
test('intent persistence failure prevents mutation; question pre-state retries original summary', async () => {
  const f = fixture(); const statePath = join(f.task.dir, 'task.json'); fs.unlinkSync(statePath); fs.mkdirSync(statePath);
  let called = false; const [claim] = [{ ...f.extraction, claimId: 'claim', scope: 'scope' }];
  assert.throws(() => intent(f.task, 'never', { target: claim.claimId }), /EISDIR|ENOTDIR/); assert.equal(f.task.actions.never, undefined);
  await assert.rejects(closeQuestion(f.task, 'close', `${now}-question`, `${now}-synthesis`, checks, () => { called = true; })); assert.equal(called, false);
  const g = fixture(); await assert.rejects(closeQuestion(g.task, 'close', `${now}-question`, `${now}-synthesis`, checks, () => { throw new Error('before write'); }));
  edit(g.task, `${now}-synthesis`, e => { e.data.summary = 'Later'; });
  await closeQuestion(loadTask(g.task.dir), 'close', `${now}-question`, `${now}-synthesis`, checks);
  assert.equal(readEntry(join(g.task.vault, 'questions', `${now}-question.md`)).data.answer_summary, 'Frozen summary.');
});
test('batch retry max three only retryable codes with identical args, two distinct recovery paths', async () => {
  const f = fixture(); f.batch = saveBatch(f.task, 'retry', [{ type: 'question', title: 'Retry' }]); const seen = [];
  const bad = await persistBatch(f.task, f.batch, async args => { seen.push(args); return { errors: [{ code: 'ARTIFACT_IO', retryable: true }], operation: { phase: 'needs-repair' } }; });
  assert.equal(seen.length, 3); assert.ok(seen.every(x => JSON.stringify(x) === JSON.stringify(seen[0]))); assert.match(bad.recovery.capture, /--operation-id/); assert.match(bad.recovery.lifecycle, /research-orchestrate/);
  let n = 0; await persistBatch(f.task, f.batch, async () => { n++; return { errors: [{ code: 'LOCK_BUSY', retryable: false }] }; }); assert.equal(n, 1);
  fs.unlinkSync(f.batch.planPath); await assert.rejects(persistBatch(loadTask(f.task.dir), f.batch, () => { throw new Error('must not execute'); }), /ENOENT/);
  assert.ok(recovery(f.task, f.batch).capture.includes(f.task.vault));
});
for (const mode of ['workflow', 'sequential']) test(`${mode}: closeout gate/lint/closure failure stays partial; current validation after historical completion`, async () => {
  const f = fixture(); const calls = [];
  const host = { lint: async () => { calls.push('lint'); return { errors: 0, disposed: true }; }, gate: async () => { calls.push('gate'); return 'FAIL-as-sent'; }, answer: () => { calls.push('answer'); throw new Error('question write failure'); } };
  const questions = [{ key: 'close', target: `${now}-question`, synthesisId: `${now}-synthesis`, resolves: true }];
  let result = await closeOut(f.task, f.receipt, 'partial', host, questions); assert.equal(result.gate, 'FAIL-as-sent'); assert.deepEqual(calls, ['lint', 'gate']); assert.equal(readEntry(join(f.task.vault, 'questions', `${now}-question.md`)).data.state, 'open');
  host.gate = async () => { calls.push('gate'); return 'PASS'; };
  result = await closeOut(f.task, f.receipt, 'partial', host, questions); assert.equal(result.questions[0].status, 'partial');
  host.lint = async () => ({ errors: 0, disposed: false }); result = await closeOut(f.task, f.receipt, 'partial', host, questions); assert.equal(result.gate, 'NOT RUN');
  edit(f.task, `${now}-synthesis`, e => { e.body += '\nAuthored correction'; }); writeManifest(f.task.vault); assert.equal(currentPersistence(f.task, f.receipt).persistence, true);
  fs.unlinkSync(join(f.task.vault, 'synthesis', `${now}-synthesis.md`)); assert.equal(currentPersistence(f.task, f.receipt).persistence, false);
});
test('post-persistence decomposition captures new notes under a new key and edits synthesis in place', () => {
  const f = fixture(), original = join(f.task.vault, 'synthesis', `${now}-synthesis.md`);
  const batch = saveBatch(f.task, 'decomposition', [{ type: 'note', title: 'New note', sources: [`${now}-source`], body: 'Actual detail.' }]);
  assert.equal(captureOperation(f.task.vault, batch.planPath, batch.key).errors.length, 0);
  edit(f.task, `${now}-synthesis`, e => { e.data.contributing_ids = [`${now}-new-note`]; e.body += '\nRevised synthesis.'; }); writeManifest(f.task.vault);
  assert.equal(currentPersistence(f.task, f.receipt).persistence, true); assert.ok(fs.existsSync(original));
  assert.throws(() => saveBatch(f.task, f.batch.label, [{ type: 'question', title: 'Revised plan' }]), /immutable/);
});
test('adversarial: malformed current artifact and empty stored body cannot count as complete', () => {
  const f = fixture(); edit(f.task, `${now}-source`, e => { e.body = ''; });
  assert.equal(sourceHandoff(f.task, { ...f.request, requiresStoredBody: true }, f.extraction).status, 'unresolved');
  fs.writeFileSync(join(f.task.vault, 'questions', `${now}-question.md`), '---\ntype: source\nstatus: active\n---\n'); writeManifest(f.task.vault);
  assert.equal(currentPersistence(f.task, f.receipt).persistence, false);
});
test('separate tasks namespace batch keys and complete shortcut verifies input identity', async () => {
  const f = fixture(); const second = createTask(context(f.task.cli, f.task.vault), 'second');
  const batch = saveBatch(second, 'seed', [{ type: 'question', title: 'Second task' }]); assert.notEqual(batch.key, f.batch.key);
  let calls = 0; const execute = async () => { calls++; return captureOperation(second.vault, batch.planPath, batch.key); };
  const r = await persistBatch(second, batch, execute); assert.equal(calls, 1); assert.match(r.operation.results[0].id, /second-task$/);
  await persistBatch(loadTask(second.dir), batch, execute); assert.equal(calls, 1, 'complete receipt resumes without capture');
  const path = join(second.vault, '.capture-operations', `${batch.key}.json`); const receipt = JSON.parse(fs.readFileSync(path)); receipt.inputDigest = digest('different'); fs.writeFileSync(path, JSON.stringify(receipt));
  await assert.rejects(persistBatch(loadTask(second.dir), batch, execute), /inputs changed/); assert.equal(calls, 1);
});
test('human question/body edit between attempts blocks original closure without mutation', async () => {
  const f = fixture();
  await assert.rejects(closeQuestion(f.task, 'close', `${now}-question`, `${now}-synthesis`, checks, () => { throw new Error('before write'); }));
  const path = edit(f.task, `${now}-question`, e => { e.data.question = 'A different question'; e.body += '\nHuman revised scope.'; }); const before = fs.readFileSync(path, 'utf8');
  await assert.rejects(closeQuestion(loadTask(f.task.dir), 'close', `${now}-question`, `${now}-synthesis`, checks), /review without mutation/);
  assert.equal(fs.readFileSync(path, 'utf8'), before);
});
test('invented successful capture acknowledgment without recorded receipt cannot complete', async () => {
  const f = fixture(); const batch = saveBatch(f.task, 'new-batch', [{ type: 'question', title: 'Never written' }]);
  await assert.rejects(persistBatch(f.task, batch, async () => ({ errors: [], operation: { ...f.receipt, operationId: batch.key } })), /ENOENT/);
  assert.equal(fs.existsSync(join(f.task.vault, 'questions', `${now}-never-written.md`)), false);
});
