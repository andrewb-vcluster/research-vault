// Spec 49: the lab manifest, pins, lab address and every refusal of `teach serve --labs` (commit 1), and the runner,
// the redactor, the widget and the export's refusals (commit 2). Every script a test here starts is written by the test
// under a temp directory, and every test leaves no process of a group it started.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, symlinkSync, rmSync, chmodSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'node:http';
import { once } from 'node:events';
import { createHash, randomBytes } from 'node:crypto';
import { createServer, labStepsHtml, readmeDraft } from '../bin/lib/teach.mjs';
import { readLabs, labPin, lessonLab, lineRedactor, secretHits } from '../bin/lib/labs.mjs';
import { lintWorkspace } from '../bin/lib/lesson.mjs';
import { buildManifest } from '../bin/lib/manifest.mjs';
import { loadSchema, loadTeachSchema } from '../bin/lib/schema.mjs';
import { fixtureVault } from './helpers.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA = loadTeachSchema(ROOT);
const sha = (b) => createHash('sha256').update(b).digest('hex');
const newT = () => randomBytes(32).toString('hex');
// Every temp directory a test makes is removed once that test ends: exactly the directories made here, nothing else.
const made = [];
const tempDir = (prefix) => { const d = mkdtempSync(join(tmpdir(), prefix)); made.push(d); return d; };
afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });

// A workspace with one lab, `demo`, whose up.sh would write up-ran; the lesson stores the pin, computed here
// as spec 49 D2 words it (SHA-256 of JSON.stringify([id, entry]), the entry's keys in D1's order).
function labWorkspace({ extra = {}, pin } = {}) {
  const ws = tempDir('rv-labs-');
  writeFileSync(join(ws, 'MISSION.md'), '# Mission\n');
  mkdirSync(join(ws, 'lessons', 'files', '0001-lab'), { recursive: true });
  mkdirSync(join(ws, 'labs'));
  const script = (rel, body) => { writeFileSync(join(ws, rel), body, { mode: 0o755 }); return { script: rel, sha256: sha(body) }; };
  const up = script('lessons/files/0001-lab/up.sh', '#!/bin/sh\necho up > up-ran\n');
  const down = script('lessons/files/0001-lab/down.sh', '#!/bin/sh\nrm -f up-ran\n');
  const entry = { cost: 'About one second, no downloads', timeout: 60, ...extra, up, down };
  writeFileSync(join(ws, 'labs', 'labs.json'), JSON.stringify({ version: 1, labs: { demo: entry } }, null, 2) + '\n');
  writeLesson(ws, '0001-lab', 'demo', pin ?? sha(JSON.stringify(['demo', entry])));
  return { ws, entry, script };
}
function writeLesson(ws, id, lab, pin) {
  writeFileSync(join(ws, 'lessons', `${id}.html`), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Lab ${id}</title></head>
<body data-lesson="${id}">
<section data-block="lab" aria-label="lab" data-lab="${lab}"><data class="lab-pin" value="${pin}"></data><p>It writes one file.</p><pre>up</pre></section>
</body></html>
`);
}

async function start(ws, opts = {}) {
  const server = createServer(ws, { schema: SCHEMA, ...opts });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, port: server.address().port };
}

// node:http rather than fetch: fetch will not send a caller-chosen Host header.
function req(port, { method = 'GET', path = '/', headers = {}, body, chunked = false }) {
  return new Promise((resolve) => {
    const h = { Host: `127.0.0.1:${port}`, ...headers };
    for (const k of Object.keys(h)) if (h[k] === undefined) delete h[k];
    if (body !== undefined && !chunked && !('Content-Length' in h)) h['Content-Length'] = Buffer.byteLength(body);
    if (chunked) h['Transfer-Encoding'] = 'chunked';
    const r = request({ host: '127.0.0.1', port, method, path, headers: h, setHost: false }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
      res.on('error', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    r.on('error', (e) => resolve({ status: 0, error: e.code }));
    if (body !== undefined) r.write(body);
    r.end();
  });
}

// The cookie pair (`rv-labs-<port>=<value>`) the lab address sets, or undefined.
async function openLab(port, t) {
  const r = await req(port, { path: `/labs/open?t=${t}` });
  return { r, cookie: r.headers['set-cookie']?.[0]?.split(';')[0] };
}
const post = (port, action, body, { cookie, origin = `http://127.0.0.1:${port}`, headers = {} } = {}) => req(port, {
  method: 'POST', path: `/lab/${action}`, body: typeof body === 'string' ? body : JSON.stringify(body),
  headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: cookie, ...headers },
});
const show = (label, r) => console.log(`${label} -> ${r.status} ${JSON.stringify(r.text)}`);

test('spec 49 test 3 (a): a lab id not in the manifest is 404 no lab, and nothing runs', async () => {
  const { ws } = labWorkspace();
  const t = newT();
  const { server, port } = await start(ws, { labs: true, t, env: {} });
  try {
    const { cookie } = await openLab(port, t);
    const r = await post(port, 'run', { lab: 'nope' }, { cookie });
    show('POST /lab/run {"lab":"nope"}', r);
    assert.equal(r.status, 404);
    assert.equal(r.text, 'no lab\n');
    assert.equal(existsSync(join(ws, 'up-ran')), false);
  } finally { server.close(); }
});

test('spec 49 test 3 (b): up.sh with one byte changed is 409 pin mismatch, and nothing runs', async () => {
  const { ws } = labWorkspace();
  writeFileSync(join(ws, 'lessons/files/0001-lab/up.sh'), '#!/bin/sh\necho Up > up-ran\n', { mode: 0o755 });
  const t = newT();
  const { server, port } = await start(ws, { labs: true, t, env: {} });
  try {
    const { cookie } = await openLab(port, t);
    const r = await post(port, 'run', { lab: 'demo' }, { cookie });
    show('POST /lab/run {"lab":"demo"} after one byte of up.sh changed', r);
    assert.equal(r.status, 409);
    assert.equal(r.text, 'pin mismatch: lessons/files/0001-lab/up.sh\n');
    assert.equal(existsSync(join(ws, 'up-ran')), false);
  } finally { server.close(); }
});

test('spec 49 test 3 (c): another port as Origin, with the lab cookie, is 403, and nothing runs', async () => {
  const { ws } = labWorkspace();
  const t = newT();
  const { server, port } = await start(ws, { labs: true, t, env: {} });
  try {
    const { cookie } = await openLab(port, t);
    const r = await post(port, 'run', { lab: 'demo' }, { cookie, origin: `http://127.0.0.1:${port + 1}` });
    show(`POST /lab/run Origin http://127.0.0.1:<port + 1> with cookie ${cookie ? 'set' : 'unset'}`, r);
    assert.ok(cookie, 'the lab address set a cookie');
    assert.equal(r.status, 403);
    assert.equal(r.text, 'forbidden\n');
    assert.equal(existsSync(join(ws, 'up-ran')), false);
  } finally { server.close(); }
});

test('the lab address: 303 with the exact cookie, reusable for the life of the server with one session value; a wrong t and next kept on the server', async () => {
  const { ws } = labWorkspace();
  const t = newT();
  const { server, port } = await start(ws, { labs: true, t, env: {} });
  try {
    const status = async (path) => (await req(port, { path })).status;
    assert.equal((await req(port, { method: 'HEAD', path: `/labs/open?t=${t}` })).status, 405, 'HEAD');
    for (const [label, q] of [['a wrong t', `t=${newT()}`], ['t twice', `t=${t}&t=${t}`], ['a short t', `t=${t.slice(0, 63)}`], ['an empty t', 't='],
      ['no t', ''], ['t upper-case', `t=${t.toUpperCase()}`], ['t[]', `t[]=${t}`]]) {
      const r = await req(port, { path: `/labs/open?${q}` });
      assert.deepEqual([r.status, r.headers['set-cookie']], [403, undefined], label);
    }
    const first = await req(port, { path: `/labs/open?t=${t}&next=/lessons/0001-lab.html` });
    console.log(`GET /labs/open?t=<t>&next=/lessons/0001-lab.html -> ${first.status} Location ${first.headers.location} Set-Cookie ${first.headers['set-cookie'][0].replace(/=[0-9a-f]{64}/, '=<64 hex>')}`);
    assert.equal(first.status, 303);
    assert.equal(first.headers.location, '/lessons/0001-lab.html');
    const [setCookie, ...more] = first.headers['set-cookie'];
    assert.equal(more.length, 0);
    const m = /^rv-labs-(\d+)=([0-9a-f]{64}); HttpOnly; SameSite=Strict; Path=\/$/.exec(setCookie);
    assert.ok(m, setCookie);
    assert.equal(Number(m[1]), port);
    assert.notEqual(m[2], t, 'the session value is not t');
    assert.equal(first.text, '');
    // A second open (a browser restart, a second browser) is 303 again with the same cookie, which passes check 4.
    const again = await req(port, { path: `/labs/open?t=${t}` });
    console.log(`GET /labs/open?t=<t> a second time -> ${again.status} same cookie: ${again.headers['set-cookie']?.[0] === setCookie}`);
    assert.deepEqual([again.status, again.headers.location, again.headers['set-cookie']], [303, '/', [setCookie]]);
    assert.deepEqual(await post(port, 'run', { lab: 'demo' }, { cookie: `rv-labs-${port}=${m[2]}` }).then((r) => [r.status, r.text]), [200, 'lab: exit 0\n']);
    assert.equal((await post(port, 'run', { lab: 'demo' }, { cookie: `rv-labs-${port}=${t}` })).status, 403, 't as the cookie');
    for (const next of ['//evil.example/', 'https://evil.example/', '/lessons/../MISSION.md', '/lessons/0001-lab.html/x', '/lessons/x.html',
      '/lessons/0001-lab.html\r\nX: y', '/%2F%2Fevil.example', '/\\evil.example', '/lessons/0001-lab.html?x=1', '/lessons/0001-lab.html#x']) {
      const r = await req(port, { path: `/labs/open?t=${t}&next=${encodeURIComponent(next)}` });
      assert.deepEqual([r.status, r.headers.location], [303, '/'], next);
    }
    assert.equal(await status(`/labs/open?t=${t}`), 303, 't is still valid');
  } finally { server.close(); }
});

test('under --labs every response forbids framing; without --labs no response carries the two headers (spec 49 D4)', async () => {
  const { ws } = labWorkspace();
  const t = newT();
  const frame = (r) => [r.headers['x-frame-options'], r.headers['content-security-policy']];
  const probes = (port) => [req(port, { path: '/' }), req(port, { path: '/lessons/0001-lab.html' }), req(port, { path: '/nope' }),
    req(port, { path: '/', headers: { Host: 'localhost' } }), req(port, { path: `/labs/open?t=${t}` }), post(port, 'run', { lab: 'demo' })];
  for (const labs of [true, false]) {
    const { server, port } = await start(ws, labs ? { labs, t, env: {} } : {});
    try {
      for (const r of await Promise.all(probes(port))) {
        assert.deepEqual(frame(r), labs ? ['DENY', "frame-ancestors 'none'"] : [undefined, undefined], `${labs} ${r.status}`);
      }
    } finally { server.close(); }
  }
});

test('cookie, body and pin-reader edge cases (security review B8)', async () => {
  const { ws, entry } = labWorkspace();
  const t = newT();
  const { server, port } = await start(ws, { labs: true, t, env: {} });
  try {
    const { cookie } = await openLab(port, t);
    const session = cookie.split('=')[1];
    const name = `rv-labs-${port}`;
    for (const [c, status] of [[`${name}=${newT()}; ${name}=${session}`, 200], [`${name}="${session}"`, 403], [`x${name}=${session}`, 403],
      [`${name}x=${session}`, 403], [`${name}=${session}x`, 403], [`${name}=`, 403], [`${name}`, 403]]) {
      assert.equal((await post(port, 'run', { lab: 'demo' }, { cookie: c })).status, status, c);
    }
    for (const [body, status] of [['{"__proto__": {"lab": "demo"}}', 400], ['{"lab": "demo", "__proto__": {}}', 400], ['{"lab": "nope", "lab": "demo"}', 200], ['{"lab": "demo", "lab": "nope"}', 404]]) {
      assert.equal((await post(port, 'run', body, { cookie })).status, status, body);
    }
    // Check 9 reads lessons/<lesson id>.html regular files only.
    writeLesson(ws, '0001-lab', 'demo', 'a'.repeat(64));
    writeFileSync(join(ws, 'lessons', 'notes.html'), `<!-- <section data-block="lab" data-lab="demo"><data class="lab-pin" value="${sha(JSON.stringify(['demo', entry]))}"></data></section> -->\n`);
    const elsewhere = tempDir('rv-labs-lesson-');
    mkdirSync(join(elsewhere, 'lessons'));
    writeLesson(elsewhere, '0002-real', 'demo', sha(JSON.stringify(['demo', entry])));
    symlinkSync(join(elsewhere, 'lessons', '0002-real.html'), join(ws, 'lessons', '0002-link.html'));
    assert.equal((await post(port, 'run', { lab: 'demo' }, { cookie })).text, "no lesson stores this lab's current pin\n");
  } finally { server.close(); }
  // The data-lab and lab-pin readers skip attribute values whole.
  const l = lessonLab(`<section data-block="lab" title=" data-lab='evil'" data-lab="x"><data title=" class='lab-pin' value='bad'" class="lab-pin" value="good"></data></section>`);
  assert.deepEqual([l.id, l.pin], ['x', 'good']);
});

test('without --labs every lab path is as before: POST 404 not found, /labs/open 404 with no cookie', async () => {
  const { ws } = labWorkspace();
  const { server, port } = await start(ws);
  try {
    for (const a of ['run', 'stop', 'reset', 'verify']) {
      const r = await post(port, a, { lab: 'demo' });
      assert.deepEqual([r.status, r.text], [404, 'not found\n'], a);
    }
    const o = await req(port, { path: `/labs/open?t=${newT()}` });
    console.log(`no --labs: GET /labs/open -> ${o.status} ${JSON.stringify(o.text)} Set-Cookie ${o.headers['set-cookie'] ?? 'none'}`);
    assert.deepEqual([o.status, o.text, o.headers['set-cookie']], [404, 'not found\n', undefined]);
    const page = await req(port, { path: '/lessons/0001-lab.html' });
    assert.ok(page.text.includes('<p>The author ran:</p>') && !page.text.includes('lab-open'));
  } finally { server.close(); }
  assert.throws(() => createServer(ws, { schema: SCHEMA, labs: true }), /64 hex/);
  assert.throws(() => createServer(ws, { schema: SCHEMA, labs: true, t: 'short' }), /64 hex/);
});

test('every refusal of checks 1 to 11 and 13, in order, with its status and body; nothing echoes the request; past them the action runs', async () => {
  const { ws, script } = labWorkspace({ extra: { env: ['LAB_TOKEN'], checks: [] } });
  // A second lab with a verify and a check; a third lab no lesson stores the pin of.
  const check = script('labs/ready.sh', '#!/bin/sh\nexit 0\n');
  mkdirSync(join(ws, 'evidence', '0002'), { recursive: true });
  const verify = script('evidence/0002/check.sh', '#!/bin/sh\ntrue\n');
  const doc = JSON.parse(readFileSync(join(ws, 'labs', 'labs.json'), 'utf8'));
  doc.labs.full = { cost: 'Two seconds', timeout: 5, checks: [{ ...check, message: 'Not ready.' }], up: doc.labs.demo.up, down: doc.labs.demo.down, verify };
  doc.labs.orphan = { cost: 'None', timeout: 5, up: doc.labs.demo.up, down: doc.labs.demo.down };
  writeFileSync(join(ws, 'labs', 'labs.json'), JSON.stringify(doc));
  writeLesson(ws, '0002-full', 'full', sha(JSON.stringify(['full', doc.labs.full])));
  const env = { LAB_TOKEN: 'abc' };
  const logs = [];
  const t = newT();
  const { server, port } = await start(ws, { labs: true, t, env, log: (s) => logs.push(s) });
  try {
    const { cookie } = await openLab(port, t);
    const session = cookie.split('=')[1];
    const rows = [];
    const check1 = async (label, p, status, text) => {
      const r = await p;
      rows.push(`${label} -> ${r.status} ${JSON.stringify(r.text)}`);
      assert.deepEqual([r.status, r.text], [status, text], label);
      for (const s of [t, session, 'abc']) assert.ok(!r.text.includes(s), `${label} echoes nothing secret`);
    };
    const own = `http://127.0.0.1:${port}`;
    await check1('1 Host localhost', req(port, { method: 'POST', path: '/lab/run', body: '{"lab":"demo"}', headers: { Host: `localhost:${port}`, Origin: own, 'Content-Type': 'application/json', Cookie: cookie } }), 403, 'forbidden\n');
    await check1('2 POST /lab/start', req(port, { method: 'POST', path: '/lab/start', body: '{"lab":"demo"}', headers: { Origin: own, 'Content-Type': 'application/json', Cookie: cookie } }), 404, 'not found\n');
    await check1('2 POST /lab/run/', req(port, { method: 'POST', path: '/lab/run/', body: '{"lab":"demo"}', headers: { Origin: own, 'Content-Type': 'application/json', Cookie: cookie } }), 404, 'not found\n');
    await check1('3 no Origin', post(port, 'run', { lab: 'demo' }, { cookie, headers: { Origin: undefined } }), 403, 'forbidden\n');
    await check1('3 Origin null', post(port, 'run', { lab: 'demo' }, { cookie, origin: 'null' }), 403, 'forbidden\n');
    await check1('3 Content-Type text/plain', post(port, 'run', { lab: 'demo' }, { cookie, headers: { 'Content-Type': 'text/plain' } }), 403, 'forbidden\n');
    await check1('3 Content-Length 257', post(port, 'run', 'x'.repeat(257), { cookie }), 403, 'forbidden\n');
    await check1('3 chunked body over 256', req(port, { method: 'POST', path: '/lab/run', body: `{"lab":"${'a'.repeat(300)}"}`, chunked: true, headers: { Origin: own, 'Content-Type': 'application/json', Cookie: cookie } }), 403, 'forbidden\n');
    const noCookie = 'no lab cookie; open the lab address teach serve printed\n';
    await check1('4 no cookie', post(port, 'run', { lab: 'demo' }), 403, noCookie);
    await check1('4 t as the cookie', post(port, 'run', { lab: 'demo' }, { cookie: `rv-labs-${port}=${t}` }), 403, noCookie);
    await check1('4 a wrong cookie', post(port, 'run', { lab: 'demo' }, { cookie: `rv-labs-${port}=${newT()}` }), 403, noCookie);
    await check1('4 the session under another port\'s name', post(port, 'run', { lab: 'demo' }, { cookie: `rv-labs-${port + 1}=${session}` }), 403, noCookie);
    await check1('4 the session value with a byte added', post(port, 'run', { lab: 'demo' }, { cookie: `${cookie}0` }), 403, noCookie);
    await check1('4 before 5: no cookie and a bad body', post(port, 'run', 'not json'), 403, noCookie);
    const badBody = 'body must be {"lab": "<id>"}\n';
    for (const [label, body] of [['not JSON', '{"lab":'], ['an extra key', { lab: 'demo', x: 1 }], ['an array', ['demo']], ['an id that fails LAB_ID_RE', { lab: '../demo' }], ['an upper-case id', { lab: 'Demo' }], ['a number', { lab: 7 }], ['a lesson key', { lab: 'demo', lesson: '0001-lab' }]]) {
      await check1(`5 ${label}`, post(port, 'run', body, { cookie }), 400, badBody);
    }
    await check1('7 an id the manifest lacks', post(port, 'run', { lab: 'nope' }, { cookie }), 404, 'no lab\n');
    await check1('7 constructor', post(port, 'run', { lab: 'constructor' }, { cookie }), 404, 'no lab\n');
    await check1('8 verify on a lab with none', post(port, 'verify', { lab: 'demo' }, { cookie }), 404, 'no verify\n');
    await check1('9 no lesson stores the pin', post(port, 'run', { lab: 'orphan' }, { cookie }), 409, "no lesson stores this lab's current pin\n");
    await check1('11 env unset is named, not valued', post(port, 'reset', { lab: 'demo' }, { cookie }), 409, 'env LAB_TOKEN is unset, shorter than 8 characters or multi-line\n');
    env.LAB_TOKEN = 'abcdefg\nh';
    await check1('11 a multi-line value', post(port, 'run', { lab: 'demo' }, { cookie }), 409, 'env LAB_TOKEN is unset, shorter than 8 characters or multi-line\n');
    env.LAB_TOKEN = 'abcdefgh';
    await check1('13 stop with nothing running', post(port, 'stop', { lab: 'demo' }, { cookie }), 409, 'not running\n');
    for (const [a, end] of [['run', 'lab: exit 0\n'], ['reset', 'lab: exit 0\n'], ['verify', 'lab: verify pass\n']]) await check1(`all checks pass: ${a}`, post(port, a, { lab: a === 'verify' ? 'full' : 'demo' }, { cookie }), 200, end);
    // 10: a check's script, then verify's, each hashed by the action that runs it.
    writeFileSync(join(ws, 'labs', 'ready.sh'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    await check1('10 run hashes a check', post(port, 'run', { lab: 'full' }, { cookie }), 409, 'pin mismatch: labs/ready.sh\n');
    await check1('10 reset does not run the check', post(port, 'reset', { lab: 'full' }, { cookie }), 200, 'lab: exit 0\n');
    writeFileSync(join(ws, 'evidence', '0002', 'check.sh'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    await check1('10 verify hashes verify', post(port, 'verify', { lab: 'full' }, { cookie }), 409, 'pin mismatch: evidence/0002/check.sh\n');
    await check1('10 stop hashes nothing', post(port, 'stop', { lab: 'full' }, { cookie }), 409, 'not running\n');
    writeFileSync(join(ws, 'labs', 'labs.json'), '{"version": 1, "labs": {"demo": {}}}');
    await check1('6 an invalid manifest', post(port, 'run', { lab: 'demo' }, { cookie }), 500, 'labs/labs.json is invalid; run teach lint\n');
    await check1('5 before 6: a bad body and an invalid manifest', post(port, 'run', { lab: 'demo', x: 1 }, { cookie }), 400, badBody);
    console.log(rows.join('\n'));
    console.log(logs.join('\n'));
    assert.ok(logs.length > 0 && logs.every((l) => /^lab [a-z][a-z0-9-]* (run|stop|reset|verify): \d{3} /.test(l)), 'one log line per request past check 5');
    for (const s of [t, session, 'abcdefgh']) assert.ok(!logs.join('\n').includes(s));
    assert.equal(existsSync(join(ws, 'up-ran')), false);
  } finally { server.close(); }
});

test('the lab section on a served lesson: the steps; under --labs the lab-open line without the cookie; never t or the session', async () => {
  const { ws, entry } = labWorkspace({ extra: { env: ['LAB_TOKEN'] } });
  const t = newT();
  const { server, port } = await start(ws, { labs: true, t, env: {} });
  try {
    const plain = await req(port, { path: '/lessons/0001-lab.html' });
    const steps = `<p class="lab-cost">${entry.cost}</p><p>The author ran:</p><pre>lessons/files/0001-lab/up.sh</pre><pre>lessons/files/0001-lab/down.sh</pre>`;
    const open = '<p class="lab-open">To run this lab from the page, open the lab address teach serve printed when it started.</p>';
    console.log(`plain address: ${/<section data-block="lab"[\s\S]*?<\/section>/.exec(plain.text)[0]}`);
    assert.ok(plain.text.includes(`data-lab="demo">${steps}${open}<data class="lab-pin"`), plain.text);
    assert.ok(!/<button|data-lab-live/.test(plain.text));
    const { cookie } = await openLab(port, t);
    const live = await req(port, { path: '/lessons/0001-lab.html', headers: { Cookie: cookie } });
    assert.ok(live.text.includes(`data-lab="demo" data-lab-live>${steps}<data class="lab-pin"`) && !live.text.includes('lab-open'));
    for (const r of [plain, live]) for (const s of [t, cookie.split('=')[1]]) assert.ok(!r.text.includes(s));
    // An id the manifest lacks, and an invalid manifest, add nothing.
    writeLesson(ws, '0002-other', 'other', 'x');
    const other = await req(port, { path: '/lessons/0002-other.html' });
    assert.equal(other.text.includes('lab-cost') || other.text.includes('lab-open'), false);
    writeFileSync(join(ws, 'labs', 'labs.json'), '{');
    const broken = await req(port, { path: '/lessons/0001-lab.html' });
    assert.equal(broken.text.includes('lab-cost') || broken.text.includes('lab-open'), false);
  } finally { server.close(); }
  assert.equal(labStepsHtml({ cost: '<b>&"', up: { script: 'a' }, down: { script: 'b' }, verify: { script: 'c' } }),
    '<p class="lab-cost">&lt;b&gt;&amp;&quot;</p><p>The author ran:</p><pre>a</pre><pre>c</pre><pre>b</pre>');
});

test('readLabs: the shape D1 lists, the pin over the entry as returned, and every path rule (spec 49 D1, D2)', () => {
  const { ws, entry, script } = labWorkspace({ extra: { env: ['LAB_TOKEN', 'B_KEY'] } });
  const got = readLabs(ws);
  assert.deepEqual(Object.keys(got.labs.demo), ['cost', 'timeout', 'env', 'up', 'down']);
  assert.equal(labPin('demo', got.labs.demo), sha(JSON.stringify(['demo', entry])));
  assert.deepEqual(readLabs(tempDir('rv-labs-none-')), { version: 1, labs: {} });
  const outside = tempDir('rv-labs-out-');
  writeFileSync(join(outside, 'x.sh'), '#!/bin/sh\n', { mode: 0o755 });
  symlinkSync(join(outside, 'x.sh'), join(ws, 'labs', 'link.sh'));
  symlinkSync(join(ws, 'lessons/files/0001-lab/up.sh'), join(ws, 'lessons', 'files', 'up-link.sh'));
  mkdirSync(join(ws, 'evidence'));
  symlinkSync(outside, join(ws, 'evidence', '0009'));
  const ok = script('labs/ok.sh', '#!/bin/sh\n');
  const problems = (cmd) => {
    writeFileSync(join(ws, 'labs', 'labs.json'), JSON.stringify({ version: 1, labs: { demo: { ...entry, up: { ...ok, ...cmd } } } }));
    try { readLabs(ws); return []; } catch (e) { return e.problems; }
  };
  const cases = {
    'labs/link.sh': 'lab demo: up labs/link.sh resolves outside labs/',
    'lessons/files/up-link.sh': 'lab demo: up lessons/files/up-link.sh is a symlink',
    'evidence/0009/x.sh': 'lab demo: up evidence/0009/x.sh resolves outside evidence/',
    'labs/../MISSION.md': 'lab demo: up labs/../MISSION.md has an empty segment or one starting with .',
    '/etc/hosts': 'lab demo: up /etc/hosts has an empty segment or one starting with .',
    'labs/%2e%2e/x.sh': 'lab demo: up script does not match ^[A-Za-z0-9._/-]+$',
    'labs//ok.sh': 'lab demo: up labs//ok.sh has an empty segment or one starting with .',
    'MISSION.md': 'lab demo: up MISSION.md is not under labs/, evidence/, lessons/files/',
    'lessons/0001-lab.html': 'lab demo: up lessons/0001-lab.html is not under labs/, evidence/, lessons/files/',
    'labs/missing.sh': 'lab demo: up labs/missing.sh is not a regular file',
    'labs': 'lab demo: up labs is not under labs/, evidence/, lessons/files/',
  };
  for (const [path, line] of Object.entries(cases)) assert.deepEqual(problems({ script: path }), [line], path);
  assert.deepEqual(problems({ sha256: 'ABC' }), ['lab demo: up sha256 must be 64 lowercase hex characters']);
  assert.deepEqual(problems({ args: ['x'] }), ['lab demo: up must have exactly script, sha256']);
  // A symlinked root that leads outside the workspace.
  const ws2 = labWorkspace().ws;
  rmSync(join(ws2, 'labs'), { recursive: true });
  mkdirSync(join(outside, 'labs'));
  writeFileSync(join(outside, 'labs', 'up.sh'), '#!/bin/sh\n', { mode: 0o755 });
  writeFileSync(join(outside, 'labs', 'labs.json'), '{"version": 1, "labs": {}}');
  symlinkSync(join(outside, 'labs'), join(ws2, 'labs'));
  assert.throws(() => readLabs(ws2), /labs\/labs\.json is not a regular file inside the workspace/);
  // The evidence/ root a symlink that leads outside.
  rmSync(join(ws, 'evidence'), { recursive: true });
  symlinkSync(outside, join(ws, 'evidence'));
  assert.deepEqual(problems({ script: 'evidence/x.sh' }), ['lab demo: up evidence/x.sh has a root, evidence/, that resolves outside the workspace']);
  rmSync(join(ws2, 'labs'));
  mkdirSync(join(ws2, 'labs'));
  writeFileSync(join(ws2, 'labs', 'labs.json'), JSON.stringify({ version: 1, labs: { demo: { cost: 'c', timeout: 1, up: { script: 'lessons/files/up.sh', sha256: 'a'.repeat(64) }, down: { script: 'lessons/files/0001-lab/down.sh', sha256: 'a'.repeat(64) } } } }));
  symlinkSync(join(outside, 'labs'), join(ws2, 'lessons', 'files', 'x'));
  rmSync(join(ws2, 'lessons', 'files', '0001-lab'), { recursive: true });
  symlinkSync(outside, join(ws2, 'lessons', 'files', '0001-lab'));
  writeFileSync(join(outside, 'down.sh'), '#!/bin/sh\n');
  assert.throws(() => readLabs(ws2), (e) => assert.deepEqual(e.problems,
    ['lab demo: up lessons/files/up.sh is not a regular file', 'lab demo: down lessons/files/0001-lab/down.sh resolves outside lessons/files/']) ?? true);
  // Top level, ids and fields.
  const bad = (doc) => { writeFileSync(join(ws, 'labs', 'labs.json'), typeof doc === 'string' ? doc : JSON.stringify(doc)); try { readLabs(ws); return []; } catch (e) { return e.problems; } };
  assert.deepEqual(bad('{'), ['labs/labs.json is not JSON']);
  assert.deepEqual(bad({ version: 2, labs: {}, x: 1 }), ['the top level must have exactly version and labs', 'version must be 1']);
  assert.deepEqual(bad({ version: 1, labs: { Bad: {}, ['a'.repeat(41)]: {} } }), ['lab "Bad": the id does not match ^[a-z][a-z0-9-]{0,39}$', `lab "${'a'.repeat(41)}": the id does not match ^[a-z][a-z0-9-]{0,39}$`]);
  assert.deepEqual(bad({ version: 1, labs: { demo: { ...entry, cost: '', timeout: 7201, env: ['A', 'A', 'b'], checks: Array(11).fill({}), extra: 1 } } }), [
    'lab demo: must have cost, timeout, up and down, and may have env, checks and verify, and nothing else',
    'lab demo: cost must be 1 to 200 characters, with no control, line-separator or bidi character', 'lab demo: timeout must be whole seconds, 1 to 7200',
    'lab demo: env must be distinct names matching ^[A-Z_][A-Z0-9_]*$', 'lab demo: checks must be a list of at most 10']);
  assert.deepEqual(bad({ version: 1, labs: { demo: { ...entry, checks: [{ ...ok, message: '' }] } } }), ['lab demo: check 1 message must be 1 to 200 characters, with no control, line-separator or bidi character']);
  for (const cost of ["two\nlines", "tab\there", "rtl \u202e", "c1 \u0085", "ls \u2028", "iso \u2066"]) {
    assert.deepEqual(bad({ version: 1, labs: { demo: { ...entry, cost } } }), ['lab demo: cost must be 1 to 200 characters, with no control, line-separator or bidi character'], JSON.stringify(cost));
  }
  assert.deepEqual(bad({ version: 1, labs: { "x\u0085y": {} } }), ['lab "x\\u0085y": the id does not match ^[a-z][a-z0-9-]{0,39}$']);
  mkdirSync(join(ws, 'labs', 'dir.sh'));
  assert.deepEqual(problems({ script: 'labs/dir.sh' }), ['lab demo: up labs/dir.sh is not a regular file']);
});

test('teach lint: every LAB_* code, and lintLab reads labs/ (spec 49 D3)', () => {
  const { ws, entry, script } = labWorkspace();
  const vault = fixtureVault();
  const ctx = { entries: buildManifest(vault).entries, vaultPath: vault, schema: loadSchema(ROOT), teachSchema: SCHEMA, now: '2026-11-11' };
  const lab = (extra = {}) => lintWorkspace(ws, { ...ctx, ...extra }).filter((f) => f.code.startsWith('LAB_') || f.code === 'WARN_LAB_BYPASSED').map((f) => `${f.code}  ${f.file}: ${f.message}`);
  const pin = sha(JSON.stringify(['demo', entry]));
  const section = (inner, attrs = 'data-lab="demo"') => `<section data-block="lab" aria-label="lab" ${attrs}>${inner}</section>`;
  const page = (body, shape = '') => writeFileSync(join(ws, 'lessons', '0001-lab.html'), `<!doctype html><html><head><title>L</title></head><body data-lesson="0001-lab"${shape}>${body}</body></html>\n`);
  const good = `<data class="lab-pin" value="${pin}"></data><p>It writes one file <a data-cite="2026-01-01-fx-experiment">[1]</a>.</p><pre>up</pre>`;
  page(section(good));
  assert.deepEqual(lab(), []);
  page(section('<p>No output.</p>'));
  assert.deepEqual(lab(), [
    "LAB_OUTPUT_MISSING  lessons/0001-lab.html: lab section has no <pre> of the author's run",
    'LAB_OUTPUT_MISSING  lessons/0001-lab.html: lab section cites no experiment entry',
    `LAB_PIN_STALE  lessons/0001-lab.html: lab section has no lab-pin element; the lab's pin is ${pin}`]);
  page(section(good.replace(pin, 'a'.repeat(64))) + '<!-- ' + section(good) + ' -->');
  assert.deepEqual(lab(), [
    'LAB_PIN_STALE  lessons/0001-lab.html: the stored pin is ' + 'a'.repeat(64) + `; the lab's pin is ${pin}`,
    'LAB_SECTION_DUPLICATE  lessons/0001-lab.html: 2 opening tags whose data-block is lab; a lesson has one lab section',
    'LAB_SECTION_DUPLICATE  lessons/0001-lab.html: a lab section inside an HTML comment']);
  page(section(good, 'data-lab="nope"'));
  assert.deepEqual(lab(), ['LAB_UNKNOWN  lessons/0001-lab.html: data-lab nope is not in labs/labs.json']);
  page(section(good, ''));
  assert.deepEqual(lab(), ['LAB_UNKNOWN  lessons/0001-lab.html: lab section has no data-lab']);
  page(section(good), ' data-shape="project"');
  assert.deepEqual(lab(), ["LAB_VERIFY_MISSING  lessons/0001-lab.html: lab demo has no verify; a project lesson's lab needs one"]);
  page(section(good));
  // The manifest's scripts: one byte changed, no executable bit, no #!, unreadable.
  writeFileSync(join(ws, 'lessons/files/0001-lab/up.sh'), '#!/bin/sh\necho Up > up-ran\n');
  chmodSync(join(ws, 'lessons/files/0001-lab/up.sh'), 0o644);
  writeFileSync(join(ws, 'lessons/files/0001-lab/down.sh'), 'rm -f up-ran\n');
  assert.deepEqual(lab(), [
    `LAB_HASH_MISMATCH  labs/labs.json: lessons/files/0001-lab/up.sh changed: read the change, then copy sha256 ${sha('#!/bin/sh\necho Up > up-ran\n')} into labs.json`,
    `LAB_HASH_MISMATCH  labs/labs.json: lessons/files/0001-lab/down.sh changed: read the change, then copy sha256 ${sha('rm -f up-ran\n')} into labs.json`,
    'LAB_SCRIPT_NOT_RUNNABLE  labs/labs.json: lessons/files/0001-lab/up.sh has no owner executable bit',
    'LAB_SCRIPT_NOT_RUNNABLE  labs/labs.json: lessons/files/0001-lab/down.sh does not start with #!']);
  chmodSync(join(ws, 'lessons/files/0001-lab/up.sh'), 0o000);
  assert.ok(lab().includes('LAB_HASH_MISMATCH  labs/labs.json: lessons/files/0001-lab/up.sh cannot be read'));
  chmodSync(join(ws, 'lessons/files/0001-lab/up.sh'), 0o755);
  // An invalid manifest: its problems, and no lesson code that needs the manifest.
  writeFileSync(join(ws, 'labs', 'labs.json'), JSON.stringify({ version: 1, labs: { demo: { ...entry, up: { script: '/etc/hosts', sha256: entry.up.sha256 } } } }));
  assert.deepEqual(lab(), ['LAB_MANIFEST_INVALID  labs/labs.json: lab demo: up /etc/hosts has an empty segment or one starting with .']);
  // lintLab (the binding's lab block) reads .sh files under labs/ too.
  script('labs/wrap.sh', '#!/bin/sh\nkind create cluster\n');
  assert.ok(lab({ lab: { docs: ['LAB.txt'], uses: ['lab/lib.sh'], bypass: ['kind create cluster'] } }).includes("WARN_LAB_BYPASSED  labs/wrap.sh: line 2: kind create cluster; the binding's lab is LAB.txt"));
});

test('teach readme prints one Labs row per manifest lab after the lessons/files/ rows (spec 49 D9)', () => {
  const { ws } = labWorkspace({ extra: { env: ['LAB_TOKEN', 'B_KEY'] } });
  const doc = JSON.parse(readFileSync(join(ws, 'labs', 'labs.json'), 'utf8'));
  doc.labs.other = { cost: 'One | two', timeout: 1, up: doc.labs.demo.up, down: doc.labs.demo.down };
  writeFileSync(join(ws, 'labs', 'labs.json'), JSON.stringify(doc));
  const labs = readmeDraft(ws).split('## Labs')[1];
  console.log(labs.trim());
  assert.equal(labs, `\n\n| Lesson | Files | Needs on the learner's machine | Fallback |\n|---|---|---|---|\n| 0001-lab | lessons/files/0001-lab/ |  |  |\n| 0001-lab | labs/labs.json: demo | About one second, no downloads; env: LAB_TOKEN, B_KEY |  |\n|  | labs/labs.json: other | One \\| two; env: none |  |\n`);
  writeFileSync(join(ws, 'labs', 'labs.json'), '{');
  assert.ok(!readmeDraft(ws).includes('labs/labs.json'));
});

test('one file imports child_process and one function spawns, with no shell and no argument; no exec, execFile or eval in the serve path (spec 49 D5)', () => {
  const serve = ['bin/lib/labs.mjs', 'bin/lib/teach.mjs', 'bin/lib/lesson.mjs', 'bin/commands/teach.mjs', 'bin/lib/args.mjs', 'skills/research-teach/assets/quiz.js'];
  const RUNS = /child_process|\bspawn\b|(?<![.\w])(exec|execFile|execSync|execFileSync|eval)\s*\(|new Function/;
  for (const f of serve.slice(1)) assert.ok(!RUNS.test(readFileSync(join(ROOT, f), 'utf8')), f);
  // gate.mjs is in the serve path. The Codex installer/reviewer are separate entry points, never serve dependencies.
  const walk = (d) => readdirSync(join(ROOT, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith('.mjs') ? [join(d, e.name)] : []));
  assert.deepEqual(walk('bin').filter((f) => readFileSync(join(ROOT, f), 'utf8').includes('child_process')).sort(), ['bin/lib/codex-review.mjs', 'bin/lib/gate.mjs', 'bin/lib/host-install.mjs', 'bin/lib/labs.mjs']);
  for (const file of serve) assert.doesNotMatch(readFileSync(join(ROOT, file), 'utf8'), /from ['"][^'"]*(?:codex-review|host-install)\.mjs['"]/);
  assert.match(readFileSync(join(ROOT, 'bin/lib/gate.mjs'), 'utf8'), /import \{ execFileSync \} from 'node:child_process';/);
  const src = readFileSync(join(ROOT, 'bin/lib/labs.mjs'), 'utf8');
  assert.deepEqual(src.match(/^import .*child_process.*$/gm), ["import { spawn } from 'node:child_process';"]);
  assert.ok(!/(?<![.\w])(exec|execFile|execSync|execFileSync|eval)\s*\(|new Function|shell:\s*true/.test(src));
  const calls = [...src.matchAll(/\bspawn\(/g)];
  assert.equal(calls.length, 1);
  assert.match(src, /spawn\(join\(ws, cmd\.script\), \[\], \{ cwd: ws, env, shell: false, detached: true, stdio: \['ignore', 'pipe', 'pipe'\] \}\)/);
  // The one spawn sits in launch, right after the path check and the hash, with nothing awaited between.
  const launch = src.slice(src.indexOf('function launch('), src.indexOf('\n}\n', src.indexOf('function launch(')));
  assert.ok(launch.includes('scriptProblem(ws, cmd.script)') && launch.includes('sha256(bytes) !== cmd.sha256') && launch.includes('spawn(') && !launch.includes('await'));
});

const ENV = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: tmpdir(), LANG: 'C' };
const FAST = { STOP_GRACE: 300, KILL_WAIT: 1000, CHECK_TIMEOUT: 2000 };
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const gone = async (pid, group = true, ms = 3000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(20)) {
    try { process.kill(group ? -pid : pid, 0); } catch (e) { if (e.code === 'ESRCH') return true; }
  }
  return false;
};

// A workspace with one lab, `demo`, whose scripts are the given bodies, written under labs/ with mode 755; one lesson
// stores the lab's pin.
function runWs({ up, down = '#!/bin/sh\nexit 0\n', verify, checks = [], env, timeout = 30 } = {}) {
  const ws = tempDir('rv-labs-run-');
  writeFileSync(join(ws, 'MISSION.md'), '# Mission\n');
  mkdirSync(join(ws, 'labs'));
  mkdirSync(join(ws, 'lessons'));
  const script = (rel, body) => { writeFileSync(join(ws, rel), body, { mode: 0o755 }); return { script: rel, sha256: sha(body) }; };
  const entry = {
    cost: 'Seconds', timeout, ...(env ? { env } : {}),
    ...(checks.length ? { checks: checks.map(([body, message], i) => ({ ...script(`labs/check-${i + 1}.sh`, body), message })) } : {}),
    up: script('labs/up.sh', up), down: script('labs/down.sh', down), ...(verify ? { verify: script('labs/verify.sh', verify) } : {}),
  };
  writeFileSync(join(ws, 'labs', 'labs.json'), JSON.stringify({ version: 1, labs: { demo: entry } }));
  writeLesson(ws, '0001-lab', 'demo', sha(JSON.stringify(['demo', entry])));
  return { ws, entry };
}

// A --labs server on `ws` with the lab cookie: act(action) posts {"lab": "demo"}; read() follows a reply as it streams.
async function labServer(ws, { env = ENV, limits = FAST } = {}) {
  const t = newT();
  const logs = [];
  const { server, port } = await start(ws, { labs: true, t, env, limits, log: (s) => logs.push(s) });
  const { cookie } = await openLab(port, t);
  const base = `http://127.0.0.1:${port}`;
  const act = (action, signal) => fetch(`${base}/lab/${action}`, { method: 'POST', signal, headers: { Origin: base, 'Content-Type': 'application/json', Cookie: cookie }, body: '{"lab":"demo"}' });
  const close = async () => { await server.stopLabs(); server.closeAllConnections(); server.close(); };
  return { server, port, t, session: cookie.split('=')[1], logs, act, close };
}
function read(reply) {
  const r = { chunks: [], text: '', status: 0 };
  let waiting = [];
  r.done = reply.then(async (res) => {
    r.status = res.status;
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    try {
      for (let c; !(c = await reader.read()).done;) {
        const s = dec.decode(c.value, { stream: true });
        r.chunks.push([Date.now(), s]);
        r.text += s;
        waiting = waiting.filter(([re, ok]) => (re.test(r.text) ? (ok(), false) : true));
      }
    } catch { r.aborted = true; }
    r.end = Date.now();
    return r;
  }, () => { r.aborted = true; return r; });
  r.until = (re) => new Promise((ok, fail) => {
    if (re.test(r.text)) return ok();
    waiting.push([re, ok]);
    r.done.then(() => (re.test(r.text) ? ok() : fail(new Error(`no ${re} in ${JSON.stringify(r.text)}`))));
  });
  return r;
}
const text = async (reply) => { const res = await reply; return [res.status, await res.text()]; };

test('spec 49 test 1: two unrelated labs on the same code; no topic-specific word in the runner or the widget', async () => {
  // A: up keeps a background sleep, a stand-in service, in its foreground; verify checks it while up runs.
  const a = runWs({
    up: '#!/bin/sh\nsleep 61 &\necho $! > service.pid\necho ready\nwait\n',
    verify: '#!/bin/sh\nkill -0 "$(cat service.pid)"\n',
    down: '#!/bin/sh\nrm -f service.pid\n',
  });
  const s = await labServer(a.ws);
  try {
    const run = read(s.act('run'));
    await run.until(/ready\n/);
    const svc = Number(readFileSync(join(a.ws, 'service.pid'), 'utf8'));
    assert.deepEqual(await text(s.act('verify')), [200, 'lab: verify pass\n']);
    assert.deepEqual(await text(s.act('stop')), [200, 'lab: stopped\n']);
    assert.equal((await run.done).text, 'ready\nlab: stopped\n');
    assert.ok(await gone(svc, false), 'the stand-in service ended with its group');
    assert.deepEqual(await text(s.act('reset')), [200, 'lab: exit 0\n']);
    assert.equal(existsSync(join(a.ws, 'service.pid')), false);
    console.log(`A: run ${JSON.stringify(run.text)}; ${s.logs.join(' | ')}`);
  } finally { await s.close(); }
  // B: up runs node -e to write a file and exits.
  const b = runWs({
    up: `#!/bin/sh\nnode -e "require('fs').writeFileSync('built.txt', 'built')"\n`,
    verify: '#!/bin/sh\ntest -f built.txt\n',
    down: '#!/bin/sh\nrm -f built.txt\n',
  });
  const s2 = await labServer(b.ws);
  try {
    assert.deepEqual(await text(s2.act('run')), [200, 'lab: exit 0\n']);
    assert.deepEqual(await text(s2.act('verify')), [200, 'lab: verify pass\n']);
    assert.deepEqual(await text(s2.act('reset')), [200, 'lab: exit 0\n']);
    assert.deepEqual(await text(s2.act('verify')), [200, 'lab: verify fail (exit 1)\n']);
    console.log(`B: ${s2.logs.join(' | ')}`);
  } finally { await s2.close(); }
  const quiz = readFileSync(join(ROOT, 'skills/research-teach/assets/quiz.js'), 'utf8');
  const widget = quiz.slice(quiz.indexOf('export const LAB_ENDED_EARLY'), quiz.indexOf("if (typeof document !== 'undefined')"));
  for (const [f, src] of [['bin/lib/labs.mjs', readFileSync(join(ROOT, 'bin/lib/labs.mjs'), 'utf8')], ['quiz.js renderLab and labStatus', widget]]) {
    assert.ok(src.length > 1000, f);
    assert.doesNotMatch(src, /\b(docker|podman|kubectl|helm|kubernetes|vcluster|python|pip|venv)\b/i, f);
  }
});

test('spec 49 test 2: Run streams line by line, Stop ends the group, Reset is refused while up runs and runs down after', async () => {
  const { ws } = runWs({
    up: '#!/bin/sh\necho "pid $$"\necho up > up-file\nwhile true; do echo tick; sleep 0.1; done\n',
    down: '#!/bin/sh\nrm -f up-file\necho removed\n',
  });
  const s = await labServer(ws);
  try {
    const run = read(s.act('run'));
    await run.until(/tick\ntick\ntick\n/);
    const pid = Number(/^pid (\d+)$/m.exec(run.text)[1]);
    assert.deepEqual(await text(s.act('reset')), [409, 'busy: demo run\n']);
    assert.deepEqual(await text(s.act('stop')), [200, 'lab: stopped\n']);
    await run.done;
    console.log(`${run.chunks.length} chunks; the reply ended ${run.end - run.chunks[0][0]} ms after the first`);
    assert.ok(run.chunks.length >= 3 && run.end - run.chunks[0][0] >= 200, 'the first line arrived before the action ended');
    assert.match(run.text, /^pid \d+\n(tick\n)+lab: stopped\n$/);
    assert.ok(await gone(pid), 'kill(-pid, 0) throws ESRCH');
    assert.ok(existsSync(join(ws, 'up-file')));
    assert.deepEqual(await text(s.act('reset')), [200, 'removed\nlab: exit 0\n']);
    assert.equal(existsSync(join(ws, 'up-file')), false);
    assert.deepEqual(s.logs, ['lab demo reset: 409 busy: demo run', 'lab demo stop: 200 lab: stopped', 'lab demo run: 200 lab: stopped', 'lab demo reset: 200 lab: exit 0']);
  } finally { await s.close(); }
});

test('spec 49 test 2: a page that closes during up stops its group; one that closes during down does not stop down', async () => {
  const { ws } = runWs({
    up: '#!/bin/sh\necho "pid $$"\nsleep 61\n',
    down: '#!/bin/sh\necho "pid $$"\nsleep 0.5\necho done > down-done\n',
  });
  const s = await labServer(ws);
  try {
    let ac = new AbortController();
    const run = read(s.act('run', ac.signal));
    await run.until(/pid \d+\n/);
    const pid = Number(/pid (\d+)/.exec(run.text)[1]);
    ac.abort();
    assert.ok(await gone(pid), 'up\'s group is gone after the page closed');
    await sleep(100);
    assert.deepEqual(s.logs, ['lab demo run: 200 lab: stopped']);
    ac = new AbortController();
    const reset = read(s.act('reset', ac.signal));
    await reset.until(/pid \d+\n/);
    ac.abort();
    await sleep(900);
    assert.equal(readFileSync(join(ws, 'down-done'), 'utf8'), 'done\n', 'down ran to its end');
    assert.deepEqual(s.logs.at(-1), 'lab demo reset: 200 lab: exit 0');
  } finally { await s.close(); }
});

test('spec 49 test 4: checks run before up; one failing leaves up unstarted, and no check output is shown', async () => {
  const fail = runWs({
    checks: [['#!/bin/sh\necho check-one-output\nexit 0\n', 'One is ready.'], ['#!/bin/sh\necho check-two-output >&2\nexit 1\n', 'Start the stand-in, then press Run again.']],
    up: '#!/bin/sh\necho up > up-file\n',
  });
  const s = await labServer(fail.ws);
  try {
    const [status, body] = await text(s.act('run'));
    console.log(`two checks, the second exits 1 -> ${status} ${JSON.stringify(body)}`);
    assert.deepEqual([status, body], [200, 'lab: check 1 ok\nlab: check 2 failed: Start the stand-in, then press Run again.\nlab: not started, 1 check(s) failed\n']);
    assert.equal(existsSync(join(fail.ws, 'up-file')), false);
  } finally { await s.close(); }
  const pass = runWs({ checks: [['#!/bin/sh\nexit 0\n', 'a'], ['#!/bin/sh\necho quiet\n', 'b']], up: '#!/bin/sh\necho up > up-file\necho started\n' });
  const s2 = await labServer(pass.ws);
  try {
    assert.deepEqual(await text(s2.act('run')), [200, 'lab: check 1 ok\nlab: check 2 ok\nstarted\nlab: exit 0\n']);
    assert.ok(existsSync(join(pass.ws, 'up-file')));
  } finally { await s2.close(); }
});

test('a check over CHECK_TIMEOUT has failed; Stop during the checks starts nothing; up is hashed again after the checks', async () => {
  const slow = runWs({ checks: [['#!/bin/sh\necho "pid $$" > check.pid\nsleep 61\n', 'Too slow.']], up: '#!/bin/sh\necho up > up-file\n', verify: '#!/bin/sh\nexit 0\n' });
  const s = await labServer(slow.ws, { limits: { ...FAST, CHECK_TIMEOUT: 300 } });
  try {
    assert.deepEqual(await text(s.act('run')), [200, 'lab: check 1 failed: Too slow.\nlab: not started, 1 check(s) failed\n']);
    assert.ok(await gone(Number(/\d+/.exec(readFileSync(join(slow.ws, 'check.pid'), 'utf8'))[0])));
  } finally { await s.close(); }
  const s2 = await labServer(slow.ws);
  try {
    const run = read(s2.act('run'));
    await sleep(300);
    // Check 12: verify may run beside this lab's up, not beside its checks.
    assert.deepEqual(await text(s2.act('verify')), [409, 'busy: demo run\n']);
    assert.deepEqual(await text(s2.act('stop')), [200, 'lab: stopped\n']);
    assert.equal((await run.done).text, 'lab: stopped\n');
    assert.equal(existsSync(join(slow.ws, 'up-file')), false);
  } finally { await s2.close(); }
  // A check that rewrites up.sh: the run is refused just before up would start.
  const swap = runWs({ checks: [['#!/bin/sh\nprintf \'#!/bin/sh\\necho swapped > up-file\\n\' > labs/up.sh\n', 'x']], up: '#!/bin/sh\necho up > up-file\n' });
  const s3 = await labServer(swap.ws);
  try {
    assert.deepEqual(await text(s3.act('run')), [200, 'lab: check 1 ok\nlab: not started, pin mismatch: labs/up.sh\n']);
    assert.equal(existsSync(join(swap.ws, 'up-file')), false);
  } finally { await s3.close(); }
});

test('spec 49 test 5: verify shows pass or fail, runs beside the same lab\'s up in its own group, and records nothing under attempts/', async () => {
  const { ws } = runWs({
    up: '#!/bin/sh\necho "pid $$"\necho made > made\nsleep 61\n',
    verify: '#!/bin/sh\necho "verify $$ $(ps -o pgid= -p $$ | tr -d \' \')"\ntest -f made\n',
  });
  const s = await labServer(ws);
  try {
    const alone = await text(s.act('verify'));
    assert.match(alone[1], /^verify \d+ \d+\nlab: verify fail \(exit 1\)\n$/);
    const run = read(s.act('run'));
    await run.until(/pid \d+\n/);
    const upPid = Number(/pid (\d+)/.exec(run.text)[1]);
    const [status, body] = await text(s.act('verify'));
    console.log(`verify beside up (pid ${upPid}) -> ${status} ${JSON.stringify(body)}`);
    const [, vpid, vpgid] = /^verify (\d+) (\d+)\n/.exec(body);
    assert.equal(status, 200);
    assert.equal(vpid, vpgid, 'verify leads its own group');
    assert.notEqual(Number(vpgid), upPid);
    assert.ok(body.endsWith('\nlab: verify pass\n'));
    assert.deepEqual(await text(s.act('stop')), [200, 'lab: stopped\n']);
    await run.done;
    assert.ok(await gone(upPid));
    assert.equal(existsSync(join(ws, 'attempts')), false, 'nothing recorded');
  } finally { await s.close(); }
  // Exit 0 and exit 1 alone, a timeout and a stop.
  for (const [verify, limits, expected] of [['#!/bin/sh\nexit 0\n', FAST, 'lab: verify pass\n'], ['#!/bin/sh\nexit 1\n', FAST, 'lab: verify fail (exit 1)\n']]) {
    const w = runWs({ up: '#!/bin/sh\n', verify });
    const v = await labServer(w.ws, { limits });
    try { assert.deepEqual(await text(v.act('verify')), [200, expected]); } finally { await v.close(); }
  }
  const w = runWs({ up: '#!/bin/sh\nsleep 61\n', verify: '#!/bin/sh\necho "pid $$"\nsleep 61\n', timeout: 1 });
  const v = await labServer(w.ws);
  try {
    const [, body] = await text(v.act('verify'));
    assert.match(body, /^pid \d+\nlab: verify fail \(timed out\)\n$/);
    assert.ok(await gone(Number(/\d+/.exec(body)[0])));
    const r = read(v.act('verify'));
    await r.until(/pid \d+\n/);
    assert.deepEqual(await text(v.act('stop')), [200, 'lab: stopped\n']);
    assert.match((await r.done).text, /^pid \d+\nlab: verify fail \(stopped\)\n$/);
  } finally { await v.close(); }
});

test('check 12: a busy server is 409, and two runs sent together give one 200 and one 409', async () => {
  const { ws } = runWs({ up: '#!/bin/sh\necho "pid $$"\nsleep 61\n', verify: '#!/bin/sh\nsleep 0.5\n' });
  const s = await labServer(ws);
  try {
    const [a, b] = [read(s.act('run')), read(s.act('run'))];
    const busy = await Promise.race([a.done, b.done]);
    console.log(`two runs together: ${busy.status} ${JSON.stringify(busy.text)}`);
    assert.deepEqual([busy.status, busy.text], [409, 'busy: demo run\n']);
    const live = busy === a ? b : a;
    await live.until(/pid \d+\n/);
    assert.equal(live.status, 200);
    // Verify beside this lab's up is allowed; a second verify beside them is busy.
    const v1 = read(s.act('verify'));
    await sleep(100);
    assert.deepEqual(await text(s.act('verify')), [409, 'busy: demo verify\n']);
    assert.deepEqual([(await v1.done).status, v1.text], [200, 'lab: verify pass\n']);
    assert.deepEqual(await text(s.act('reset')), [409, 'busy: demo run\n']);
    assert.deepEqual(await text(s.act('run')), [409, 'busy: demo run\n']);
    assert.deepEqual(await text(s.act('stop')), [200, 'lab: stopped\n']);
    await live.done;
    assert.ok(await gone(Number(/pid (\d+)/.exec(live.text)[1])));
  } finally { await s.close(); }
});

test('spec 49 test 6: a declared value never reaches the reply, the log or a file; whole, split in a two-byte character, on stderr, in a long line, last', async () => {
  const value = 'tok-\u00e9-0123456789abcd'; // 20 characters; the e-acute is two bytes, the 5th and 6th
  assert.equal(value.length, 20);
  const up = ['#!/bin/sh',
    'printf \'whole %s\\n\' "$LAB_TOKEN"',
    'printf \'%s\' "$LAB_TOKEN" | head -c 5; sleep 0.2; printf \'%s\\n\' "$LAB_TOKEN" | tail -c +6',
    'printf \'err %s\\n\' "$LAB_TOKEN" >&2',
    'sleep 0.1; head -c 70000 /dev/zero | tr \'\\0\' a; printf \'%s\' "$LAB_TOKEN"; sleep 0.2; printf \'rest-of-the-long-line\\nafter\\n\'',
    'sleep 0.1; printf \'last %s\' "$LAB_TOKEN"', ''].join('\n');
  const { ws } = runWs({ up, env: ['LAB_TOKEN'] });
  const s = await labServer(ws, { env: { ...ENV, LAB_TOKEN: value } });
  try {
    const run = read(s.act('run'));
    await run.done;
    console.log(`reply: ${JSON.stringify(run.text)}`);
    // stdout and stderr are read side by side, so the err line's place among the others is not fixed.
    const lines = run.text.split('\n');
    assert.deepEqual(lines.slice(-3), ['last [redacted]', 'lab: exit 0', '']);
    assert.deepEqual(lines.slice(0, -3).sort(), ['[redacted]', 'after', 'err [redacted]', 'lab: a line over 65536 characters is not shown', 'whole [redacted]']);
    assert.ok(!run.text.includes(value) && !run.text.includes('rest-of-the-long-line'));
    for (const l of s.logs) for (const x of [value, s.t, s.session]) assert.ok(!l.includes(x), l);
    const files = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(d, e.name)) : [join(d, e.name)]));
    for (const f of files(ws)) assert.ok(!readFileSync(f).includes(Buffer.from(value)), f);
    for (const x of [s.t, s.session]) assert.ok(!(await req(s.port, { path: '/lessons/0001-lab.html' })).text.includes(x));
  } finally { await s.close(); }
});

test('the redactor: longest value first, the \\r cut after it, "> " before a piece that starts lab:, the long-line rule, the last partial line', () => {
  const run = (values, chunks, max) => {
    const out = [];
    const r = lineRedactor(values, (s, own) => out.push(own ? `[own] ${s}` : s), max);
    for (const c of chunks) r.write(Buffer.isBuffer(c) ? c : Buffer.from(c));
    r.end();
    return out;
  };
  assert.deepEqual(run(['abcdefgh', 'abcdefghij'], ['x abcdefghij abcdefgh\n']), ['x [redacted] [redacted]']);
  // Overlapping values: the union of their matches is one [redacted]; a value inside another leaves nothing either.
  assert.deepEqual(run(['abcdefgh12', '12345678'], ['abcdefgh12345678\n', 'x 12345678abcdefgh12 y\n']), ['[redacted]', 'x [redacted] y']);
  assert.deepEqual(run(['long-secret-value', 'secret-v'], ['a long-secret-value b secret-v c\n']), ['a [redacted] b [redacted] c']);
  // A line that reads "lab: " once an escape sequence or an invisible character before it is set aside gets "> " too.
  assert.deepEqual(run([], ['\x1b]0;t\x07lab: exit 0\n\u200blab: exit 0\n\x1b[31mlab: verify pass\n\u202elab: x\nsee lab: x\n']),
    ['> \x1b]0;t\x07lab: exit 0', '> \u200blab: exit 0', '> \x1b[31mlab: verify pass', '> \u202elab: x', 'see lab: x']);
  assert.deepEqual(run([], ['x\rlab: verify pass\nlab: exit 0\n\rlab:\n']), ['x', '> lab: verify pass', '> lab: exit 0', '', '> lab:']);
  assert.deepEqual(run(['secret12'], ['secr', 'et12\rlab: secret12']), ['[redacted]', '> lab: [redacted]']);
  const e = Buffer.from('\u00e9');
  assert.deepEqual(run(['\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9'], [Buffer.concat([e, e, e, e, e, e, e, e.subarray(0, 1)]), Buffer.concat([e.subarray(1), Buffer.from('\n')])]), ['[redacted]']);
  assert.deepEqual(run([], ['a'.repeat(11), 'b'.repeat(5), '\nkept\n'], 10), ['[own] lab: a line over 65536 characters is not shown', 'kept']);
  assert.deepEqual(run([], ['a'.repeat(11) + '\nkept\n', 'x'.repeat(12)], 10), ['[own] lab: a line over 65536 characters is not shown', 'kept', '[own] lab: a line over 65536 characters is not shown']);
});

test('a script printing x\\rlab: verify pass, or a line of its own starting lab:, cannot set the status line', async () => {
  const { ws } = runWs({ up: '#!/bin/sh\nprintf \'x\\rlab: verify pass\\n\'\nprintf \'\\033]0;t\\007lab: exit 0\\n\'\nprintf \'\\342\\200\\213lab: exit 0\\n\'\nprintf \'lab: exit 0\'\n', verify: '#!/bin/sh\nprintf \'lab: verify pass\\n\'\nexit 1\n' });
  const s = await labServer(ws);
  try {
    assert.deepEqual(await text(s.act('run')), [200, 'x\n> lab: verify pass\n> \x1b]0;t\x07lab: exit 0\n> \u200blab: exit 0\n> lab: exit 0\nlab: exit 0\n']);
    assert.deepEqual(await text(s.act('verify')), [200, '> lab: verify pass\nlab: verify fail (exit 1)\n']);
  } finally { await s.close(); }
});

test('the environment a script sees is the allowlist and the declared names, nothing else', async () => {
  const { ws } = runWs({ up: '#!/bin/sh\nenv | cut -d= -f1 | sort\n', env: ['LAB_TOKEN', 'KUBE_FILE'] });
  const env = { PATH: ENV.PATH, HOME: tmpdir(), USER: 'learner', LOGNAME: 'learner', SHELL: '/bin/sh', TMPDIR: tmpdir(), LANG: 'C', LC_ALL: 'C',
    LAB_TOKEN: 'abcdefgh-1', KUBE_FILE: '/nowhere/config', OTHER_SECRET: 'not-for-scripts', NODE_OPTIONS: '--inspect', DYLD_INSERT_LIBRARIES: '/x' };
  const s = await labServer(ws, { env });
  try {
    const [, body] = await text(s.act('run'));
    const names = body.split('\n').filter((l) => l && !l.startsWith('lab: '));
    console.log(`names: ${names.join(' ')}`);
    // /bin/sh itself adds PWD, SHLVL and _.
    assert.deepEqual(names.filter((n) => !['PWD', 'SHLVL', '_'].includes(n)), ['HOME', 'KUBE_FILE', 'LAB_TOKEN', 'LANG', 'LC_ALL', 'LOGNAME', 'PATH', 'SHELL', 'TMPDIR', 'USER']);
  } finally { await s.close(); }
});

test('the end of a run: a timeout, a leader that leaves a background child, a child that ignores SIGTERM, a script that cannot start', async () => {
  const slow = runWs({ up: '#!/bin/sh\necho "pid $$"\nsleep 61\n', timeout: 1 });
  let s = await labServer(slow.ws);
  try {
    const [, body] = await text(s.act('run'));
    assert.match(body, /^pid \d+\nlab: timed out after 1 s\n$/);
    assert.ok(await gone(Number(/\d+/.exec(body)[0])));
  } finally { await s.close(); }
  const bg = runWs({ up: '#!/bin/sh\nsleep 61 &\necho "child $!"\nexit 3\n' });
  s = await labServer(bg.ws);
  try {
    const [, body] = await text(s.act('run'));
    assert.match(body, /^child \d+\nlab: exit 3\n$/);
    assert.ok(await gone(Number(/\d+/.exec(body)[0]), false), 'the background child is gone');
  } finally { await s.close(); }
  const stubborn = runWs({ up: '#!/bin/sh\ntrap \'\' TERM\necho "pid $$"\nsleep 61\n' });
  s = await labServer(stubborn.ws);
  try {
    const run = read(s.act('run'));
    await run.until(/pid \d+\n/);
    const t0 = Date.now();
    assert.deepEqual(await text(s.act('stop')), [200, 'lab: stopped\n']);
    console.log(`a child ignoring SIGTERM: stopped after ${Date.now() - t0} ms (STOP_GRACE ${FAST.STOP_GRACE})`);
    assert.ok(Date.now() - t0 >= FAST.STOP_GRACE);
    assert.ok(await gone(Number(/pid (\d+)/.exec(run.text)[1]), true, 50));
    assert.match((await run.done).text, /lab: stopped\n$/);
  } finally { await s.close(); }
  // An interpreter that does not exist: ENOENT on macOS and on Linux.
  const odd = runWs({ up: '#!/nonexistent/interpreter\necho unreachable\n' });
  chmodSync(join(odd.ws, 'labs', 'down.sh'), 0o644);
  s = await labServer(odd.ws);
  try {
    assert.deepEqual(await text(s.act('run')), [200, 'lab: could not start: ENOENT\n']);
    assert.deepEqual(await text(s.act('reset')), [200, 'lab: could not start: EACCES\n']);
  } finally { await s.close(); }
  // No #! line: the server refuses it before spawn, on every platform, and the script does not run.
  const bare = runWs({ up: 'echo ran > ran\n' });
  s = await labServer(bare.ws);
  try {
    assert.deepEqual(await text(s.act('run')), [200, 'lab: could not start: ENOEXEC\n']);
    assert.ok(!existsSync(join(bare.ws, 'ran')), 'the script did not run');
  } finally { await s.close(); }
});

test('a process that left the group and holds the output pipe: the reply still ends once the group is gone; that process is out of reach', async () => {
  const { ws } = runWs({ up: `#!/bin/sh\nnode -e "const c = require('child_process').spawn('sleep', ['61'], { detached: true, stdio: ['ignore', 'inherit', 'inherit'] }); console.log('escaped ' + c.pid); c.unref()"\necho leader-done\n` });
  const s = await labServer(ws);
  let pid;
  try {
    const [, body] = await text(s.act('run'));
    pid = Number(/escaped (\d+)/.exec(body)[1]);
    assert.equal(body, `escaped ${pid}\nleader-done\nlab: exit 0\n`);
    assert.equal(await gone(pid, false, 100), false, 'a new session is not in the group the Stop sequence reaches');
  } finally {
    if (pid) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
    await s.close();
  }
});

test('the output limit: script output past LAB_OUTPUT_MAX is dropped with one line, and the script runs on', async () => {
  const { ws } = runWs({ up: '#!/bin/sh\ni=0\nwhile [ $i -lt 200 ]; do echo "line $i of the output"; i=$((i+1)); done\necho done > finished\n' });
  const s = await labServer(ws, { limits: { ...FAST, LAB_OUTPUT_MAX: 1000 } });
  try {
    const [, body] = await text(s.act('run'));
    const lines = body.split('\n');
    assert.deepEqual(lines.slice(-3), ['lab: output over 1 MiB not shown', 'lab: exit 0', '']);
    assert.ok(Buffer.byteLength(lines.slice(0, -3).join('\n') + '\n') <= 1000);
    assert.ok(existsSync(join(ws, 'finished')));
  } finally { await s.close(); }
});

test('teach serve --labs: SIGTERM, SIGHUP and SIGINT during a run leave no process of the group; the start warning names a page holding a declared value', async () => {
  const value = 'made-up-value-0123';
  const { ws } = runWs({ up: '#!/bin/sh\nsleep 61 &\necho "pid $$ child $!"\nwhile true; do sleep 0.1; done\n', env: ['LAB_TOKEN'] });
  writeFileSync(join(ws, 'lessons', '0002-leak.html'), `<p>${value}</p>\n`);
  const env = { ...ENV, RESEARCH_VAULT_PATH: fixtureVault(), LAB_TOKEN: value };
  for (const sig of ['SIGTERM', 'SIGHUP', 'SIGINT']) {
    const child = spawn(process.execPath, [join(ROOT, 'bin', 'research-vault.mjs'), 'teach', 'serve', '--labs', ws], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (c) => { stderr += c; });
    try {
      await new Promise((ok, fail) => {
        child.stdout.on('data', (c) => { stdout += c; if (/labs: open .*\n/.test(stdout)) ok(); });
        child.on('exit', (code) => fail(new Error(`serve exited ${code}: ${stderr}`)));
      });
      const [, port, t] = /127\.0\.0\.1:(\d+)\/labs\/open\?t=([0-9a-f]{64})/.exec(stdout);
      const open = await req(Number(port), { path: `/labs/open?t=${t}` });
      const cookie = open.headers['set-cookie'][0].split(';')[0];
      const base = `http://127.0.0.1:${port}`;
      const run = read(fetch(`${base}/lab/run`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', Cookie: cookie }, body: '{"lab":"demo"}' }));
      await run.until(/pid \d+ child \d+\n/);
      const [, pid, bgPid] = /pid (\d+) child (\d+)/.exec(run.text).map(Number);
      child.kill(sig);
      const [code, signal] = await once(child, 'exit');
      const left = [await gone(pid), await gone(bgPid, false)];
      console.log(`${sig} during a run: server exit ${code ?? signal}; group gone ${left[0]}, background child gone ${left[1]}`);
      assert.deepEqual(left, [true, true], sig);
      assert.equal(code, 0, sig);
      assert.equal(stderr, 'warning: lessons/0002-leak.html holds the value of LAB_TOKEN\n');
      assert.equal(stdout.split('\n').filter((l) => l.includes(t)).length, 1);
      assert.ok(!stdout.includes(value) && !stderr.includes(value));
      assert.equal(existsSync(join(ws, '.teach-serve.json')), false);
    } finally {
      if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await once(child, 'exit'); }
    }
  }
});

test('SIGTERM to teach serve --labs runs the Stop sequence before exiting: up\'s own TERM trap runs', async () => {
  const { ws } = runWs({ up: '#!/bin/sh\ntrap \'echo cleaned > cleaned; exit 0\' TERM\necho "pid $$"\nwhile true; do sleep 0.1; done\n' });
  const env = { ...ENV, RESEARCH_VAULT_PATH: fixtureVault() };
  const child = spawn(process.execPath, [join(ROOT, 'bin', 'research-vault.mjs'), 'teach', 'serve', '--labs', ws], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    let stdout = '';
    child.stdout.setEncoding('utf8');
    await new Promise((ok, fail) => {
      child.stdout.on('data', (c) => { stdout += c; if (/labs: open .*\n/.test(stdout)) ok(); });
      child.on('exit', (code) => fail(new Error(`serve exited ${code}`)));
    });
    const [, port, t] = /127\.0\.0\.1:(\d+)\/labs\/open\?t=([0-9a-f]{64})/.exec(stdout);
    const cookie = (await req(Number(port), { path: `/labs/open?t=${t}` })).headers['set-cookie'][0].split(';')[0];
    const base = `http://127.0.0.1:${port}`;
    const run = read(fetch(`${base}/lab/run`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', Cookie: cookie }, body: '{"lab":"demo"}' }));
    await run.until(/pid \d+\n/);
    child.kill('SIGTERM');
    const [code] = await once(child, 'exit');
    assert.equal(code, 0);
    assert.equal(readFileSync(join(ws, 'cleaned'), 'utf8'), 'cleaned\n', 'the group got SIGTERM before the server exited, so the trap ran');
    assert.ok(await gone(Number(/pid (\d+)/.exec(run.text)[1])));
  } finally {
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await once(child, 'exit'); }
  }
});

test('once the server has begun stopping its labs, a lab POST past check 5 is 503 the server is stopping', async () => {
  const { ws } = runWs({ up: '#!/bin/sh\necho "pid $$"\nsleep 61\n', verify: '#!/bin/sh\nexit 0\n' });
  const s = await labServer(ws);
  try {
    const run = read(s.act('run'));
    await run.until(/pid \d+\n/);
    const stopping = s.server.stopLabs();
    for (const a of ['run', 'verify', 'reset', 'stop']) assert.deepEqual(await text(s.act(a)), [503, 'the server is stopping\n'], a);
    await stopping;
    assert.equal((await run.done).text.split('\n').at(-2), 'lab: stopped');
    assert.ok(await gone(Number(/pid (\d+)/.exec(run.text)[1])));
  } finally { await s.close(); }
});

test('secretHits skips a declared value under 8 characters, so it gives no start warning and no export refusal', () => {
  const labs = { demo: { env: ['SHORT_ONE', 'LONG_ONE', 'UNSET_ONE'] } };
  const env = { SHORT_ONE: 'abc', LONG_ONE: 'long-value-1', OTHER: 'long-value-2' };
  assert.deepEqual(secretHits([['lessons/a.html', 'abc and long-value-1 and long-value-2'], ['b.sh', Buffer.from('abc')]], labs, env), [['lessons/a.html', 'LONG_ONE']]);
  assert.deepEqual(secretHits([['lessons/a.html', 'abcdefg']], labs, { SHORT_ONE: 'abcdefg' }), []);
  assert.deepEqual(secretHits([['lessons/a.html', 'abcdefgh']], labs, { SHORT_ONE: 'abcdefgh' }), [['lessons/a.html', 'SHORT_ONE']]);
});
