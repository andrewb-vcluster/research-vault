import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { loadSchema, fieldOrder } from '../lib/schema.mjs';
import { makeId, normalizeUrl, normalizeUrlSafe, sha256, verKey } from '../lib/ids.mjs';
import { buildManifest, writeManifest } from '../lib/manifest.mjs';
import { writeEntry, TYPE_FOLDER } from '../lib/fsutil.mjs';
import { resolveVault, reportFallback } from '../lib/resolve.mjs';
import { assertControlledValues } from '../lib/validate.mjs';
import { loadProjectConfig } from '../lib/projectconfig.mjs';
import { csvList } from '../lib/args.mjs';
import { fetchSource } from '../lib/fetchsource.mjs';
import { parseFrontmatter } from '../lib/frontmatter.mjs';
import { loadBlocklist, matchBlock } from '../lib/blocklist.mjs';
import { captureOperation } from '../lib/capture-operation.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function loadSkeleton(repoRoot, type) {
  try { return readFileSync(join(repoRoot, 'vault-template', 'meta', 'entry-skeletons', `${type}.md`), 'utf8').trimEnd(); }
  catch { return ''; }
}

export function prepareEntry(vaultPath, opts, ctx = {}) {
  const repoRoot = opts.repoRoot || REPO_ROOT;
  const schema = loadSchema(repoRoot, { vaultPath });
  const now = opts.now || new Date().toISOString().slice(0, 10);
  const folder = TYPE_FOLDER[opts.type];
  if (!folder) throw new Error(`invalid type: ${opts.type}`);
  if (opts.storeBody && !opts.ackDataEgress)
    throw new Error('--store-body requires --ack-data-egress (storing source text is a data-egress / copyright surface)');
  if (!opts.title) throw new Error('title required');
  if (opts.type === 'source' && !opts.url) throw new Error('source requires url');
  // The source blocklist (spec 32): refused before the dedup check; --force records the override.
  const hit = opts.type === 'source' ? matchBlock(loadBlocklist(vaultPath), opts.url) : null;
  if (hit && !opts.force) throw new Error(`blocked source: ${hit.pattern} (${hit.scope}): ${hit.reason}; --force captures anyway`);
  if (opts.type === 'note' && !(opts.sources && String(opts.sources).length)) throw new Error('note requires sources');
  if (opts.type === 'synthesis' && !(opts.contributingIds && String(opts.contributingIds).length)) throw new Error('synthesis requires contributingIds');

  const pending = ctx.pending || [];
  const hashInput = opts.contentBytes ?? (opts.content || null);
  const newHash = hashInput != null ? sha256(hashInput) : (opts.contentHash || null);
  if (!ctx.ignoreExisting && opts.type === 'source' && opts.url) {
    const normUrl = normalizeUrl(opts.url);
    const version = verKey(opts.subjectVersion);
    const existing = ctx.manifestEntries || buildManifest(vaultPath).entries;
    const candidates = [...existing, ...pending.map(p => ({ id: p.id, source_url: normalizeUrlSafe(p.data.source_url), subject: p.data.subject, content_hash: p.data.content_hash }))];
    for (const e of candidates) {
      if (e.source_url === normUrl && verKey(e.subject?.version) === version) {
        if (newHash && e.content_hash && newHash !== e.content_hash) {
          // §4.2 tripwire: same url+version but content changed → ambiguous (edit / new version / supersede)
          return { dedup: { id: e.id, ambiguous: true, reason: 'content changed at same url+version — verify (edit / new version / supersede)' } };
        }
        return { dedup: { id: e.id, ambiguous: false, reason: `existing entry with same url${version ? ' + version' : ''}` } };
      }
    }
  }

  const id = makeId(now, opts.title);
  const path = join(vaultPath, folder, `${id}.md`);
  // Ids are vault-wide: a title that slugs to an id already used in another folder collides too.
  const taken = Object.values(TYPE_FOLDER).find(f => existsSync(join(vaultPath, f, `${id}.md`)));
  if (!ctx.ignoreExisting && (taken || pending.some(p => p.id === id)))
    return { dedup: { id, ambiguous: false, reason: `entry id ${id} already exists${taken ? ` in ${taken}/` : ''} (supersede via verify, do not overwrite)` } };
  const data = {
    title: opts.title, type: opts.type, created: now,
    domain: opts.domain ? csvList(opts.domain) : ['software-engineering'],
    stage: schema.taxonomy.stage_by_folder[folder].default,
    topics: csvList(opts.topics).map(t => schema.taxonomy.topic_aliases[t] || t),
    status: 'active', related: csvList(opts.related),
    volatility: opts.volatility || 'slow',
    verifications: [{ date: now, by_type: 'agent', by_id: opts.byId || '', method: 'captured', result: 'confirmed', notes: hit ? `captured with --force past the blocklist: ${hit.pattern} (${hit.scope}): ${hit.reason}` : '' }],
  };
  if (opts.type === 'source') {
    data.source_type = opts.sourceType || 'article';
    data.source_url = opts.url || '';
    if (newHash) data.content_hash = newHash;
    if (opts.subjectName) data.subject = { name: opts.subjectName, version: opts.subjectVersion || '' };
    if (opts.series) data.series = opts.series;
    if (opts.authorityTier) data.authority_tier = opts.authorityTier;
    if (opts.authorityBasis) data.authority_basis = opts.authorityBasis;
    if (opts.capturedVia) data.captured_via = opts.capturedVia;
    if (opts.sourceAuthor) data.source_author = opts.sourceAuthor;
    if (opts.summary) data.summary = opts.summary;
  } else if (opts.type === 'note') {
    data.sources = csvList(opts.sources);
    data.confidence = opts.confidence || 'medium';
    if (opts.summary) data.summary = opts.summary;
  } else if (opts.type === 'synthesis') {
    data.contributing_ids = csvList(opts.contributingIds);
    if (opts.question) data.question = opts.question;
    if (opts.synthesisBasis) data.synthesis_basis = opts.synthesisBasis;
    if (opts.summary) data.summary = opts.summary;
    if (opts.confidence) data.confidence = opts.confidence; // no default: an unstated synthesis confidence stays visible
  } else if (opts.type === 'snippet') {
    data.language = opts.language || 'text';
    data.tested = opts.tested === true || opts.tested === 'true';
  } else if (opts.type === 'experiment') {
    data.provider = opts.provider || 'unknown';
    data.model_id = opts.modelId || 'unknown';
    data.date_run = opts.dateRun || now;
    data.task = opts.task || opts.title;
    data.outcome = opts.outcome || 'inconclusive';
  } else if (opts.type === 'question') {
    data.question = opts.question || opts.title;
    data.state = opts.state || 'open';
    if (opts.answerSummary) data.answer_summary = opts.answerSummary;
  }
  assertControlledValues(data, schema);
  const order = fieldOrder(schema, opts.type);
  let body;
  if (opts.body) {
    if (opts.type === 'source') throw new Error('source bodies are gated: use --store-body with --ack-data-egress');
    body = `# ${opts.title}\n\n${String(opts.body).trim()}\n`;
  } else {
    const skel = opts.scaffold ? loadSkeleton(repoRoot, opts.type) : '';
    body = skel ? `# ${opts.title}\n\n${skel}\n` : `# ${opts.title}\n`;
    if (opts.storeBody && opts.content) body += `\n${opts.content}\n`;
  }
  return { id, path, folder, data, body, order, dedup: null };
}

export function captureEntry(vaultPath, opts) {
  const prep = prepareEntry(vaultPath, opts);
  if (prep.dedup) return { dedup: prep.dedup };
  mkdirSync(join(vaultPath, prep.folder), { recursive: true });
  writeEntry(prep.path, prep.data, prep.body, prep.order);
  writeManifest(vaultPath);
  return { id: prep.id, path: prep.path, dedup: null };
}

const csv = v => Array.isArray(v) ? v.join(',') : v;

function specToOpts(spec, cliOpts) {
  const cfBuf = spec.contentFile ? readFileSync(spec.contentFile) : null;
  return {
    ...spec,
    domain: csv(spec.domain), topics: csv(spec.topics), related: csv(spec.related),
    sources: csv(spec.sources), contributingIds: csv(spec.contributingIds),
    content: cfBuf ? cfBuf.toString('utf8') : spec.content, contentBytes: cfBuf ?? spec.contentBytes,
    ackDataEgress: !!cliOpts.ackDataEgress, now: cliOpts.now, repoRoot: cliOpts.repoRoot,
    force: false, // a plan cannot force past the blocklist (spec 32)
  };
}


// Bulk ingest (spec 31): a URL list (one per line, `#` comments) fetched through the refresh fetcher,
// or a directory of Markdown files, each turned into a source spec for the same validate-then-write
// loop as a JSON plan. A failed item leaves a hole in `specs` so indexes stay those of the input.
const NETWORK_OFF = 'network access is off: set RESEARCH_VAULT_ALLOW_NETWORK=1 to ingest a URL list';
const titleOf = (html, fallback) => (/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] || '').replace(/\s+/g, ' ').trim() || fallback;

function mdSpec(dir, name, storeBody) {
  const bytes = readFileSync(join(dir, name));
  const text = bytes.toString('utf8');
  let fm = {};
  if (text.startsWith('---')) { try { fm = parseFrontmatter(text).data; } catch { /* no frontmatter: the first link and heading */ } }
  const url = fm.source_url || fm.url || /\]\((https?:\/\/[^)\s]+)\)/.exec(text)?.[1];
  if (!url) throw new Error(`no source URL: ${name}`);
  const title = fm.title || /^# (.+)$/m.exec(text)?.[1].trim() || basename(name, '.md');
  return { type: 'source', title, url, contentBytes: bytes, content: text, storeBody, sourceAuthor: fm.author || fm.source_author };
}

export async function ingest(vaultPath, path, cliOpts = {}) {
  const specs = [], errors = [];
  if (statSync(path).isDirectory()) {
    readdirSync(path).filter(n => n.endsWith('.md')).sort().forEach((name, index) => {
      try { specs[index] = mdSpec(path, name, cliOpts.storeBody); } catch (e) { errors.push({ index, error: e.message }); }
    });
  } else {
    const fetch = cliOpts.fetch || (cliOpts.allowNetwork ? fetchSource : null);
    if (!fetch) return { errors: [{ index: -1, error: NETWORK_OFF }], created: [], skipped: [] };
    const urls = readFileSync(path, 'utf8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    for (const [index, url] of urls.entries()) {
      try {
        const { status, body } = await fetch(url, {});
        if (status >= 400) throw new Error(`http ${status}`);
        const text = body.toString('utf8');
        specs[index] = { type: 'source', title: titleOf(text, url), url, contentBytes: body, content: text, storeBody: cliOpts.storeBody };
      } catch (e) { errors.push({ index, error: `fetch failed: ${e.message}` }); }
    }
  }
  return runSpecs(vaultPath, specs, cliOpts, errors);
}

export function runBatch(vaultPath, planPath, cliOpts = {}) {
  let plan;
  try { plan = JSON.parse(readFileSync(planPath, 'utf8')); }
  catch (e) { return { errors: [{ index: -1, error: `cannot read plan: ${e.message}` }], created: [], skipped: [] }; }
  if (!Array.isArray(plan) || plan.length === 0)
    return { errors: [{ index: -1, error: 'plan must be a non-empty JSON array' }], created: [], skipped: [] };
  return runSpecs(vaultPath, plan, cliOpts);
}

// Validate every spec, then write; `cliOpts.continue` writes the specs that validated when others failed.
function runSpecs(vaultPath, plan, cliOpts, errors = []) {
  const manifestEntries = buildManifest(vaultPath).entries;
  const knownIds = new Set(manifestEntries.map(e => e.id));
  const skipped = [], pending = [];
  plan.forEach((spec, index) => {
    const before = errors.length;
    try {
      const prep = prepareEntry(vaultPath, specToOpts(spec, cliOpts), { manifestEntries, pending });
      if (prep.dedup) {
        if (prep.dedup.ambiguous) errors.push({ index, error: `${prep.dedup.reason} (existing: ${prep.dedup.id})` });
        else skipped.push({ index, id: prep.dedup.id, reason: prep.dedup.reason });
        return;
      }
      const refs = [...(prep.data.sources || []), ...(prep.data.contributing_ids || []), ...(prep.data.related || [])];
      for (const ref of refs) {
        if (!knownIds.has(ref) && !pending.some(p => p.id === ref))
          errors.push({ index, error: `unresolved reference: ${ref}` });
      }
      if (errors.length === before) pending.push(prep);
    } catch (e) { errors.push({ index, error: e.message }); }
  });
  if (errors.length && !cliOpts.continue) return { errors, created: [], skipped };

  const created = [];
  let failing = null;
  try {
    for (const prep of pending) {
      failing = prep;
      mkdirSync(join(vaultPath, prep.folder), { recursive: true });
      writeEntry(prep.path, prep.data, prep.body, prep.order);
      created.push({ id: prep.id, path: prep.path });
    }
  } catch (e) {
    return { errors: [{ index: -1, error: `write failed at ${failing ? failing.path : '?'}: ${e.message}` }], created, skipped };
  } finally {
    if (created.length) writeManifest(vaultPath);
  }
  return { errors, created, skipped };
}

function captureDefaults(cwd) {
  try {
    const hit = loadProjectConfig(cwd, { schema: loadSchema(REPO_ROOT) });
    return hit ? (hit.config.defaults || {}) : {};
  } catch (e) {
    process.stderr.write(`research-vault: capture defaults ignored: ${e.message}\n`);
    return {};
  }
}

export async function run(args) {
  if (Object.hasOwn(args, 'operation-id')) {
    const invalid = !/^[A-Za-z0-9_-]{1,128}$/.test(args['operation-id'] || '') ||
      !args.batch || !args.batch.endsWith('.json') || args.continue || args['store-body'] ||
      (existsSync(args.batch) && statSync(args.batch).isDirectory());
    if (invalid) {
      process.stdout.write(JSON.stringify({ created: [], skipped: [], errors: [{ code: 'INPUT_INVALID', index: -1, retryable: false, error: 'operation-id requires a JSON-array --batch plan; ingest, --store-body and --continue are not supported' }], recoveryStateCreated: false }) + '\n');
      return 2;
    }
    const selected = resolveVault({ flag: args.vault ?? null, cwd: args.cwd ?? process.cwd() });
    const result = captureOperation(selected.path, args.batch, args['operation-id'], { ackDataEgress: !!args['ack-data-egress'] });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return result.errors.length || result.operation?.phase !== 'complete' ? 1 : 0;
  }
  const cwd = args.cwd ?? process.cwd();
  const resolved = resolveVault({ flag: args.vault ?? null, cwd });
  const vaultPath = resolved.path;
  reportFallback(resolved);
  if (args.batch) {
    const o = { ackDataEgress: !!args['ack-data-egress'], storeBody: !!args['store-body'], continue: !!args.continue, allowNetwork: process.env.RESEARCH_VAULT_ALLOW_NETWORK === '1', fetch: typeof args.fetch === 'function' ? args.fetch : undefined };
    const r = (existsSync(args.batch) && statSync(args.batch).isDirectory()) || !args.batch.endsWith('.json') ? await ingest(vaultPath, args.batch, o) : runBatch(vaultPath, args.batch, o);
    process.stdout.write(JSON.stringify(r, null, 2) + '\n');
    return r.errors.length ? 1 : 0;
  }
  const defaults = captureDefaults(cwd);
  const cfBuf = args['content-file'] ? readFileSync(args['content-file']) : null;
  const r = captureEntry(vaultPath, {
    type: args.type, title: args.title, url: args.url, sourceType: args['source-type'],
    subjectName: args['subject-name'], subjectVersion: args['subject-version'], series: args.series,
    domain: args.domain ?? defaults.domain,
    topics: args.topics ?? (defaults.topics && defaults.topics.length ? defaults.topics.join(',') : undefined),
    related: args.related, byId: args['by-id'], volatility: args.volatility ?? defaults.volatility,
    content: cfBuf ? cfBuf.toString('utf8') : args.content, contentBytes: cfBuf, contentHash: args['content-hash'],
    capturedVia: args['captured-via'], storeBody: !!args['store-body'], ackDataEgress: !!args['ack-data-egress'],
    sources: args.sources, confidence: args.confidence, summary: args.summary,
    contributingIds: args['contributing-ids'], question: args.question,
    synthesisBasis: args['synthesis-basis'],
    authorityTier: args['authority-tier'], authorityBasis: args['authority-basis'],
    language: args.language, tested: args.tested,
    provider: args.provider, modelId: args['model-id'], dateRun: args['date-run'], task: args.task, outcome: args.outcome, state: args.state, answerSummary: args['answer-summary'],
    scaffold: !!args.scaffold, force: !!args.force,
    body: args['body-file'] ? readFileSync(args['body-file'], 'utf8') : undefined,
  });
  if (r.dedup) {
    const how = r.dedup.ambiguous ? 'ambiguous' : 'duplicate';
    process.stdout.write(`${how} of ${r.dedup.id} (${r.dedup.reason}); run verify instead.\n`);
    return 1;
  }
  process.stdout.write(`created ${r.path}\n`);
  return 0;
}
