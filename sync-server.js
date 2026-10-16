// Sync server for Kites and Threads Workflow. Run on one computer: node sync-server.js
// Other devices on the same wifi open the printed address and use Pull and Push.
// No dependencies. Anyone who can reach the port can read and change the data, so only
// run it on a network you trust.
//
// Hosting it on the internet: set an access token, either as the environment variable
// SYNC_TOKEN or as an argument, for example: node sync-server.js --token=my-secret
// Every device then sends that token on GET /api/state and PUT /api/state. Without a
// token the server behaves exactly as it does on a local network, with no token required.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const W = require('./workflow.js');

const envPort = process.env.PORT;
const envPortNumber = Number(envPort);
// PORT defaults to 8787. PORT=0 lets the operating system pick a free port.
const PORT = envPort === undefined || envPort === '' || !Number.isFinite(envPortNumber) || envPortNumber < 0
  ? 8787
  : envPortNumber;
const DIR = __dirname;
// The data file can be moved with SYNC_DATA_FILE, which the tests use so a test run
// can never touch the real device copy.
const DATA_FILE = process.env.SYNC_DATA_FILE
  ? path.resolve(process.env.SYNC_DATA_FILE)
  : path.join(DIR, 'sync-data.json');
const MAX_BODY = 5 * 1024 * 1024;
const VERSION = 1;

// The access token is optional. An empty value means no token is required.
function readToken(argv) {
  const args = Array.isArray(argv) ? argv.slice(2) : [];
  for (let i = 0; i < args.length; i++) {
    const arg = String(args[i]);
    if (arg.startsWith('--token=')) return arg.slice('--token='.length).trim();
    if (arg === '--token') return String(args[i + 1] === undefined ? '' : args[i + 1]).trim();
  }
  return String(process.env.SYNC_TOKEN === undefined ? '' : process.env.SYNC_TOKEN).trim();
}

const TOKEN = readToken(process.argv);
const TOKEN_REQUIRED = TOKEN.length > 0;

// Only these paths are served, and never sync-data.json. Look the path up in a strict
// whitelist instead of joining the raw URL to disk, so no request can escape the folder.
const CACHE = { 'Cache-Control': 'no-store' };
const STATIC_EXACT = Object.assign(Object.create(null), {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/workflow.js': ['workflow.js', 'text/javascript; charset=utf-8'],
  '/invoice.js': ['invoice.js', 'text/javascript; charset=utf-8'],
  '/pwa.js': ['pwa.js', 'text/javascript; charset=utf-8'],
  '/sw.js': ['sw.js', 'text/javascript; charset=utf-8'],
  '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json; charset=utf-8'],
  '/logo-white.png': ['logo-white.png', 'image/png'],
  '/logo-black.png': ['logo-black.png', 'image/png'],
});
const ICON_PATH = /^\/icons\/([A-Za-z0-9_-]+)\.png$/;
const SAFE_NAME = /^[A-Za-z0-9_-]+$/;

function staticEntry(pathname) {
  // Reject anything that could be used to walk out of the folder or decode into a path.
  if (pathname.includes('%') || pathname.includes('\\') || pathname.includes('..')) return null;
  if (Object.prototype.hasOwnProperty.call(STATIC_EXACT, pathname)) return STATIC_EXACT[pathname];
  const match = ICON_PATH.exec(pathname);
  if (match && SAFE_NAME.test(match[1]) && path.basename(match[1]) === match[1]) {
    return [path.join('icons', match[1] + '.png'), 'image/png'];
  }
  return null;
}

function send(res, code, type, body, extraHeaders) {
  const headers = Object.assign({ 'Content-Type': type }, CACHE, extraHeaders || {});
  res.writeHead(code, headers);
  res.end(body);
}

function sendJson(res, code, payload) {
  send(res, code, 'application/json; charset=utf-8', JSON.stringify(payload));
}

// A 204 preflight is the only response that reflects the request Origin.
function sendPreflight(res, origin) {
  const headers = {
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  res.writeHead(204, headers);
  res.end();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Payload too large'), { code: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function saveAtomic(text) {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, DATA_FILE);
}

// Hash both sides first so the buffers always have the same length, then compare in
// constant time, so neither the token nor its length leaks through timing.
function constantTimeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a), 'utf8').digest();
  const hb = crypto.createHash('sha256').update(String(b), 'utf8').digest();
  return crypto.timingSafeEqual(ha, hb);
}

function presentedToken(req, url) {
  const auth = req.headers.authorization;
  if (typeof auth === 'string') {
    const match = /^Bearer\s+(\S+)/i.exec(auth.trim());
    if (match) return match[1];
  }
  const query = url.searchParams.get('token');
  return query === null ? '' : query.trim();
}

function authorized(req, url) {
  if (!TOKEN_REQUIRED) return true;
  const presented = presentedToken(req, url);
  if (!presented) return false;
  return constantTimeEqual(presented, TOKEN);
}

function healthPayload() {
  let hasData = false;
  let dataBytes = 0;
  try {
    dataBytes = fs.statSync(DATA_FILE).size;
    hasData = true;
  } catch (e) {
    dataBytes = 0;
  }
  return {
    ok: true,
    version: VERSION,
    hasData,
    dataBytes,
    uptimeSeconds: Math.round(process.uptime()),
  };
}

function rejectMessage(error) {
  const text = String(error && error.message ? error.message : 'Bad request');
  return 'Rejected: ' + text.split('"').join("'");
}

async function handleApiState(req, res, url) {
  // Resolve the method first, so an unsupported method is a 405 whether or not a token is set.
  if (req.method !== 'GET' && req.method !== 'PUT') {
    return send(res, 405, 'text/plain', 'Method not allowed');
  }
  // The token is checked before anything touches the data file, and a wrong token is never a 400.
  if (!authorized(req, url)) {
    return send(res, 401, 'text/plain', 'Unauthorized: this server requires a valid token');
  }

  if (req.method === 'GET') {
    if (!fs.existsSync(DATA_FILE)) return send(res, 404, 'text/plain', 'No data on the server yet.');
    try {
      return send(res, 200, 'application/json; charset=utf-8', fs.readFileSync(DATA_FILE, 'utf8'));
    } catch (e) {
      return send(res, 500, 'text/plain', 'Could not read the data file');
    }
  }

  if (req.method === 'PUT') {
    try {
      const text = await readBody(req);
      const data = W.importData(text); // throws on anything that is not a valid backup
      saveAtomic(W.exportData(data));
      return sendJson(res, 200, { ok: true });
    } catch (e) {
      return send(res, e.code === 413 ? 413 : 400, 'text/plain', rejectMessage(e));
    }
  }

  return send(res, 405, 'text/plain', 'Method not allowed');
}

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch (e) {
    return send(res, 400, 'text/plain', 'Bad request');
  }
  const pathname = url.pathname;

  if (pathname === '/api/state' || pathname === '/api/health') {
    if (req.method === 'OPTIONS') return sendPreflight(res, req.headers.origin);
    if (pathname === '/api/health') {
      if (req.method !== 'GET') return send(res, 405, 'text/plain', 'Method not allowed');
      return sendJson(res, 200, healthPayload());
    }
    return handleApiState(req, res, url);
  }

  const entry = staticEntry(pathname);
  if (!entry) return send(res, 404, 'text/plain', 'Not found');
  if (req.method !== 'GET') return send(res, 405, 'text/plain', 'Method not allowed');
  let body;
  try {
    body = fs.readFileSync(path.join(DIR, entry[0]));
  } catch (e) {
    return send(res, 404, 'text/plain', 'Not found');
  }
  return send(res, 200, entry[1], body);
});

function listen(port, callback) {
  return server.listen(port === undefined ? PORT : port, '0.0.0.0', callback);
}

function printStartup() {
  const bound = server.address();
  const port = bound && typeof bound === 'object' ? bound.port : PORT;
  const lines = [
    'Kites and Threads sync server listening on port ' + port,
    '  this computer: http://localhost:' + port,
  ];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family === 'IPv4' && !i.internal) lines.push('  other devices: http://' + i.address + ':' + port);
    }
  }
  lines.push('  token required: ' + (TOKEN_REQUIRED ? 'yes' : 'no'));
  lines.push('  anyone who can reach this port and knows the token can read and change the data, so only expose it on a network you trust');
  console.log(lines.join('\n'));
}

if (require.main === module) listen(PORT, printStartup);

module.exports = {
  server,
  listen,
  printStartup,
  options: { port: PORT, token: TOKEN, tokenRequired: TOKEN_REQUIRED, dataFile: DATA_FILE },
};
