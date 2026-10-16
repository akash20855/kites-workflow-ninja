// The studio's quote and invoice document. Pure: no DOM, no dependencies, works in the
// browser and in Node so the layout can be tested. The layout and wording follow the
// PDF the studio already sends clients: logo and details boxes on the first page, the
// package details on the second, the charge and add-ons on the third.
(function (root) {
  'use strict';

  const W = typeof module !== 'undefined' && module.exports ? require('./workflow.js') : root.KitesThreadsWorkflow;

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const DEFAULT_STUDIO = Object.freeze({
    name: 'Kites & Threads',
    address: 'Thrissur, Kerala 680011 India',
    phone: '+91 81378 89994',
    email: 'kitesandthreads@gmail.com',
  });

  const DEFAULT_LETTER = Object.freeze([
    'Thank you for connecting with Kites & Threads! We are excited about the opportunity to be part of your special day. We are pleased to confirm our availability for the dates you mentioned and have carefully curated a package that is thoughtfully tailored to your requirements. The details below provide a clear overview of the costs and services included.',
    'Please take a look and let us know your thoughts. We are happy to discuss any ideas or customizations that would make your celebration unique. We look forward to creating something beautiful together!',
  ]);

  const DEFAULT_CREW = Object.freeze([
    'No. of Photographers: 2 (one camera covers the whole function from the beginning, plus one for candid)',
    'No. of Cinematographers: 2 (one camera covers the entire function from the beginning, plus one for Candid )',
  ]);

  const DEFAULT_PHOTO = Object.freeze([
    'Signature Online Gallery',
    '- Edited photos of all events provided in a password-protected link with one year validity',
    'One 50-leaf (100-page) Printed Album, which can accommodate 200 photos printed in a Silky Matte Finish',
  ]);

  const DEFAULT_FILM = Object.freeze([
    '2 Teaser Video: 45-90 seconds (Duration will be Depending on the content)',
    '1 Highlight Video: 3-6 mins (Duration will be Depending on the content)',
    '2 Full video : (Duration will be Depending on the content)',
  ]);

  const DEFAULT_ADDONS = Object.freeze([
    'We are Charging Rs. 20,000 for a 70-leaf (140-page) Printed Album, which can accommodate 280 photos printed in a Silky Matte Finish',
    'We will impose an additional fee of Rs. 800 for each extra leaf.',
    'An additional Rs. 25000 is charged for Live Coverage (for 6 hours)',
    'An additional Rs. 15,000 is charged for Drone Coverage',
    'Upon completion of the project, we provide you with all Raw photos, but we do not offer Raw videos. Clients must provide us with 1TB Solid state drive on the day of event.',
    'There will be a courier charge for the album delivery.',
    'Accommodation must be provided by your side if required.',
  ]);

  function defaultSettings() {
    return {
      studio: Object.assign({}, DEFAULT_STUDIO),
      letter: DEFAULT_LETTER.slice(),
      crew: DEFAULT_CREW.slice(),
      photo: DEFAULT_PHOTO.slice(),
      film: DEFAULT_FILM.slice(),
      addOns: DEFAULT_ADDONS.slice(),
      packageTitle: 'Below mentioned are our Package Details:',
      chargeLabel: 'We are charging Rs:',
      chargeSuffix: '/- for the above package',
      addOnTitle: 'ADD-ON\u2019s',
      thanks: 'Thank You',
      kind: 'quote',
    };
  }

  // ------------------------------------------------------------ formatting

  function ordinalSuffix(n) {
    const value = Math.abs(Math.trunc(Number(n) || 0));
    const lastTwo = value % 100;
    if (lastTwo >= 11 && lastTwo <= 13) return 'th';
    const last = value % 10;
    if (last === 1) return 'st';
    if (last === 2) return 'nd';
    if (last === 3) return 'rd';
    return 'th';
  }

  // 24 Feb 2027 becomes 24th Feb 2027, the way the studio writes dates on quotes.
  function formatDate(value) {
    if (!value) return '';
    const d = value instanceof Date ? value : new Date(value);
    if (isNaN(d.getTime())) return '';
    const day = d.getDate();
    return day + ordinalSuffix(day) + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  }

  // Rupees without the symbol, grouped the Indian way: 240000 becomes 2,40,000.
  function formatAmount(amount) {
    const n = Number(amount) || 0;
    const cents = Math.round(Math.abs(n) * 100);
    const whole = Math.floor(cents / 100);
    const paise = cents % 100;
    let digits = W.groupDigits(String(whole), true);
    if (paise > 0) digits += '.' + String(paise).padStart(2, '0');
    return (n < 0 ? '-' : '') + digits;
  }

  function linesToList(text) {
    if (Array.isArray(text)) return text.slice();
    return String(text === undefined || text === null ? '' : text)
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  function listToLines(list) {
    return (list || []).join('\n');
  }

  // ------------------------------------------------------------ document data

  // A document is created with the studio's standard wording already filled in, so the
  // only work left per client is the dates, the place and the charge.
  function defaultDoc(rec, settings, now) {
    const s = settings || defaultSettings();
    const today = now ? new Date(now) : new Date();
    const events = [{ name: 'Reception', date: '' }, { name: 'Wedding', date: '' }];
    if (rec && rec.shootDate) events[1].date = new Date(rec.shootDate).toISOString();
    const charge = rec ? W.jobValue(rec) : 0;
    return {
      kind: s.kind || 'quote',
      issueDate: today.toISOString(),
      location: '',
      events,
      crew: s.crew.slice(),
      photo: s.photo.slice(),
      film: s.film.slice(),
      addOns: s.addOns.slice(),
      letter: s.letter.slice(),
      packageTitle: s.packageTitle,
      chargeLabel: s.chargeLabel,
      chargeSuffix: s.chargeSuffix,
      addOnTitle: s.addOnTitle,
      thanks: s.thanks,
      charge,
      notes: rec ? rec.notes || '' : '',
    };
  }

  // Fill in anything missing, so a document saved by an older version still renders.
  function normaliseDoc(doc, settings) {
    // Copy the defaults rather than merging into them, so the fallback below still has
    // the default events to fall back to.
    const base = defaultDoc(null, settings);
    const out = Object.assign({}, base, doc || {});
    out.events = Array.isArray(out.events) && out.events.length
      ? out.events.map((e) => ({ name: e.name || '', date: e.date || '' }))
      : base.events.map((e) => ({ name: e.name, date: e.date }));
    out.kind = out.kind === 'invoice' ? 'invoice' : 'quote';
    out.charge = Number(out.charge) || 0;
    return out;
  }

  const esc = (s) => String(s === undefined || s === null ? '' : s)
    .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // 24th Feb 2027, with the ordinal raised the way the original document shows it.
  function dateHtml(value) {
    if (!value) return '';
    const d = value instanceof Date ? value : new Date(value);
    if (isNaN(d.getTime())) return '';
    return d.getDate() + '<sup>' + ordinalSuffix(d.getDate()) + '</sup> ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  }

  function bulletList(items, subPrefix) {
    return (items || []).map((raw) => {
      const text = String(raw);
      const isSub = subPrefix && text.startsWith('-');
      const body = isSub ? text.slice(1).trim() : text;
      return '<p class="' + (isSub ? 'sub' : 'item') + '"><span class="o">o</span>' + esc(body) + '</p>';
    }).join('');
  }

  // ------------------------------------------------------------ rendering

  // Returns the whole document as one HTML string: three pages, ready to print or to
  // save as a PDF. logoHref can be a data URI, which is what the single file build uses.
  function docHtml(doc, settings, options) {
    const opts = options || {};
    const s = settings || defaultSettings();
    const d = normaliseDoc(doc, s);
    const logo = opts.logoHref || 'logo-black.png';
    const studio = s.studio || DEFAULT_STUDIO;
    const client = opts.client || { name: '', email: '', phone: '' };
    const title = d.kind === 'invoice' ? 'Invoice' : 'Quote';

    const pages = [];

    // Page 1: the logo and the three details boxes, then the covering letter.
    const eventLines = d.events
      .filter((e) => e.name || e.date)
      .map((e) => '<p class="ind">' + esc(e.name) + ' : ' + dateHtml(e.date) + '</p>').join('');

    pages.push(
      '<section class="page">' +
        '<div class="head">' +
          '<img class="logo" src="' + esc(logo) + '" alt="Kites & Threads">' +
          '<div class="col">' +
            '<div class="box"><h3>Details</h3><div class="body">' +
              '<p><b>' + esc(title) + ' For:</b> ' + esc(client.name || opts.quoteFor || '') + '</p>' +
              '<p><b>Location:</b> ' + esc(d.location) + '</p>' +
              '<p><b>Events:</b></p>' + eventLines +
              '<p class="dot">\u2022</p>' +
              '<p><b>Issue Date: ' + dateHtml(d.issueDate) + '</b></p>' +
            '</div></div>' +
            '<div class="box"><h3>Client Details</h3><div class="body">' +
              '<p><b>Name:</b> ' + esc(client.name || '') + '</p>' +
              '<p><b>Phone No:</b> ' + esc(client.phone || '') + '</p>' +
              '<p><b>Email Id:</b> ' + esc(client.email || '') + '</p>' +
            '</div></div>' +
            '<div class="box"><h3>From:</h3><div class="body">' +
              '<p><b>' + esc(studio.name) + '</b></p>' +
              '<p><b>' + esc(studio.address) + '</b></p>' +
              '<p><b>Phone no: ' + esc(studio.phone) + '</b></p>' +
              '<p><b>Email :' + esc(studio.email) + '</b></p>' +
            '</div></div>' +
          '</div>' +
        '</div>' +
        '<div class="letter"><p>Hi there,</p>' +
          d.letter.map((p) => '<p>' + esc(p) + '</p>').join('') +
        '</div>' +
      '</section>'
    );

    // Page 2: the package, repeated for each event, then what the studio delivers.
    const packages = d.events.filter((e) => e.name || e.date).map((e) =>
      '<div class="event">' +
        '<p><b>Event:</b> ' + esc(e.name) + '</p>' +
        '<p><b>Date:</b> ' + dateHtml(e.date) + '</p>' +
        '<p><b>Location:</b> ' + esc(d.location) + '</p>' +
        '<p><b>Crew Details:</b></p>' + bulletList(d.crew, true) +
      '</div>').join('');

    pages.push(
      '<section class="page">' +
        '<h3 class="packageTitle">' + esc(d.packageTitle) + '</h3>' +
        packages +
        '<p class="sectionTitle">Photo Output:</p>' + bulletList(d.photo, true) +
        '<p class="sectionTitle">Film Output:</p>' + bulletList(d.film, true) +
      '</section>'
    );

    // Page 3: what it costs, what can be added, and the sign off.
    pages.push(
      '<section class="page">' +
        '<p class="charge">' + esc(d.chargeLabel) + ' ' + esc(formatAmount(d.charge)) + esc(d.chargeSuffix) + '</p>' +
        '<h3 class="addonTitle">' + esc(d.addOnTitle) + '</h3>' +
        (d.addOns || []).map((a) => '<p class="bullet">\u2022 ' + esc(a) + '</p>').join('') +
        '<p class="thanks">' + esc(d.thanks) + '</p>' +
      '</section>'
    );

    return '<div class="doc">' + pages.join('') + '</div>';
  }

  // The same document as plain text, for pasting into WhatsApp or an email.
  function docText(doc, settings, options) {
    const opts = options || {};
    const s = settings || defaultSettings();
    const d = normaliseDoc(doc, s);
    const studio = s.studio || DEFAULT_STUDIO;
    const client = opts.client || { name: '', email: '', phone: '' };
    const out = [];
    out.push((d.kind === 'invoice' ? 'INVOICE' : 'QUOTE') + ' - ' + studio.name);
    out.push('');
    out.push((d.kind === 'invoice' ? 'Invoice' : 'Quote') + ' For: ' + (client.name || ''));
    out.push('Location: ' + (d.location || ''));
    d.events.filter((e) => e.name || e.date).forEach((e) => out.push('  ' + e.name + ' : ' + formatDate(e.date)));
    out.push('Issue Date: ' + formatDate(d.issueDate));
    out.push('');
    out.push('Client Details');
    out.push('  Name: ' + (client.name || ''));
    out.push('  Phone No: ' + (client.phone || ''));
    out.push('  Email Id: ' + (client.email || ''));
    out.push('');
    out.push('From:');
    out.push('  ' + studio.name);
    out.push('  ' + studio.address);
    out.push('  Phone no: ' + studio.phone);
    out.push('  Email: ' + studio.email);
    out.push('');
    out.push('Hi there,');
    d.letter.forEach((p) => { out.push(p); out.push(''); });
    out.push(d.packageTitle);
    d.events.filter((e) => e.name || e.date).forEach((e) => {
      out.push('');
      out.push('Event: ' + e.name);
      out.push('Date: ' + formatDate(e.date));
      out.push('Location: ' + (d.location || ''));
      out.push('Crew Details:');
      (d.crew || []).forEach((c) => out.push('  o ' + String(c).replace(/^-/, '').trim()));
    });
    out.push('');
    out.push('Photo Output:');
    (d.photo || []).forEach((p) => out.push('  o ' + String(p).replace(/^-/, '').trim()));
    out.push('Film Output:');
    (d.film || []).forEach((p) => out.push('  o ' + String(p).replace(/^-/, '').trim()));
    out.push('');
    out.push(d.chargeLabel + ' ' + formatAmount(d.charge) + d.chargeSuffix);
    out.push('');
    out.push(d.addOnTitle);
    (d.addOns || []).forEach((a) => out.push('  ' + a));
    out.push('');
    out.push(d.thanks);
    return out.join('\n');
  }

  // The stylesheet for the document, kept next to the markup that uses it.
  const DOC_CSS = [
    '.doc { background: #e9e9ee; padding: 14px; }',
    '.doc .page { width: 210mm; min-height: 297mm; box-sizing: border-box; background: #fff;',
    '  margin: 0 auto 14px; padding: 18mm 25mm; box-shadow: 0 1px 4px rgba(0,0,0,.18);',
    '  font: 11pt/1.5 "Book Antiqua", Palatino, "Palatino Linotype", Georgia, "Times New Roman", serif; color: #000; }',
    // The app styles h3 as a small grey label. The document needs plain black headings.
    '.doc h3 { text-transform: none; letter-spacing: normal; color: #000; }',
    '.doc .head { height: 548pt; }',
    '.doc .logo { width: 60mm; height: auto; }',
    '.doc .col { float: right; width: 85mm; }',
    '.doc .box { border: 1px solid #cfcfcf; margin-bottom: 10pt; }',
    '.doc .box h3 { margin: 0; padding: 7pt 10pt; background: #ececec; border-bottom: 1px solid #cfcfcf;',
    '  font-size: 14pt; font-weight: bold; }',
    '.doc .box .body { padding: 8pt 10pt 10pt; }',
    '.doc .box p { margin: 0 0 3pt; }',
    '.doc .ind { margin-left: 58pt !important; }',
    '.doc .dot { margin-left: 18pt !important; margin-top: 26pt !important; }',
    '.doc .letter p { margin: 0 0 12pt; }',
    '.doc .letter { clear: both; padding-top: 0; }',
    '.doc h3.packageTitle { font-size: 12pt; text-decoration: underline; margin: 0 0 22pt; }',
    '.doc .event { margin-bottom: 26pt; }',
    '.doc .event p { margin: 0 0 4pt; }',
    '.doc .sectionTitle { margin: 20pt 0 6pt; font-weight: bold; }',
    '.doc .item, .doc .sub { margin: 0 0 4pt; padding-left: 20pt; text-indent: -12pt; }',
    '.doc .sub { margin-left: 18pt; }',
    '.doc .item .o, .doc .sub .o { display: inline-block; width: 12pt; }',
    '.doc .charge { margin-top: 107pt; text-align: center; font-weight: bold; }',
    '.doc h3.addonTitle { text-align: center; margin: 44pt 0 26pt; font-size: 12pt; }',
    '.doc .bullet { margin: 0 0 5pt; padding-left: 18pt; text-indent: -18pt; }',
    '.doc .thanks { margin-top: 100pt; text-align: center; font-weight: bold; }',
    // These print rules live here, after the screen rules above, so they win by both
    // order and specificity. The page itself supplies the margins, so the printed
    // sheets must carry no padding and no fixed A4 height, or every page would spill
    // onto a second sheet.
    '@media print {',
    '  #docOverlay .doc { background: #fff; padding: 0; }',
    '  #docOverlay .doc .page { width: auto; min-height: 0; margin: 0; padding: 0; box-shadow: none; }',
    '  #docOverlay .doc .page + .page { break-before: page; }',
    '}',
  ].join('\n');

  const api = {
    MONTHS, DEFAULT_STUDIO, DEFAULT_LETTER, DEFAULT_CREW, DEFAULT_PHOTO, DEFAULT_FILM, DEFAULT_ADDONS,
    defaultSettings, ordinalSuffix, formatDate, formatAmount, linesToList, listToLines,
    defaultDoc, normaliseDoc, docHtml, docText, DOC_CSS, dateHtml,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KitesInvoice = api;
})(typeof window !== 'undefined' ? window : globalThis);
