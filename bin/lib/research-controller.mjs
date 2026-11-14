// Small reference-controller primitives shared by Workflow and sequential instructions.
// Host callbacks do retrieval/evaluation/authoring; this is not a CLI task runner.
import * as fs from 'node:fs';
import { join, resolve, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSchema } from './schema.mjs';
import { assertControlledValues } from './validate.mjs';
import { randomUUID } from 'node:crypto';
import { atomicJson, digest, operationKey, operationIdentity, validReceipt } from './capture-operation.mjs';
import { walkEntries, readEntry, TYPE_FOLDER } from './fsutil.mjs';
import { normalizeUrl, verKey } from './ids.mjs';
import { buildManifest, danglingEdges, writeManifest } from './manifest.mjs';
import { applyVerification, answerQuestion } from '../commands/verify.mjs';

export function context(cli, vault) {
  if (!isAbsolute(cli) || !isAbsolute(vault)) throw new Error('absolute CLI and vault paths required');
  return { cli: fs.realpathSync(cli), vault: fs.realpathSync(vault) };
}
export const command = (ctx, args) => [ctx.cli, ...args, '--vault', ctx.vault];
export function shellCommand(ctx, args, shell = 'posix') {
  const quote = shell === 'powershell' ? s => `'${s.replaceAll("'", "''")}'` : s => `'${s.replaceAll("'", "'\\''")}'`;
  if (!['posix', 'powershell'].includes(shell)) throw new Error('use argument arrays for this host');
  return `${shell === 'powershell' ? '& ' : ''}${[process.execPath, ...command(ctx, args)].map(quote).join(' ')}`;
}
export function createTask(ctx, key = randomUUID()) {
  if (!operationKey(key)) throw new Error('invalid task key');
  const dir = join(ctx.vault, '.research-tasks', key);
  fs.mkdirSync(dirname(dir), { recursive: true, mode: 0o700 });
  fs.mkdirSync(dir, { mode: 0o700 });
  const task = { schemaVersion: 1, key, dir, ...ctx, actions: {}, claims: {}, batches: {} };
  atomicJson(join(dir, 'task.json'), task);
  return task;
}
export function loadTask(dir) {
  if (!isAbsolute(dir)) throw new Error('absolute task directory required');
  const task = JSON.parse(fs.readFileSync(join(dir, 'task.json'), 'utf8'));
  const ctx = context(task.cli, task.vault);
  if (task.schemaVersion !== 1 || !operationKey(task.key) || fs.realpathSync(dir) !== join(ctx.vault, '.research-tasks', task.key) || task.dir !== fs.realpathSync(dir)) throw new Error('task identity mismatch');
  return task;
}
const save = task => atomicJson(join(task.dir, 'task.json'), task);
export function intent(task, key, value) {
  if (!operationKey(key)) throw new Error('invalid action key');
  if (task.actions[key]) {
    if (digest(task.actions[key].intent) !== digest(value)) throw new Error('action intent conflict');
    return task.actions[key];
  }
  const action = { intent: value, status: 'pending' };
  task.actions[key] = action;
  try { save(task); } catch (e) { delete task.actions[key]; throw e; }
  return action;
}
export function resolveEntry(vault, id) {
  const found = walkEntries(vault).filter(path => path.endsWith(`/${id}.md`));
  if (found.length !== 1) throw new Error(`missing or ambiguous entry: ${id}`);
  const entry = readEntry(found[0]);
  const schema = loadSchema(resolve(dirname(fileURLToPath(import.meta.url)), '../..'), { vaultPath: vault });
  if (!entry.data.type || TYPE_FOLDER[entry.data.type] !== entry.folder || entry.data.status !== 'active') throw new Error(`invalid or inactive entry: ${id}`);
  for (const field of ['title', 'created', ...(schema.fields.required_by_type[entry.data.type] || [])]) {
    const value = entry.data[field];
    if (value === undefined || value === null || value === '' || Array.isArray(value) && !value.length) throw new Error(`missing required ${field}: ${id}`);
  }
  for (const field of ['sources', 'contributing_ids', 'related', 'contributing']) if (entry.data[field] !== undefined && (!Array.isArray(entry.data[field]) || entry.data[field].some(v => typeof v !== 'string' || !v.trim()))) throw new Error(`invalid ${field}: ${id}`);
  assertControlledValues(entry.data, schema);
  return { ...entry, path: found[0] };
}
export function sourceHandoff(ctx, request, result) {
  try {
    if (!result || result.error || typeof result.sourceId !== 'string') throw new Error('worker failed or omitted source ID');
    const entry = resolveEntry(ctx.vault, result.sourceId);
    if (entry.data.type !== 'source' || normalizeUrl(entry.data.source_url) !== normalizeUrl(request.url) || verKey(entry.data.subject?.version) !== verKey(request.version)) throw new Error('source type, URL or version mismatch');
    const duplicates = walkEntries(ctx.vault).map(readEntry).filter(e => e.data.type === 'source' && normalizeUrl(e.data.source_url) === normalizeUrl(request.url) && verKey(e.data.subject?.version) === verKey(request.version));
    if (duplicates.length !== 1) throw new Error('ambiguous duplicate source');
    if (request.requiresStoredBody && (!entry.body.trim() || entry.body.trim() === `# ${entry.data.title}`)) throw new Error('required source body unavailable');
    return { status: 'captured', worker: request.worker, url: request.url, version: request.version ?? null, sourceId: entry.id };
  } catch (e) { return { status: 'unresolved', worker: request.worker, url: request.url, reason: e.message }; }
}
export function associateClaims(task, request, result) {
  const source = sourceHandoff(task, request, result);
  if (source.status !== 'captured') return [source];
  if (!Array.isArray(result.claims) || !result.claims.length || result.claims.some(c => typeof c !== 'string' || !c.trim())) return [{ ...source, status: 'unresolved', reason: 'worker omitted claims' }];
  const claims = result.claims.map((scope, index) => ({ ...source, scope, claimId: digest({ worker: request.worker, url: request.url, version: request.version, index, scope }).slice(7), status: 'unresolved' }));
  for (const claim of claims) {
    if (task.claims[claim.claimId] && digest(task.claims[claim.claimId]) !== digest(claim)) throw new Error('claim identity conflict');
    task.claims[claim.claimId] = claim;
  }
  save(task); return claims;
}
// The evaluator supplies observations; a boolean alone never qualifies. Raw fetched text
// may stay transient; save only its locator/hash and a description of the check's scope.
export function evidenceFor(claim, result) {
  if (!result || result.claimId !== claim.claimId || result.verified !== true || !result.evidence || !['refetched-source', 'cross-referenced', 'tool-probe'].includes(result.method)) return null;
  const e = result.evidence;
  if (e.scope !== claim.scope || !e.observation || !/^sha256:[a-f0-9]{64}$/.test(e.fingerprint || '') || normalizeUrl(e.url) !== normalizeUrl(claim.url) || verKey(e.version) !== verKey(claim.version)) return null;
  return { url: e.url, version: e.version ?? null, scope: e.scope, observation: e.observation, fingerprint: e.fingerprint };
}
export function verifiedClaim(task, claim, result) {
  try {
    const evidence = evidenceFor(claim, result);
    if (!evidence) return false;
    const action = task.actions[`verify_${claim.claimId}`];
    if (!action || action.intent.scope !== claim.scope || digest(action.intent.evidence) !== digest(evidence)) return false;
    const e = resolveEntry(task.vault, claim.sourceId);
    return (e.data.verifications || []).some(v => v.method === action.intent.method && v.result === 'confirmed' && v.notes === action.intent.notes);
  } catch { return false; }
}
export function serializeMutations() {
  let tail = Promise.resolve();
  return fn => {
    const next = tail.then(fn);
    tail = next.catch(() => {});
    return next;
  };
}
export async function verifyClaim(task, claim, result, mutate = applyVerification, finalize = writeManifest) {
  const evidence = evidenceFor(claim, result);
  if (!evidence) return { status: 'unresolved', claimId: claim.claimId, reason: 'missing scoped observed evidence' };
  const association = task.claims[claim.claimId];
  if (!association || digest(association) !== digest(claim)) throw new Error('unknown claim association');
  const source = sourceHandoff(task, { worker: claim.worker, url: claim.url, version: claim.version }, { sourceId: claim.sourceId });
  if (source.status !== 'captured') throw new Error(source.reason);
  const marker = `research-task:${task.key}:claim:${claim.claimId}`;
  const notes = `${marker} ${JSON.stringify({ scope: claim.scope, evidence })}`;
  const action = intent(task, `verify_${claim.claimId}`, { kind: 'verify', marker, target: claim.sourceId, method: result.method, result: 'confirmed', scope: claim.scope, notes, evidence });
  const entry = resolveEntry(task.vault, claim.sourceId);
  const rows = (entry.data.verifications || []).filter(v => String(v.notes).includes(marker));
  if (rows.length) {
    if (rows.length !== 1 || rows[0].notes !== notes || rows[0].method !== result.method || rows[0].result !== 'confirmed') throw new Error('verification marker conflict');
    await finalize(task.vault);
  } else {
    if (action.status === 'complete') throw new Error('completed verification disappeared; review required');
    await mutate(task.vault, { id: claim.sourceId, method: result.method, result: 'confirmed', notes });
  }
  action.status = 'complete'; save(task);
  if (!verifiedClaim(task, claim, result)) throw new Error('verification not recorded on disk');
  return { status: 'verified', claimId: claim.claimId, scope: claim.scope };
}
const questionFields = (data, body) => {
  const { state, contributing, answer_summary, updated, ...rest } = data;
  return { state, contributing: contributing || [], answer_summary: answer_summary ?? null, updated: updated ?? null, content: digest({ rest, body }) };
};
export async function closeQuestion(task, key, target, synthesisId, checks, mutate = answerQuestion, finalize = writeManifest) {
  if (!checks || checks.gate !== 'PASS' && checks.gate !== 'MERIT' || !checks.persistence || !checks.references || !checks.lintDisposed || !checks.resolves) throw new Error('question closure prerequisites not met');
  const question = resolveEntry(task.vault, target), synthesis = resolveEntry(task.vault, synthesisId);
  if (question.data.type !== 'question' || synthesis.data.type !== 'synthesis') throw new Error('question/synthesis type mismatch');
  const current = questionFields(question.data, question.body);
  let action = task.actions[key];
  if (!action) {
    const summary = synthesis.data.summary;
    if (typeof summary !== 'string' || !summary.trim()) throw new Error('answer summary required for recoverable closure');
    const date = new Date().toISOString().slice(0, 10);
    action = intent(task, key, { kind: 'question', target, synthesisId, summary, before: current, after: { content: current.content, state: 'answered', contributing: [...new Set([...current.contributing, synthesisId])], answer_summary: summary, updated: date }, date });
  }
  const saved = action.intent;
  if (saved.kind !== 'question' || saved.target !== target || saved.synthesisId !== synthesisId) throw new Error('question intent conflict');
  if (digest(current) === digest(saved.after)) await finalize(task.vault);
  else if (digest(current) === digest(saved.before) && action.status !== 'complete') await mutate(task.vault, { id: target, answeredBy: synthesisId, answerSummary: saved.summary, now: saved.date });
  else throw new Error('question changed outside saved pre/post state; review without mutation');
  const applied = resolveEntry(task.vault, target);
  if (digest(questionFields(applied.data, applied.body)) !== digest(saved.after)) throw new Error('question post-state mismatch');
  action.status = 'complete'; save(task); return { status: 'closed', id: target };
}
export function saveBatch(task, key, plan, { ackDataEgress = false } = {}) {
  if (!operationKey(key)) throw new Error('invalid batch key');
  if (task.batches[key]) {
    if (task.batches[key].ackDataEgress !== ackDataEgress || digest(JSON.parse(fs.readFileSync(task.batches[key].planPath, 'utf8'))) !== digest(plan)) throw new Error('immutable plan changed; use a new key');
    return task.batches[key];
  }
  const label = key;
  key = digest({ task: task.key, batch: label }).slice(7);
  const planPath = join(task.dir, `${key}.json`);
  // Callers author contentFile inputs in this directory, or use absolute paths.
  const inputs = plan.filter(s => s.contentFile).map(s => resolve(task.dir, s.contentFile));
  for (const input of inputs) fs.accessSync(input, fs.constants.R_OK);
  if (plan.some(s => s.type === 'source' && (s.content || s.contentBytes)) && !ackDataEgress) throw new Error('do not duplicate fetched source text in task plans without source-body consent; retain its hash instead');
  if (fs.existsSync(planPath)) {
    if (digest(JSON.parse(fs.readFileSync(planPath, 'utf8'))) !== digest(plan)) throw new Error('orphaned plan conflicts; review required');
  } else fs.writeFileSync(planPath, JSON.stringify(plan, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  task.batches[label] = { key, label, planPath, inputs, planDigest: digest(plan), inputHashes: inputs.map(p => digest(fs.readFileSync(p).toString('base64'))), ackDataEgress };
  save(task); intent(task, `capture_${key}`, { kind: 'capture', ...task.batches[label] });
  return task.batches[label];
}
const batchArgs = batch => ['capture', '--batch', batch.planPath, '--operation-id', batch.key, ...(batch.ackDataEgress ? ['--ack-data-egress'] : [])];
export function recovery(task, batch, shell = 'posix') {
  return { capture: shellCommand(task, batchArgs(batch), shell), lifecycle: `Resume research-orchestrate with task directory ${JSON.stringify(task.dir)}; inspect saved intents and current artifacts before remaining lifecycle checks.` };
}
export async function persistBatch(task, batch, execute) {
  for (const input of [batch.planPath, ...batch.inputs]) fs.accessSync(input, fs.constants.R_OK);
  if (digest(JSON.parse(fs.readFileSync(batch.planPath, 'utf8'))) !== batch.planDigest || batch.inputs.some((p, i) => digest(fs.readFileSync(p).toString('base64')) !== batch.inputHashes[i])) throw new Error('saved batch inputs changed; review and use a new key');
  intent(task, `capture_${batch.key}`, { kind: 'capture', ...batch });
  const receiptPath = join(task.vault, '.capture-operations', `${batch.key}.json`);
  if (fs.existsSync(receiptPath)) {
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    const identity = operationIdentity(task.vault, batch.planPath, { ackDataEgress: batch.ackDataEgress });
    validReceipt(receipt, batch.key, task.vault, identity.count);
    if (receipt.inputDigest !== identity.inputDigest || receipt.schemaDigest !== identity.schemaDigest) throw new Error('receipt inputs changed; cannot resume this operation');
    if (receipt.phase === 'complete') return { operation: receipt, errors: [], historical: true, replay: false, current: currentPersistence(task, receipt) };
  }
  let result;
  for (let attempt = 1; attempt <= 3; attempt++) {
    result = await execute(command(task, batchArgs(batch)));
    if (!result || !Array.isArray(result.errors)) throw new Error('capture returned no structured outcome; inspect receipt before retry');
    if (result.operation?.phase === 'complete' && !result.errors.length) {
      const recorded = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
      const identity = operationIdentity(task.vault, batch.planPath, { ackDataEgress: batch.ackDataEgress });
      validReceipt(recorded, batch.key, task.vault, identity.count);
      if (recorded.phase !== 'complete' || recorded.inputDigest !== identity.inputDigest || recorded.schemaDigest !== identity.schemaDigest) throw new Error('capture acknowledgment does not match recorded completion');
      return { ...result, operation: recorded };
    }
    if (!result.errors.length || !result.errors.every(e => e.retryable === true && ['ARTIFACT_IO', 'MANIFEST_IO', 'RECEIPT_IO'].includes(e.code))) break;
  }
  return { ...result, recovery: recovery(task, batch) };
}
export function currentPersistence(task, receipt) {
  try {
    if (!receipt || receipt.phase !== 'complete' || receipt.vault !== task.vault || !receipt.results.length) throw new Error('no complete persistence receipt');
    for (const row of receipt.results) {
      const e = resolveEntry(task.vault, row.id);
      if (e.path !== join(task.vault, row.path)) throw new Error('receipt path mismatch');
    }
    const manifest = buildManifest(task.vault);
    const visited = new Set();
    const validate = id => {
      if (visited.has(id)) return;
      visited.add(id); resolveEntry(task.vault, id);
      for (const edge of manifest.edges.filter(e => e.from === id)) validate(edge.to);
    };
    for (const row of receipt.results) validate(row.id);
    if (danglingEdges(manifest).length) throw new Error('unresolved references');
    const disk = JSON.parse(fs.readFileSync(join(task.vault, '.vault-manifest.json'), 'utf8'));
    if (digest({ ...disk, generated: null }) !== digest({ ...manifest, generated: null })) throw new Error('manifest requires rebuilding');
    return { persistence: true, references: true };
  } catch (e) { return { persistence: false, references: false, reason: e.message }; }
}
// Executable fan-out boundary: retrieval/evaluation may overlap; commits never do.
export async function workers(items, mode, evaluate, commit) {
  const evaluateOne = async (item, i) => {
    try { const value = await evaluate(item, i); return value ?? { error: 'worker returned null' }; }
    catch (e) { return { error: e.message }; }
  };
  const results = [];
  if (mode === 'workflow') results.push(...await Promise.all(items.map(evaluateOne)));
  else for (const [i, item] of items.entries()) results.push(await evaluateOne(item, i));
  const outcomes = [];
  for (const [i, result] of results.entries()) {
    try { outcomes.push(await commit(items[i], result, i)); }
    catch (e) { outcomes.push({ status: 'unresolved', index: i, reason: e.message }); }
  }
  return outcomes;
}
export async function closeOut(task, receipt, evidence, host, questions = []) {
  const outcome = { evidence, ...currentPersistence(task, receipt), lint: 'not-run', gate: 'NOT RUN', questions: [] };
  if (!outcome.persistence) return outcome;
  try {
    const lint = await host.lint(command(task, ['lint'])); outcome.lint = lint;
    if (!lint || lint.errors || !lint.disposed) return outcome;
    outcome.gate = await host.gate();
    if (!['PASS', 'MERIT'].includes(outcome.gate)) return outcome;
    for (const q of questions) {
      try { outcome.questions.push(await closeQuestion(task, q.key, q.target, q.synthesisId, { ...outcome, lintDisposed: true, resolves: q.resolves }, host.answer, host.finalize)); }
      catch (e) { outcome.questions.push({ status: 'partial', id: q.target, reason: e.message }); }
    }
  } catch (e) { outcome.reason = e.message; }
  return outcome;
}
