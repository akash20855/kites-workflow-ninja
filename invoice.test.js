const test = require('node:test');
const assert = require('node:assert/strict');
const INV = require('./invoice.js');
const W = require('./workflow.js');

const NOW = '2026-10-12T10:00:00.000Z';

// Dates in this file are built from local calendar parts (new Date(2027, 1, 24, 12))
// so an assertion can never shift by a day because of the machine's timezone.
const feb24 = () => new Date(2027, 1, 24, 12);
const feb25 = () => new Date(2027, 1, 25, 12);

function weddingType() {
  return W.makeJobType('Wedding Film & Photos', '#e11d48', [
    W.makeTemplateTask('Send questionnaire', 'email', 'LEAD_CREATED', 2, { autoSend: true }),
    W.makeTemplateTask('Edit & deliver photos', 'todo', 'MAIN_SHOOT', 14),
  ]);
}

function recordWithQuote(charge) {
  const rec = W.createRecord({
    name: 'Bharathisri',
    clientName: 'Bharathisri',
    clientEmail: 'kg.bharthisri@gmail.com',
    shootDate: '2027-02-25T09:00:00.000Z',
    notes: 'Yercaud',
  }, weddingType(), NOW);
  const quote = W.makeQuote(rec, 'fixed', [{ label: 'Wedding package', price: charge }], { depositPercent: 40 });
  W.acceptQuote(rec, quote.id, NOW);
  return rec;
}

const client = { name: 'Bharathisri', phone: '+91 9498868417', email: 'kg.bharthisri@gmail.com' };

// 1
test('ordinalSuffix raises the day the way the studio writes it', () => {
  assert.equal(INV.ordinalSuffix(1), 'st');
  assert.equal(INV.ordinalSuffix(2), 'nd');
  assert.equal(INV.ordinalSuffix(3), 'rd');
  assert.equal(INV.ordinalSuffix(4), 'th');
  assert.equal(INV.ordinalSuffix(11), 'th');
  assert.equal(INV.ordinalSuffix(12), 'th');
  assert.equal(INV.ordinalSuffix(13), 'th');
  assert.equal(INV.ordinalSuffix(21), 'st');
  assert.equal(INV.ordinalSuffix(22), 'nd');
  assert.equal(INV.ordinalSuffix(23), 'rd');
  assert.equal(INV.ordinalSuffix(24), 'th');
  assert.equal(INV.ordinalSuffix(101), 'st');
  assert.equal(INV.ordinalSuffix(111), 'th');
});

// 2
test('formatDate writes 24 Feb 2027 as 24th Feb 2027 and blanks unusable values', () => {
  assert.equal(INV.formatDate(feb24()), '24th Feb 2027');
  assert.equal(INV.formatDate(new Date(2027, 9, 12, 12)), '12th Oct 2027');
  assert.equal(INV.formatDate(new Date(2027, 0, 1, 12)), '1st Jan 2027');
  assert.equal(INV.formatDate(''), '');
  assert.equal(INV.formatDate(null), '');
  assert.equal(INV.formatDate(undefined), '');
  assert.equal(INV.formatDate('not a date at all'), '');
});

// 3
test('formatAmount groups the Indian way and drops the symbol', () => {
  assert.equal(INV.formatAmount(240000), '2,40,000');
  assert.equal(INV.formatAmount(20000), '20,000');
  assert.equal(INV.formatAmount(1234567), '12,34,567');
  assert.equal(INV.formatAmount(1500), '1,500');
  assert.equal(INV.formatAmount(0), '0');
  assert.equal(INV.formatAmount(1500.5), '1,500.50');
  assert.equal(INV.formatAmount('25000'), '25,000');
});

// 4
test('linesToList and listToLines move between text fields and lists', () => {
  assert.deepEqual(INV.linesToList('  one \n\n two \n'), ['one', 'two']);
  assert.deepEqual(INV.linesToList(''), []);
  assert.deepEqual(INV.linesToList(['already', 'a list']), ['already', 'a list']);
  assert.equal(INV.listToLines(['one', 'two']), 'one\ntwo');
  assert.equal(INV.listToLines(undefined), '');
  assert.deepEqual(INV.linesToList(INV.listToLines(['a', 'b'])), ['a', 'b']);
});

// 5
test('the standard settings carry the real studio details and wording', () => {
  const s = INV.defaultSettings();
  assert.equal(s.studio.name, 'Kites & Threads');
  assert.equal(s.studio.address, 'Thrissur, Kerala 680011 India');
  assert.equal(s.studio.phone, '+91 81378 89994');
  assert.equal(s.studio.email, 'kitesandthreads@gmail.com');
  assert.ok(s.letter.length >= 2, 'a covering letter is included');
  assert.ok(s.crew.length >= 2, 'crew details are included');
  assert.ok(s.photo.length >= 2, 'photo output is included');
  assert.ok(s.film.length >= 2, 'film output is included');
  assert.ok(s.addOns.length >= 5, 'the add on list is included');
  assert.equal(s.packageTitle, 'Below mentioned are our Package Details:');
  assert.equal(s.thanks, 'Thank You');
  assert.equal(s.kind, 'quote');
});

// 6
test('defaultDoc fills a new document from the job and its accepted quote', () => {
  const settings = INV.defaultSettings();
  const rec = recordWithQuote(240000);
  const doc = INV.defaultDoc(rec, settings, NOW);

  assert.equal(doc.kind, 'quote');
  assert.equal(doc.charge, 240000);
  assert.equal(doc.events.length, 2);
  assert.equal(doc.events[0].name, 'Reception');
  assert.equal(doc.events[1].name, 'Wedding');
  assert.equal(doc.events[1].date, rec.shootDate, 'the wedding date follows the shoot date on the job');
  assert.equal(doc.issueDate, new Date(NOW).toISOString());
  assert.deepEqual(doc.letter, settings.letter);
  assert.deepEqual(doc.crew, settings.crew);
  assert.deepEqual(doc.photo, settings.photo);
  assert.deepEqual(doc.film, settings.film);
  assert.deepEqual(doc.addOns, settings.addOns);
  assert.equal(doc.notes, 'Yercaud');
});

// 7
test('defaultDoc leaves the charge at zero when nothing has been quoted', () => {
  const rec = W.createRecord({ name: 'Bare lead' }, weddingType(), NOW);
  const doc = INV.defaultDoc(rec, INV.defaultSettings(), NOW);
  assert.equal(doc.charge, 0);
  assert.equal(doc.events[1].date, '');
});

// 8
test('normaliseDoc repairs a half filled document and keeps what is already there', () => {
  const s = INV.defaultSettings();

  const repaired = INV.normaliseDoc({ charge: '240000', kind: 'nonsense', events: [], location: 'Yercaud' }, s);
  assert.equal(repaired.charge, 240000);
  assert.equal(typeof repaired.charge, 'number');
  assert.equal(repaired.kind, 'quote');
  assert.equal(repaired.location, 'Yercaud');
  assert.equal(repaired.events.length, 2, 'an empty event list falls back to the default');
  assert.ok(Array.isArray(repaired.letter) && repaired.letter.length, 'missing keys are filled in');
  assert.equal(repaired.thanks, 'Thank You');

  const asInvoice = INV.normaliseDoc({ kind: 'invoice' }, s);
  assert.equal(asInvoice.kind, 'invoice');

  const kept = INV.normaliseDoc({ events: [{ name: 'Haldi', date: '' }], location: 'Kochi', charge: 5000 }, s);
  assert.deepEqual(kept.events, [{ name: 'Haldi', date: '' }]);
  assert.equal(kept.location, 'Kochi');
  assert.equal(kept.charge, 5000);

  const empty = INV.normaliseDoc(undefined, s);
  assert.equal(empty.charge, 0);
  assert.equal(empty.kind, 'quote');
});

// 9
test('docHtml renders the three page document the studio sends', () => {
  const settings = INV.defaultSettings();
  const doc = {
    kind: 'quote',
    issueDate: feb24(),
    location: 'Yercaud',
    events: [{ name: 'Reception', date: feb24() }, { name: 'Wedding', date: feb25() }],
    charge: 240000,
  };
  const html = INV.docHtml(doc, settings, { client });

  assert.equal(html.split('<section class="page">').length - 1, 3, 'exactly three pages');
  assert.ok(html.includes('Kites &amp; Threads'), 'the studio name is on the document');
  assert.ok(html.includes('Thrissur, Kerala 680011 India'));
  assert.ok(html.includes('+91 81378 89994'));
  assert.ok(html.includes('kitesandthreads@gmail.com'));
  assert.ok(html.includes('Bharathisri'), 'the client name is on the document');
  assert.ok(html.includes('+91 9498868417'), 'the client phone is on the document');
  assert.ok(html.includes('kg.bharthisri@gmail.com'), 'the client email is on the document');
  assert.ok(html.includes('Reception') && html.includes('Wedding'), 'both events are listed');
  assert.ok(html.includes('Issue Date: 24<sup>th</sup> Feb 2027'), 'the issue date has a raised ordinal');
  assert.ok(html.includes('24<sup>th</sup> Feb 2027'), 'the reception date has a raised ordinal');
  assert.ok(html.includes('We are charging Rs: 2,40,000/- for the above package'), 'the charge line is complete');
  assert.ok(html.includes('ADD-ON'), 'the add on heading is present');
  assert.ok(html.includes('Thank You'));
  assert.ok(html.includes('Below mentioned are our Package Details:'));
  assert.ok(html.includes('Photo Output:') && html.includes('Film Output:'));
  assert.ok(html.includes('Crew Details:'));
  assert.ok(html.includes('src="logo-black.png"'), 'the logo points at the black lockup');
  assert.ok(html.includes('Quote For:'), 'a quote says Quote For');
});

// 10
test('docHtml escapes anything a client could put in a name', () => {
  const html = INV.docHtml({ charge: 100 }, INV.defaultSettings(), {
    client: { name: '<script>alert(1)</script>', phone: '', email: '' },
  });
  assert.ok(html.includes('&lt;script&gt;'), 'the angle brackets are escaped');
  assert.ok(!html.includes('<script>'), 'no live script tag survives');
});

// 11
test('docHtml can be an invoice and can use a supplied logo', () => {
  const settings = INV.defaultSettings();
  const doc = { kind: 'invoice', charge: 1000, location: 'Kochi' };

  const invoice = INV.docHtml(doc, settings, { client });
  assert.ok(invoice.includes('Invoice For:'));
  assert.ok(!invoice.includes('Quote For:'));

  const custom = INV.docHtml(doc, settings, { client, logoHref: 'data:image/png;base64,AAAA' });
  assert.ok(custom.includes('src="data:image/png;base64,AAAA"'));
  assert.ok(!custom.includes('src="logo-black.png"'));
});

// 12
test('docText gives a plain text version with no markup in it', () => {
  const text = INV.docText({ charge: 240000, location: 'Yercaud', events: [{ name: 'Reception', date: feb24() }] },
    INV.defaultSettings(), { client });

  assert.ok(text.includes('Bharathisri'));
  assert.ok(text.includes('Kites & Threads'));
  assert.ok(text.includes('2,40,000'));
  assert.ok(text.includes('Photo Output:'));
  assert.ok(text.includes('Film Output:'));
  assert.ok(text.includes('Thank You'));
  assert.ok(!text.includes('<'), 'plain text carries no tags');
  assert.ok(!text.includes('>'), 'plain text carries no tags');
});

// 13
test('DOC_CSS styles the document pages', () => {
  assert.equal(typeof INV.DOC_CSS, 'string');
  assert.ok(INV.DOC_CSS.length > 100);
  assert.ok(INV.DOC_CSS.includes('.doc .page'));
  assert.ok(INV.DOC_CSS.includes('210mm'), 'the page is A4 wide');
});
