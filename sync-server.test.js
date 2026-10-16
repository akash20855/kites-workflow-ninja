// Tests for the Kites and Threads sync server. Run with: node --test sync-server.test.js
//
// The suite points the server at a throwaway data file in the system temp folder, so a
// test run can never read or overwrite the real sync-data.json on this device.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const unique = (label) => path.join(os.tmpdir(), 'kt-sync-test-' + label + '-' + process.pid + '-' + Date.now() + '.json');
const DATA_FILE = unique('main');
const TOKEN_DATA_FILE = unique('token');

// The server reads these once, when it is required, so they must be set first.
process.env.SYNC_DATA_FILE = DATA_FILE;
delete process.env.SYNC_TOKEN;

const S = require('./sync-server.js');
const W = require('./workflow.js');

const MAX_BODY = 5 * 1024 * 1024;
let BASE = '';
let child = null;

function removeDataFile(file) {
  for (const candidate of [file, file + '.tmp']) {
    try { fs.unlinkSync(candidate); } catch (e) { /* not there, nothing to do */ }
  }
}

// A valid backup body, built with the real workflow module so it is exactly what a
// device would push.
function backupJson(name) {
  const jobType = W.makeJobType('Test Wedding', '#e11d48', [
    W.makeTemplateTask('Send questionnaire', 'email', 'LEAD_CREATED', 2, { autoSend: true, emailTemplate: 'questionnaire' }),
    W.makeTemplateTask('Edit photos', 'todo', 'MAIN_SHOOT', 14),
  ]);
  const record = W.createRecord({
    name,
    clientEmail: 'couple@example.com',
    shootDate: '2026-11-20T09:00:00.000Z',
  }, jobType, '2026-10-01T10:00:00.000Z');
  return W.exportData({ jobTypes: [jobType], records: [record] });
}

async function call(pathname, options) {
  const res = await fetch(BASE + pathname, options);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* not every reply is JSON */ }
  return {
    status: res.status,
    type: res.headers.get('content-type') || '',
    cache: res.headers.get('cache-control') || '',
    allowOrigin: res.headers.get('access-control-allow-origin') || '',
    allowMethods: res.headers.get('access-control-allow-methods') || '',
    text,
    json,
  };
}

function putState(body) {
  return call('/api/state', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
}

before(async () => {
  removeDataFile(DATA_FILE);
  removeDataFile(TOKEN_DATA_FILE);
  await new Promise((resolve, reject) => {
    S.listen(0, resolve).once('error', reject);
  });
  const address = S.server.address();
  assert.ok(address && typeof address === 'object' && address.port > 0, 'the server should listen on a real port');
  BASE = 'http://127.0.0.1:' + address.port;
});

after(async () => {
  if (child) {
    child.kill('SIGKILL');
    child = null;
  }
  await new Promise((resolve) => {
    // Keep-alive sockets would otherwise hold the test process open.
    if (typeof S.server.closeAllConnections === 'function') S.server.closeAllConnections();
    S.server.close(() => resolve());
  });
  removeDataFile(DATA_FILE);
  removeDataFile(TOKEN_DATA_FILE);
});

test('health reports an empty server before anything is saved', async () => {
  const res = await call('/api/health');
  assert.equal(res.status, 200);
  assert.ok(res.type.includes('application/json'), 'health is JSON, got ' + res.type);
  assert.equal(res.json.ok, true);
  assert.equal(res.json.version, 1);
  assert.equal(res.json.hasData, false);
  assert.equal(typeof res.json.uptimeSeconds, 'number');
  assert.ok(res.json.uptimeSeconds >= 0);
});

test('a saved backup comes back exactly, and health then reports data', async () => {
  const empty = await call('/api/state');
  assert.equal(empty.status, 404, 'nothing saved yet is a 404');
  assert.ok(empty.text.length > 0, 'the 404 explains itself in the body');

  const saved = await putState(backupJson('Tanisha and Jerin'));
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.json, { ok: true });

  const read = await call('/api/state');
  assert.equal(read.status, 200);
  assert.ok(read.type.includes('application/json'));
  assert.equal(read.json.records[0].name, 'Tanisha and Jerin');
  assert.equal(read.json.jobTypes[0].name, 'Test Wedding');

  const health = await call('/api/health');
  assert.equal(health.json.hasData, true);
  assert.ok(health.json.dataBytes > 0, 'the data file has bytes in it now');
});

test('a body that is not a backup is rejected and does not damage the saved data', async () => {
  const rejected = await putState('{"foo":1}');
  assert.equal(rejected.status, 400);
  assert.ok(rejected.text.startsWith('Rejected: '), 'got ' + rejected.text);
  assert.ok(rejected.text.indexOf('"') === -1, 'the rejection message carries no double quotes: ' + rejected.text);

  const read = await call('/api/state');
  assert.equal(read.status, 200);
  assert.equal(read.json.records[0].name, 'Tanisha and Jerin', 'the good data is still there');
});

test('an oversized upload is refused instead of accepted or left hanging', async () => {
  const oversized = 'a'.repeat(MAX_BODY + 1024 * 1024);
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 15000);

  let status;
  let failure = null;
  try {
    const res = await fetch(BASE + '/api/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: oversized,
      signal: controller.signal,
    });
    status = res.status;
    await res.text();
  } catch (err) {
    failure = err;
  } finally {
    clearTimeout(timer);
  }

  assert.equal(timedOut, false, 'the server must not leave an oversized upload hanging');
  if (status !== undefined) {
    assert.equal(status, 413, 'when a response is delivered it must be 413');
  } else {
    // The server destroys the request socket as soon as it sees the body is too large,
    // so the client can see the connection reset instead of the 413 itself. Either way
    // the upload was refused, which is what this test is about.
    assert.ok(failure, 'the request must settle as either a 413 or a transport error');
    assert.notEqual(failure.name, 'AbortError');
  }

  const health = await call('/api/health');
  assert.equal(health.status, 200, 'the server is still serving after refusing the upload');
  const read = await call('/api/state');
  assert.equal(read.json.records[0].name, 'Tanisha and Jerin', 'the oversized upload changed nothing');
});

test('unsupported methods on the API are a 405, not a 404', async () => {
  const deleted = await call('/api/state', { method: 'DELETE' });
  assert.equal(deleted.status, 405);
  const patched = await call('/api/state', { method: 'PATCH' });
  assert.equal(patched.status, 405);
  const postedHealth = await call('/api/health', { method: 'POST' });
  assert.equal(postedHealth.status, 405);
});

test('the data file can never be fetched, by any spelling of the path', async () => {
  for (const target of ['/sync-data.json', '/../sync-data.json', '/icons/../sync-data.json', '/..%2Fsync-data.json', '/icons/%2e%2e/sync-data.json']) {
    const res = await call(target);
    assert.equal(res.status, 404, target + ' must not be served (got ' + res.status + ')');
    assert.ok(res.text.indexOf('records') === -1, target + ' must not leak any data');
  }
});

test('the whole app is served with the right content types and no caching', async () => {
  const expected = [
    ['/', 'text/html'],
    ['/index.html', 'text/html'],
    ['/workflow.js', 'javascript'],
    ['/pwa.js', 'javascript'],
    ['/sw.js', 'javascript'],
    ['/manifest.webmanifest', 'application/manifest+json'],
    ['/logo-white.png', 'image/png'],
    ['/icons/icon-192.png', 'image/png'],
    ['/icons/icon-maskable-512.png', 'image/png'],
  ];
  for (const [target, type] of expected) {
    const res = await call(target);
    assert.equal(res.status, 200, target + ' should be served');
    assert.ok(res.type.includes(type), target + ' should be ' + type + ', got ' + res.type);
    assert.equal(res.cache, 'no-store', target + ' must not be cached');
  }

  const page = await call('/index.html');
  assert.ok(page.text.includes('Kites and Threads'), 'the served page is the app');

  const missing = await call('/pages/nope.js');
  assert.equal(missing.status, 404);

  const posted = await call('/index.html', { method: 'POST' });
  assert.equal(posted.status, 405, 'a POST to a static file is a 405, not a 404');
});

test('the sync API answers preflights and does not hand out CORS headers to plain requests', async () => {
  const preflight = await call('/api/state', {
    method: 'OPTIONS',
    headers: { Origin: 'https://studio.example.com' },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.allowOrigin, 'https://studio.example.com', 'the preflight echoes the caller Origin');
  assert.ok(preflight.allowMethods.includes('GET'), 'Allow-Methods lists GET: ' + preflight.allowMethods);
  assert.ok(preflight.allowMethods.includes('PUT'), 'Allow-Methods lists PUT: ' + preflight.allowMethods);
  assert.ok(preflight.allowMethods.includes('OPTIONS'), 'Allow-Methods lists OPTIONS: ' + preflight.allowMethods);

  const plain = await call('/api/health');
  assert.equal(plain.allowOrigin, '', 'a plain request gets no Access-Control-Allow-Origin');
});

test('with a token set, the token is required and a wrong one never reveals data', async () => {
  const port = await startTokenServer();
  const base = 'http://127.0.0.1:' + port;
  const ask = async (pathname, options) => {
    const res = await fetch(base + pathname, options);
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) { /* not JSON */ }
    return { status: res.status, text, json };
  };

  const health = await ask('/api/health');
  assert.equal(health.status, 200, 'health needs no token');

  const noToken = await ask('/api/state');
  assert.equal(noToken.status, 401);

  const wrongToken = await ask('/api/state', { headers: { Authorization: 'Bearer not-the-token' } });
  assert.equal(wrongToken.status, 401);

  const withHeader = await ask('/api/state', { headers: { Authorization: 'Bearer test-secret-1234' } });
  assert.equal(withHeader.status, 404, 'the right token reaches the handler, which has no data yet');
  assert.ok(withHeader.text.includes('No data'), 'got ' + withHeader.text);

  const saved = await ask('/api/state?token=test-secret-1234', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: backupJson('Token device'),
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.json, { ok: true });

  const readBack = await ask('/api/state?token=test-secret-1234');
  assert.equal(readBack.status, 200);
  assert.equal(readBack.json.records[0].name, 'Token device');

  const badWrite = await ask('/api/state?token=wrong', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: backupJson('Should never be saved'),
  });
  assert.equal(badWrite.status, 401, 'a wrong token cannot write');
  const stillToken = await ask('/api/state?token=test-secret-1234');
  assert.equal(stillToken.json.records[0].name, 'Token device', 'the refused write changed nothing');
});

// The token is read once, when the module is loaded, so this needs its own process.
function startTokenServer() {
  const env = Object.assign({}, process.env, { PORT: '0', SYNC_DATA_FILE: TOKEN_DATA_FILE });
  delete env.SYNC_TOKEN;
  removeDataFile(TOKEN_DATA_FILE);

  child = spawn(process.execPath, [path.join(__dirname, 'sync-server.js'), '--token=test-secret-1234'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => {
      reject(new Error('the token server never printed its port. Output so far: ' + output));
    }, 10000);

    const onData = (chunk) => {
      output += String(chunk);
      const match = /listening on port (\d+)/.exec(output);
      if (!match) return;
      clearTimeout(timer);
      child.stdout.off('data', onData);
      resolve(Number(match[1]));
    };

    child.stdout.on('data', onData);
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error('the token server exited early with code ' + code + '. Output: ' + output));
    });
  });
}
