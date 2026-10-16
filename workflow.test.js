const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('./workflow.js');

const DAY = W.DAY_MS;
const T0 = '2026-10-01T10:00:00.000Z';

function sampleType() {
  return W.makeJobType('Wedding', '#e11d48', [
    W.makeTemplateTask('Send questionnaire', 'email', 'LEAD_CREATED', 2, { autoSend: true, emailTemplate: 'questionnaire' }),
    W.makeTemplateTask('Send contract', 'email', 'JOB_ACCEPTED', 1, { autoSend: false }),
    W.makeTemplateTask('Pre-shoot reminder', 'email', 'MAIN_SHOOT', -3, { autoSend: true, emailTemplate: 'reminder' }),
    W.makeTemplateTask('Book second shooter', 'extra_shoot', 'JOB_ACCEPTED', 0),
    W.makeTemplateTask('Edit photos', 'todo', 'MAIN_SHOOT', 14),
  ]);
}

test('new lead starts at LEAD_CREATED with that milestone dated', () => {
  const rec = W.createRecord({ name: 'Smith', shootDate: '2026-11-20T09:00:00.000Z', clientEmail: 'a@b.c' }, sampleType(), T0);
  assert.equal(rec.stage, 'LEAD_CREATED');
  assert.equal(rec.milestoneDates.LEAD_CREATED, T0);
  assert.equal(W.stageLabel(rec.stage), 'Lead');
});

test('milestone-anchored tasks wait for the milestone; shoot-anchored tasks use the scheduled shoot date', () => {
  const rec = W.createRecord({ name: 'Smith', shootDate: '2026-11-20T09:00:00.000Z' }, sampleType(), T0);
  const contract = rec.tasks.find((t) => t.title === 'Send contract');
  const edit = rec.tasks.find((t) => t.title === 'Edit photos');
  assert.equal(contract.dueDate, null);
  assert.equal(new Date(edit.dueDate).getTime(), new Date('2026-12-04T09:00:00.000Z').getTime());
  const q = rec.tasks.find((t) => t.title === 'Send questionnaire');
  assert.equal(new Date(q.dueDate).getTime(), new Date(T0).getTime() + 2 * DAY);
});

test('accepting a quote moves to JOB_ACCEPTED, creates invoices and recomputes due dates', () => {
  const rec = W.createRecord({ name: 'Smith', shootDate: '2026-11-20T09:00:00.000Z' }, sampleType(), T0);
  const q = W.makeQuote(rec, 'fixed', [{ label: 'Wedding package', price: 2000 }], { depositPercent: 30 });
  const T1 = '2026-10-05T10:00:00.000Z';
  W.acceptQuote(rec, q.id, T1);
  assert.equal(rec.stage, 'JOB_ACCEPTED');
  assert.equal(rec.invoices.length, 2);
  assert.equal(rec.invoices[0].amount, 600);
  assert.equal(rec.invoices[1].amount, 1400);
  assert.equal(W.balanceDue(rec), 2000);
  const contract = rec.tasks.find((t) => t.title === 'Send contract');
  assert.equal(new Date(contract.dueDate).getTime(), new Date(T1).getTime() + DAY);
});

test('stages never move backwards', () => {
  const rec = W.createRecord({ name: 'x' }, null, T0);
  W.markMilestoneManual(rec, 'JOB_COMPLETE', T0);
  W.markMilestoneManual(rec, 'JOB_ACCEPTED', T0);
  assert.equal(rec.stage, 'JOB_COMPLETE');
});

test('auto-send emails fire only when due, and manual-check tasks never auto-send', () => {
  const rec = W.createRecord({ name: 'Smith', clientEmail: 'a@b.c', shootDate: '2026-11-20T09:00:00.000Z' }, sampleType(), T0);
  // Questionnaire is due T0+2d.
  assert.equal(W.runAutomations(rec, new Date(new Date(T0).getTime() + DAY)), 0);
  assert.equal(W.runAutomations(rec, new Date(new Date(T0).getTime() + 2 * DAY)), 1);
  assert.equal(rec.emailLog[0].template, 'questionnaire');
  // Running again must not resend the questionnaire; only the shoot reminder is newly due.
  assert.equal(W.runAutomations(rec, new Date('2027-01-01T00:00:00Z')), 1);
  assert.equal(rec.emailLog.filter((e) => e.template === 'questionnaire').length, 1);
  assert.equal(W.runAutomations(rec, new Date('2027-06-01T00:00:00Z')), 0);
  // Contract task has autoSend=false, so it is never sent automatically.
  W.reachMilestone(rec, 'JOB_ACCEPTED', T0);
  W.runAutomations(rec, new Date('2027-01-01T00:00:00Z'));
  assert.ok(!rec.emailLog.some((e) => e.subject === 'Send contract'));
});

test('reminder before shoot is sent after shoot milestone sets its due date', () => {
  const rec = W.createRecord({ name: 'Smith', clientEmail: 'a@b.c', shootDate: '2026-11-20T09:00:00.000Z' }, sampleType(), T0);
  W.acceptQuote(rec, W.makeQuote(rec, 'fixed', [{ label: 'p', price: 100 }], {}).id, T0);
  // Reminder anchors to shoot date minus 3 days; not due before that.
  const reminder = rec.tasks.find((t) => t.title === 'Pre-shoot reminder');
  assert.equal(new Date(reminder.dueDate).getTime(), new Date('2026-11-17T09:00:00.000Z').getTime());
  W.runAutomations(rec, new Date('2026-11-16T00:00:00Z'));
  assert.ok(!rec.emailLog.some((e) => e.subject === 'Pre-shoot reminder'));
  W.runAutomations(rec, new Date('2026-11-17T10:00:00Z'));
  assert.ok(rec.emailLog.some((e) => e.subject === 'Pre-shoot reminder'));
});

test('clock moves an accepted job to MAIN_SHOOT on the shoot date', () => {
  const rec = W.createRecord({ name: 'Smith', shootDate: '2026-11-20T09:00:00.000Z' }, sampleType(), T0);
  W.acceptQuote(rec, W.makeQuote(rec, 'fixed', [{ label: 'p', price: 100 }], {}).id, T0);
  W.applyClock(rec, '2026-11-19T00:00:00Z');
  assert.equal(rec.stage, 'JOB_ACCEPTED');
  W.applyClock(rec, '2026-11-20T09:00:00Z');
  assert.equal(rec.stage, 'MAIN_SHOOT');
});

test('a lead without an accepted quote does not jump to MAIN_SHOOT on the clock', () => {
  const rec = W.createRecord({ name: 'Lead', shootDate: '2026-11-20T09:00:00.000Z' }, null, T0);
  W.applyClock(rec, '2026-12-01T00:00:00Z');
  assert.equal(rec.stage, 'LEAD_CREATED');
});

test('payments: partial payment keeps balance, any payment on an invoice accepts the job', () => {
  const rec = W.createRecord({ name: 'Smith' }, null, T0);
  const q = W.makeQuote(rec, 'pick_choose', [{ label: 'Gold', price: 1000 }], { depositPercent: 50 });
  // Quote not accepted yet, so no invoices exist. Accept to create them.
  W.acceptQuote(rec, q.id, T0);
  W.recordPayment(rec, 200, T0);
  assert.equal(W.amountPaid(rec), 200);
  assert.equal(W.balanceDue(rec), 800);
  assert.throws(() => W.recordPayment(rec, 0, T0), /positive/);
});

test('quote without autoInvoice does not create invoices but still accepts the job', () => {
  const rec = W.createRecord({ name: 'Smith' }, null, T0);
  const q = W.makeQuote(rec, 'fixed', [{ label: 'x', price: 50 }], { autoInvoice: false });
  W.acceptQuote(rec, q.id, T0);
  assert.equal(rec.invoices.length, 0);
  assert.equal(rec.stage, 'JOB_ACCEPTED');
});

test('backup round-trips and rejects foreign data', () => {
  const jt = sampleType();
  const rec = W.createRecord({ name: 'Smith' }, jt, T0);
  const json = W.exportData({ jobTypes: [jt], records: [rec] });
  const back = W.importData(json);
  assert.equal(back.records[0].name, 'Smith');
  assert.equal(back.jobTypes[0].name, 'Wedding');
  assert.throws(() => W.importData('{"foo":1}'), /valid/);
});

test('invalid milestone and task type are rejected', () => {
  assert.throws(() => W.makeTemplateTask('x', 'bogus', null, 0), /task type/);
  assert.throws(() => W.makeTemplateTask('x', 'todo', 'NOPE', 0), /milestone/);
});

// ---------------------------------------------------------------- money

test('money is formatted the Indian way for rupees and the usual way otherwise', () => {
  assert.equal(W.formatMoney(0), '\u20b90');
  assert.equal(W.formatMoney(1500), '\u20b91,500');
  assert.equal(W.formatMoney(123456), '\u20b91,23,456');
  assert.equal(W.formatMoney(1234567), '\u20b912,34,567');
  assert.equal(W.formatMoney(10000000), '\u20b91,00,00,000');
  assert.equal(W.formatMoney(123456, '$'), '$123,456');
  assert.equal(W.formatMoney(1234567.5, '$'), '$1,234,567.50');
});

test('paise are shown only when the amount is not a whole number, and negatives keep the sign', () => {
  assert.equal(W.formatMoney(2000), '\u20b92,000');
  assert.equal(W.formatMoney(2000.5), '\u20b92,000.50');
  assert.equal(W.formatMoney(2000.999), '\u20b92,001');
  assert.equal(W.formatMoney(-500), '-\u20b9500');
  assert.equal(W.formatMoney('1500'), '\u20b91,500');
  assert.equal(W.formatMoney(undefined), '\u20b90');
});

// ---------------------------------------------------------------- dashboard

test('dashboard groups the work: counts, upcoming shoots, overdue and due soon', () => {
  const jt = sampleType();
  const near = W.createRecord({ name: 'Near', shootDate: '2026-10-20T09:00:00.000Z', clientEmail: 'a@b.c' }, jt, T0);
  const far = W.createRecord({ name: 'Far', shootDate: '2026-12-20T09:00:00.000Z' }, jt, T0);
  const pastShoot = W.createRecord({ name: 'Past', shootDate: '2026-09-01T09:00:00.000Z' }, jt, T0);
  const done = W.createRecord({ name: 'Done', shootDate: '2026-10-25T09:00:00.000Z' }, jt, T0);
  W.markMilestoneManual(done, 'JOB_COMPLETE', T0);

  const now = '2026-10-05T10:00:00.000Z';
  const d = W.dashboard([near, far, pastShoot, done], now);

  assert.equal(d.total, 4);
  assert.equal(d.counts.LEAD_CREATED, 3);
  assert.equal(d.counts.JOB_COMPLETE, 1);
  // A shoot in the past and a completed job are both left out of the upcoming list.
  assert.deepEqual(d.upcomingShoots.map((s) => s.name), ['Near', 'Far']);
  assert.equal(d.upcomingShoots[0].daysAway, 15);
  assert.equal(d.upcomingShoots[1].daysAway, 76);
  // The questionnaire of every job was due two days after the lead came in, even
  // the finished job, plus the shoot-anchored tasks of the shoot that already passed.
  assert.equal(d.overdue.filter((o) => o.taskTitle === 'Send questionnaire').length, 4);
  assert.equal(d.overdue.length, 6);
  // Sorted most late first, and the past shoot is the worst offender.
  assert.equal(d.overdue[0].name, 'Past');
  assert.equal(d.overdue[0].daysLate, 37);
  assert.equal(d.overdue[d.overdue.length - 1].daysLate, 2);
});

test('dashboard reports the money picture and the leads that still need a quote', () => {
  const quote = W.createRecord({ name: 'Quoted', clientEmail: 'a@b.c', shootDate: '2026-11-20T09:00:00.000Z' }, sampleType(), T0);
  W.acceptQuote(quote, W.makeQuote(quote, 'fixed', [{ label: 'Wedding film', price: 2000 }], { depositPercent: 30 }).id, T0);
  W.recordPayment(quote, 500, T0);
  const noQuote = W.createRecord({ name: 'Bare lead' }, sampleType(), T0);

  const d = W.dashboard([quote, noQuote], '2026-10-05T10:00:00.000Z');
  assert.equal(d.money.accepted, 2000);
  assert.equal(d.money.invoiced, 2000);
  assert.equal(d.money.collected, 500);
  assert.equal(d.money.outstanding, 1500);
  assert.equal(d.leadsWithoutQuote, 1);
});

test('dashboard counts tasks due inside the next week separately from late ones', () => {
  const rec = W.createRecord({ name: 'Smith', clientEmail: 'a@b.c', shootDate: '2026-11-20T09:00:00.000Z' }, sampleType(), T0);
  // Questionnaire is due T0 + 2 days.
  const d = W.dashboard([rec], '2026-10-02T10:00:00.000Z');
  assert.equal(d.overdue.length, 0);
  assert.equal(d.dueSoon.length, 1);
  assert.equal(d.dueSoon[0].daysAway, 1);
});

test('job progress, next task and job value describe one job', () => {
  const rec = W.createRecord({ name: 'Smith', shootDate: '2026-11-20T09:00:00.000Z' }, sampleType(), T0);
  assert.equal(W.jobValue(rec), 0);
  W.makeQuote(rec, 'fixed', [{ label: 'p', price: 1200 }], {});
  assert.equal(W.jobValue(rec), 1200);
  assert.deepEqual(W.taskProgress(rec), { done: 0, total: 5, percent: 0 });
  rec.tasks[0].done = true;
  assert.equal(W.taskProgress(rec).percent, 20);
  // The next task is the open one that comes due soonest, skipping the finished
  // questionnaire and the tasks whose milestone has not been reached yet.
  assert.equal(rec.tasks[0].title, 'Send questionnaire');
  assert.equal(W.nextTask(rec).title, 'Pre-shoot reminder');
  rec.tasks.forEach((t) => { t.done = true; });
  assert.equal(W.nextTask(rec), null);
  assert.equal(W.taskProgress(rec).percent, 100);
});

// ---------------------------------------------------------------- find and edit

test('search matches the job name, the client, the notes and the job type', () => {
  const jt = W.makeJobType('Wedding Film & Photos', '#e11d48', []);
  const other = W.makeJobType('Portrait Session', '#0a84ff', []);
  const a = W.createRecord({ name: 'Anushree & Deepak', clientName: 'Anushree', clientEmail: 'anushree@example.com', notes: 'temple shoot in Kochi' }, jt, T0);
  const b = W.createRecord({ name: 'Josan', clientName: 'Josan', clientEmail: 'josan@example.com', notes: 'Dubai' }, other, T0);
  const records = [a, b];

  assert.equal(W.searchRecords(records, '', [jt, other]).length, 2);
  assert.deepEqual(W.searchRecords(records, 'deepak', [jt, other]).map((r) => r.name), ['Anushree & Deepak']);
  assert.deepEqual(W.searchRecords(records, 'JOSAN', [jt, other]).map((r) => r.name), ['Josan']);
  assert.deepEqual(W.searchRecords(records, 'kochi', [jt, other]).map((r) => r.name), ['Anushree & Deepak']);
  assert.deepEqual(W.searchRecords(records, 'portrait', [jt, other]).map((r) => r.name), ['Josan']);
  assert.equal(W.searchRecords(records, 'nothing here', [jt, other]).length, 0);
});

test('editing a job keeps history and re-resolves open due dates when the shoot moves', () => {
  const rec = W.createRecord({ name: 'Smith', clientName: 'A', clientEmail: 'a@b.c', notes: 'old', shootDate: '2026-11-20T09:00:00.000Z' }, sampleType(), T0);
  const edit = rec.tasks.find((t) => t.title === 'Edit photos');
  edit.done = true;
  const reminderBefore = new Date(rec.tasks.find((t) => t.title === 'Pre-shoot reminder').dueDate).getTime();

  W.updateRecordDetails(rec, { name: 'Smith Wedding', notes: 'new note', clientName: 'Smith', shootDate: '2026-12-20T09:00:00.000Z' });

  assert.equal(rec.name, 'Smith Wedding');
  assert.equal(rec.notes, 'new note');
  assert.equal(rec.client.name, 'Smith');
  assert.equal(rec.milestoneDates.LEAD_CREATED, T0, 'history is untouched');
  const reminderAfter = new Date(rec.tasks.find((t) => t.title === 'Pre-shoot reminder').dueDate).getTime();
  assert.equal(reminderAfter - reminderBefore, 30 * DAY, 'open task due dates follow the new shoot date');
  assert.equal(edit.done, true);
  // Clearing the shoot date leaves tasks without a due date instead of a stale one.
  W.updateRecordDetails(rec, { shootDate: null });
  assert.equal(rec.shootDate, null);
  assert.equal(rec.tasks.find((t) => t.title === 'Pre-shoot reminder').dueDate, null);
  assert.equal(new Date(rec.tasks.find((t) => t.title === 'Edit photos').dueDate).toISOString(), '2026-12-04T09:00:00.000Z', 'a finished task keeps the date it was done against');
});

test('changing the job type rebuilds the template but keeps finished work', () => {
  const wedding = W.makeJobType('Wedding Film & Photos', '#e11d48', [
    W.makeTemplateTask('Send questionnaire', 'email', 'LEAD_CREATED', 2),
    W.makeTemplateTask('Edit & deliver photos', 'todo', 'MAIN_SHOOT', 14),
  ]);
  const portrait = W.makeJobType('Portrait Session', '#0a84ff', [
    W.makeTemplateTask('Send questionnaire', 'email', 'LEAD_CREATED', 0),
    W.makeTemplateTask('Edit photos', 'todo', 'MAIN_SHOOT', 7),
  ]);
  const rec = W.createRecord({ name: 'Smith', shootDate: '2026-11-20T09:00:00.000Z' }, wedding, T0);
  rec.tasks[0].done = true;

  W.setJobType(rec, portrait);
  assert.equal(rec.jobTypeId, portrait.id);
  assert.deepEqual(rec.tasks.map((t) => t.title), ['Send questionnaire', 'Edit photos']);
  assert.equal(rec.tasks[0].done, true, 'a task with the same title stays ticked off');
  assert.equal(rec.tasks[1].done, false);

  W.setJobType(rec, null);
  assert.equal(rec.jobTypeId, null);
  assert.equal(rec.tasks.length, 0);
});
