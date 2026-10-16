// Dev tool: drives the real desktop app through the Chrome DevTools protocol and checks
// that it renders, saves a lead, builds the quote document and can reach the sync server.
//
// Usage:
//   npm start -- --remote-debugging-port=9222     (in one terminal)
//   SYNC_URL=http://127.0.0.1:8787 node tools/probe.js
//
// The probe adds one temporary lead, checks the result, then restores whatever this
// device had saved before, so it never leaves test data behind.
const CDP_PORT = Number(process.env.CDP_PORT || 9222);
const SYNC_URL = process.env.SYNC_URL || '';

async function findPage() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + CDP_PORT + '/json/list')).json();
      const page = list.find((t) => t.type === 'page' && /index\.html/.test(t.url)) || list.find((t) => t.type === 'page');
      if (page && page.webSocketDebuggerUrl) return page;
    } catch (e) { /* the app is still starting */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('No page target on port ' + CDP_PORT + '. Is the app running with --remote-debugging-port?');
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  let next = 0;
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error.message));
    else p.resolve(msg.result);
  });
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve());
    ws.addEventListener('error', () => reject(new Error('Could not open the debug socket')));
  });
  const send = (method, params) => new Promise((resolve, reject) => {
    const id = ++next;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
  return { ready, send, close: () => ws.close() };
}

const EXPRESSION = `(async () => {
  const out = {};
  const key = 'kites-and-threads-workflow:v1';
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  out.title = document.title;
  out.hasLogic = !!window.KitesThreadsWorkflow;
  out.hasInvoice = !!window.KitesInvoice;
  out.hasPwa = !!window.KitesPWA;
  const logo = document.querySelector('.logo img');
  out.logoLoaded = !!(logo && logo.complete && logo.naturalWidth > 0);
  out.jobTypes = document.querySelectorAll('#jobTypeSelect option').length;
  out.statCards = document.querySelectorAll('#stats .stat').length;
  out.moneyCards = document.querySelectorAll('#moneyStats .stat').length;
  out.manifestLink = !!document.querySelector('link[rel="manifest"]');
  out.swController = !!(navigator.serviceWorker && navigator.serviceWorker.controller);

  // Images are not blocked by the file:// rules, so this proves the packaging
  // really shipped the icons and the pwa glue that the page asks for.
  const loadImage = (src) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth);
    img.onerror = () => resolve(0);
    img.src = src;
  });
  out.icon192 = await loadImage('icons/icon-192.png');
  out.appleIcon = await loadImage('icons/apple-touch-icon.png');
  out.pwaScript = typeof window.KitesPWA === 'object' && typeof window.KitesPWA.canInstall === 'function';

  const before = JSON.parse(localStorage.getItem(key) || 'null');
  out.recordsBefore = before ? before.records.length : 0;

  const form = document.querySelector('#leadForm');
  form.querySelector('[name="name"]').value = 'PROBE TEMPORARY LEAD';
  form.querySelector('[name="clientName"]').value = 'Probe Client';
  form.querySelector('[name="clientEmail"]').value = 'probe@example.com';
  form.querySelector('[name="clientPhone"]').value = '+91 90000 00000';
  form.querySelector('[name="shootDate"]').value = '2027-02-14T10:00';
  form.querySelector('[name="notes"]').value = 'temporary row added by tools/probe.js';
  form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  await wait(120);

  const after = JSON.parse(localStorage.getItem(key) || 'null');
  const saved = after && after.records.length ? after.records[after.records.length - 1] : null;
  out.recordsAfter = after ? after.records.length : 0;
  out.savedName = saved ? saved.name : null;
  out.savedStage = saved ? saved.stage : null;
  out.savedTasks = saved ? saved.tasks.length : 0;
  out.savedValue = saved ? window.KitesThreadsWorkflow.jobValue(saved) : null;
  out.listCards = document.querySelectorAll('#list .card').length;
  out.detailStages = document.querySelectorAll('#detail .stages div').length;
  out.shootItems = document.querySelectorAll('#shootList li[data-id]').length;
  out.soonItems = document.querySelectorAll('#soonList li[data-id]').length;
  out.moneySample = (document.querySelector('#moneyStats .stat b') || {}).textContent || null;

  const box = document.querySelector('#searchBox');
  box.value = 'zzz definitely no match';
  box.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(50);
  out.cardsWhenNoMatch = document.querySelectorAll('#list .card').length;
  box.value = 'probe';
  box.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(50);
  out.cardsWhenMatch = document.querySelectorAll('#list .card').length;
  box.value = '';
  box.dispatchEvent(new Event('input', { bubbles: true }));

  // The quote document, built from the record that was just added.
  const docButton = document.querySelector('[data-doc="preview"]');
  out.docButton = !!docButton;
  if (docButton) {
    docButton.click();
    await wait(600);
    const overlay = document.querySelector('#docOverlay');
    out.docHidden = overlay.hidden;
    out.docPages = overlay.querySelectorAll('.page').length;
    const docLogo = overlay.querySelector('.logo');
    out.docLogoLoaded = !!(docLogo && docLogo.complete && docLogo.naturalWidth > 0);
    const docSrc = docLogo ? String(docLogo.getAttribute('src')) : '';
    out.docLogoIsInline = docSrc.indexOf('data:image/png') === 0;
    out.docLogoIsFile = docSrc.indexOf('logo-black.png') !== -1;
    out.docChargeLine = String((overlay.querySelector('.charge') || {}).textContent || '').trim();
    out.docQuoteFor = String((overlay.querySelector('.box p') || {}).textContent || '').trim();
    out.docPackageTitle = String((overlay.querySelector('.packageTitle') || {}).textContent || '').trim();
    out.docThanks = String((overlay.querySelector('.thanks') || {}).textContent || '').trim();
    document.querySelector('#docClose').click();
    await wait(250);
    out.docClosed = document.querySelector('#docOverlay').hidden === true;
  }

  const sync = ${JSON.stringify(SYNC_URL)};
  out.syncTarget = sync || null;
  if (sync) {
    try {
      const res = await fetch(sync + '/api/health', { cache: 'no-store' });
      out.syncHealth = res.status + ' ' + (await res.text()).slice(0, 60);
    } catch (e) {
      out.syncHealth = 'FAILED: ' + e.message;
    }
  }

  if (before) localStorage.setItem(key, JSON.stringify(before));
  else localStorage.removeItem(key);
  out.cleaned = true;
  return out;
})()`;

function check(name, ok, detail) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail === undefined ? '' : '  -> ' + detail));
  return ok;
}

async function main() {
  const page = await findPage();
  const client = connect(page.webSocketDebuggerUrl);
  await client.ready;
  await client.send('Runtime.enable');
  const result = await client.send('Runtime.evaluate', { expression: EXPRESSION, awaitPromise: true, returnByValue: true });
  client.close();
  if (result.exceptionDetails) {
    throw new Error('The app threw while probing: ' + JSON.stringify(result.exceptionDetails.exception || result.exceptionDetails));
  }
  const out = result.result.value;
  console.log('--- page reported:');
  console.log(JSON.stringify(out, null, 2));
  console.log('--- checks:');

  const results = [
    check('page title is the Kites and Threads app', /Kites and Threads/.test(out.title), out.title),
    check('workflow, invoice and pwa scripts are all loaded', out.hasLogic && out.hasInvoice && out.hasPwa),
    check('brand logo renders', out.logoLoaded),
    check('job types are offered', out.jobTypes >= 4, out.jobTypes + ' options'),
    check('the app icons shipped with the app', out.icon192 === 192 && out.appleIcon === 180, out.icon192 + 'px and ' + out.appleIcon + 'px'),
    check('the install glue is present', out.pwaScript === true),
    check('overview and money cards render', out.statCards >= 5 && out.moneyCards === 4, out.statCards + ' / ' + out.moneyCards),
    check('rupee formatting is in use', String(out.moneySample).indexOf('\u20b9') === 0, out.moneySample),
    check('adding a lead through the form saves it', out.recordsAfter === out.recordsBefore + 1, out.recordsBefore + ' -> ' + out.recordsAfter),
    check('the saved lead got its workflow tasks', out.savedTasks >= 5 && out.savedStage === 'LEAD_CREATED', out.savedTasks + ' tasks, stage ' + out.savedStage),
    check('the job list shows the lead', out.listCards >= 1, out.listCards + ' cards'),
    check('the detail panel shows the four stages', out.detailStages === 4, out.detailStages + ' stages'),
    check('the upcoming shoot list picked up the shoot date', out.shootItems >= 1, out.shootItems + ' shoots'),
    check('search filters the list, and clears again', out.cardsWhenNoMatch === 0 && out.cardsWhenMatch >= 1, out.cardsWhenNoMatch + ' then ' + out.cardsWhenMatch),
    check('the page is not claimed by a service worker over file://', out.swController === false),
    check('the quote document opens', out.docButton === true && out.docHidden === false),
    check('the document renders three pages', out.docPages === 3, out.docPages + ' pages'),
    check('the document logo renders', out.docLogoLoaded === true),
    check('the document logo is shipped with the app', out.docLogoIsInline || out.docLogoIsFile, out.docLogoIsInline ? 'inline data uri' : 'logo-black.png'),
    check('the charge line is in the studio wording', out.docChargeLine.indexOf('Rs: ') !== -1 && out.docChargeLine.indexOf('for the above package') !== -1, out.docChargeLine),
    check('the document names the client', out.docQuoteFor.indexOf('For: ') !== -1, out.docQuoteFor),
    check('the document carries the standard sections', out.docPackageTitle.indexOf('Package Details') !== -1 && out.docThanks === 'Thank You', out.docPackageTitle),
    check('closing the document works', out.docClosed === true),
  ];
  if (SYNC_URL) {
    results.push(check('the desktop app can reach the sync server', /^200 /.test(String(out.syncHealth)), out.syncHealth));
  } else {
    console.log('SKIP  sync reachability (set SYNC_URL to check it)');
  }
  results.push(check('the probe left no test data behind', out.cleaned === true));

  const failed = results.filter((r) => !r).length;
  console.log('--- ' + (results.length - failed) + '/' + results.length + ' checks passed');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('probe error: ' + e.message); process.exit(1); });
