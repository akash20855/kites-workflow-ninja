// Pure workflow logic. No DOM, no dependencies. Works in browsers and Node.
(function (root) {
  'use strict';

  // Milestones, in order. Lead Created is the start; Job Complete is manual.
  const MILESTONES = ['LEAD_CREATED', 'JOB_ACCEPTED', 'MAIN_SHOOT', 'JOB_COMPLETE'];
  const STAGE_LABELS = {
    LEAD_CREATED: 'Lead',
    JOB_ACCEPTED: 'Job Accepted',
    MAIN_SHOOT: 'Main Shoot',
    JOB_COMPLETE: 'Job Complete',
  };
  const TASK_TYPES = ['todo', 'email', 'extra_shoot', 'appointment'];

  const DAY_MS = 24 * 60 * 60 * 1000;

  function uid(prefix) {
    return prefix + '_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  // A job type carries a workflow template. Each template task is anchored to a
  // milestone and offset in days (negative = before, positive = after).
  // autoSend: email tasks with a due date are sent automatically when due.
  function makeJobType(name, color, template) {
    return { id: uid('jt'), name, color: color || '#888888', template: template || [] };
  }

  function makeTemplateTask(title, type, anchor, offsetDays, extra) {
    if (!TASK_TYPES.includes(type)) throw new Error('Unknown task type: ' + type);
    if (anchor && !MILESTONES.includes(anchor)) throw new Error('Unknown milestone: ' + anchor);
    return Object.assign({ title, type, anchor: anchor || null, offsetDays: offsetDays || 0, autoSend: false }, extra || {});
  }

  function createRecord(input, jobType, now) {
    const created = now ? new Date(now) : new Date();
    const rec = {
      id: uid('rec'),
      name: input.name,
      client: { name: input.clientName || '', email: input.clientEmail || '', phone: input.clientPhone || '' },
      jobTypeId: jobType ? jobType.id : null,
      shootDate: input.shootDate ? new Date(input.shootDate).toISOString() : null,
      stage: 'LEAD_CREATED',
      milestoneDates: { LEAD_CREATED: created.toISOString() },
      tasks: [],
      quotes: [],
      invoices: [],
      payments: [],
      emailLog: [],
      notes: input.notes || '',
    };
    if (jobType) rec.tasks = buildTasks(rec, jobType);
    return rec;
  }

  // Resolve a task's due date from its anchor milestone's date (or shoot date).
  function resolveDueDate(rec, task) {
    let base;
    if (task.anchor === 'MAIN_SHOOT') base = rec.shootDate || rec.milestoneDates.MAIN_SHOOT;
    else base = rec.milestoneDates[task.anchor];
    if (!base) return null; // anchor not reached yet, no due date
    return new Date(new Date(base).getTime() + (task.offsetDays || 0) * DAY_MS).toISOString();
  }

  function buildTasks(rec, jobType) {
    return jobType.template.map((t) => ({
      id: uid('task'),
      title: t.title,
      type: t.type,
      anchor: t.anchor,
      offsetDays: t.offsetDays,
      autoSend: !!t.autoSend,
      emailTemplate: t.emailTemplate || null,
      done: false,
      sent: false,
      dueDate: resolveDueDate(rec, t),
    }));
  }

  // Move the record to a milestone (never backwards). Records the date, then
  // recomputes task due dates against the new anchors.
  function reachMilestone(rec, milestone, now) {
    if (!MILESTONES.includes(milestone)) throw new Error('Unknown milestone: ' + milestone);
    const idx = MILESTONES.indexOf(milestone);
    if (idx <= MILESTONES.indexOf(rec.stage)) return rec;
    rec.stage = milestone;
    rec.milestoneDates[milestone] = (now ? new Date(now) : new Date()).toISOString();
    rec.tasks.forEach((t) => {
      if (!t.done) t.dueDate = resolveDueDate(rec, t);
    });
    return rec;
  }

  // Quotes: pick-and-choose (client picks one package) or fixed (fixed line items).
  function makeQuote(rec, kind, lines, options) {
    if (!['pick_choose', 'fixed'].includes(kind)) throw new Error('Unknown quote kind: ' + kind);
    const quote = {
      id: uid('q'),
      kind,
      lines: lines.map((l) => ({ label: l.label, price: Number(l.price) || 0 })),
      status: 'sent',
      depositPercent: options && options.depositPercent ? Number(options.depositPercent) : 0,
      autoInvoice: !options || options.autoInvoice !== false,
    };
    rec.quotes.push(quote);
    return quote;
  }

  function quoteTotal(quote) {
    return quote.lines.reduce((s, l) => s + l.price, 0);
  }

  // Accepting a quote moves the lead to Job Accepted and (by default) creates invoices.
  function acceptQuote(rec, quoteId, now) {
    const quote = rec.quotes.find((q) => q.id === quoteId);
    if (!quote) throw new Error('No such quote');
    if (quote.status === 'accepted') return rec;
    quote.status = 'accepted';
    if (quote.autoInvoice) createInvoices(rec, quote, now);
    reachMilestone(rec, 'JOB_ACCEPTED', now);
    return rec;
  }

  // Payment schedule: a deposit now, and the balance due before the shoot.
  function createInvoices(rec, quote, now) {
    const total = quoteTotal(quote);
    const depositAmount = Math.round(total * (quote.depositPercent / 100) * 100) / 100;
    const base = now ? new Date(now) : new Date();
    const schedule = [];
    if (depositAmount > 0 && depositAmount < total) {
      schedule.push({ id: uid('inv'), label: 'Deposit', amount: depositAmount, dueDate: base.toISOString() });
      schedule.push({ id: uid('inv'), label: 'Balance', amount: Math.round((total - depositAmount) * 100) / 100, dueDate: null, beforeShoot: true });
    } else {
      schedule.push({ id: uid('inv'), label: 'Full payment', amount: total, dueDate: null });
    }
    schedule.forEach((i) => { i.paid = 0; rec.invoices.push(i); });
    return schedule;
  }

  function invoiceTotal(rec) {
    return rec.invoices.reduce((s, i) => s + i.amount, 0);
  }

  function amountPaid(rec) {
    return rec.payments.reduce((s, p) => s + p.amount, 0);
  }

  function balanceDue(rec) {
    return Math.max(0, Math.round((invoiceTotal(rec) - amountPaid(rec)) * 100) / 100);
  }

  // Record a payment. Any payment on an accepted job marks it accepted, which
  // mirrors "pays an invoice" as a Job Accepted trigger.
  function recordPayment(rec, amount, now) {
    const amt = Number(amount);
    if (!(amt > 0)) throw new Error('Payment must be positive');
    rec.payments.push({ id: uid('pay'), amount: amt, date: (now ? new Date(now) : new Date()).toISOString() });
    if (rec.invoices.length && amountPaid(rec) > 0) reachMilestone(rec, 'JOB_ACCEPTED', now);
    return rec;
  }

  function markMilestoneManual(rec, milestone, now) {
    return reachMilestone(rec, milestone, now);
  }

  // Automatic milestones driven by the clock: the shoot date moves the job to Main Shoot.
  function applyClock(rec, now) {
    const t = (now ? new Date(now) : new Date()).getTime();
    if (rec.shootDate && t >= new Date(rec.shootDate).getTime() && MILESTONES.indexOf(rec.stage) < MILESTONES.indexOf('MAIN_SHOOT')) {
      if (MILESTONES.indexOf(rec.stage) >= MILESTONES.indexOf('JOB_ACCEPTED')) {
        reachMilestone(rec, 'MAIN_SHOOT', now);
      }
    }
    return rec;
  }

  // Send any due auto-send email tasks. Returns the number of emails sent.
  // Tasks without a due date are never auto-sent; staff must check them manually.
  function runAutomations(rec, now) {
    const t = (now ? new Date(now) : new Date()).getTime();
    let sent = 0;
    rec.tasks.forEach((task) => {
      if (task.type !== 'email' || !task.autoSend || task.sent || task.done) return;
      if (!task.dueDate) return;
      if (new Date(task.dueDate).getTime() <= t) {
        task.sent = true;
        task.done = true;
        rec.emailLog.push({
          at: (now ? new Date(now) : new Date()).toISOString(),
          to: rec.client.email,
          subject: task.title,
          template: task.emailTemplate,
        });
        sent++;
      }
    });
    return sent;
  }

  function runAllAutomations(records, now) {
    return records.reduce((s, r) => s + runAutomations(r, now), 0);
  }

  // Tasks that are open and past due, for a checklist view.
  function overdueTasks(rec, now) {
    const t = (now ? new Date(now) : new Date()).getTime();
    return rec.tasks.filter((task) => !task.done && task.dueDate && new Date(task.dueDate).getTime() < t);
  }

  function stageLabel(stage) {
    return STAGE_LABELS[stage] || stage;
  }

  // ------------------------------------------------------------ money

  const round2 = (n) => Math.round(n * 100) / 100;

  // Indian grouping (last three digits, then pairs) is what a studio in India
  // expects to read; every other currency uses the usual three-digit grouping.
  function groupDigits(digits, indian) {
    if (!indian) return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    if (digits.length <= 3) return digits;
    const head = digits.slice(0, -3);
    const tail = digits.slice(-3);
    return head.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + tail;
  }

  // Amounts are stored as plain numbers. Paise (or cents) are only shown when
  // the amount actually has them, so quotes read as clean round numbers.
  function formatMoney(amount, symbol) {
    const sym = symbol === undefined || symbol === null ? '\u20b9' : String(symbol);
    const n = Number(amount) || 0;
    const cents = Math.round(Math.abs(n) * 100);
    const whole = Math.floor(cents / 100);
    const fraction = cents % 100;
    let digits = groupDigits(String(whole), sym.indexOf('\u20b9') !== -1);
    if (fraction > 0) digits += '.' + String(fraction).padStart(2, '0');
    return (n < 0 ? '-' : '') + sym + digits;
  }

  // ------------------------------------------------------------ reporting

  function startOfDay(value) {
    const d = value === undefined || value === null ? new Date() : new Date(value);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function daysBetween(from, to) {
    return Math.round((startOfDay(to) - startOfDay(from)) / DAY_MS);
  }

  // The value of a job: the accepted quote if there is one, otherwise the newest quote.
  function jobValue(rec) {
    const accepted = rec.quotes.filter((q) => q.status === 'accepted');
    const latest = accepted.length ? accepted[accepted.length - 1] : rec.quotes[rec.quotes.length - 1];
    return latest ? quoteTotal(latest) : 0;
  }

  function taskProgress(rec) {
    const total = rec.tasks.length;
    const done = rec.tasks.filter((t) => t.done).length;
    return { done, total, percent: total ? Math.round((done / total) * 100) : 0 };
  }

  // The single thing to do next on a job: the open task that is due soonest.
  // Tasks whose milestone has not been reached yet have no due date and sort last.
  function nextTask(rec) {
    const open = rec.tasks.filter((t) => !t.done);
    if (!open.length) return null;
    const dated = open.filter((t) => t.dueDate).sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
    return dated[0] || open[0];
  }

  // One pass over everything the studio needs to see at a glance.
  function dashboard(records, now) {
    const nowMs = (now === undefined || now === null ? new Date() : new Date(now)).getTime();
    const counts = { LEAD_CREATED: 0, JOB_ACCEPTED: 0, MAIN_SHOOT: 0, JOB_COMPLETE: 0 };
    const upcomingShoots = [];
    const overdue = [];
    const dueSoon = [];
    const money = { accepted: 0, invoiced: 0, collected: 0, outstanding: 0 };
    let leadsWithoutQuote = 0;
    let openTasks = 0;

    records.forEach((rec) => {
      counts[rec.stage] = (counts[rec.stage] || 0) + 1;

      if (rec.shootDate && rec.stage !== 'JOB_COMPLETE') {
        const shootMs = new Date(rec.shootDate).getTime();
        if (shootMs >= startOfDay(nowMs)) {
          upcomingShoots.push({ id: rec.id, name: rec.name, shootDate: rec.shootDate, daysAway: daysBetween(nowMs, shootMs) });
        }
      }

      rec.tasks.forEach((task) => {
        if (task.done) return;
        openTasks++;
        if (!task.dueDate) return;
        const dueMs = new Date(task.dueDate).getTime();
        const item = { id: rec.id, name: rec.name, taskTitle: task.title, dueDate: task.dueDate };
        // daysLate is whole calendar days, so a task that slipped earlier today is 0 late.
        if (dueMs < nowMs) overdue.push(Object.assign({ daysLate: daysBetween(dueMs, nowMs) }, item));
        else if (daysBetween(nowMs, dueMs) <= 7) dueSoon.push(Object.assign({ daysAway: daysBetween(nowMs, dueMs) }, item));
      });

      if (rec.quotes.some((q) => q.status === 'accepted')) money.accepted += jobValue(rec);
      money.invoiced += invoiceTotal(rec);
      money.collected += amountPaid(rec);
      money.outstanding += balanceDue(rec);
      if (rec.stage === 'LEAD_CREATED' && !rec.quotes.length) leadsWithoutQuote++;
    });

    upcomingShoots.sort((a, b) => new Date(a.shootDate) - new Date(b.shootDate));
    // Most urgent first: the longest overdue, then the ones that slipped today.
    overdue.sort((a, b) => b.daysLate - a.daysLate || new Date(a.dueDate) - new Date(b.dueDate));
    dueSoon.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
    return {
      counts, total: records.length, upcomingShoots, overdue, dueSoon, leadsWithoutQuote, openTasks,
      money: {
        accepted: round2(money.accepted),
        invoiced: round2(money.invoiced),
        collected: round2(money.collected),
        outstanding: round2(money.outstanding),
      },
    };
  }

  // ------------------------------------------------------------ finding and editing

  // Free text search across a job, its client and its notes. Job type names are
  // passed in because a record only stores the job type id.
  function searchRecords(records, query, jobTypes) {
    const q = String(query === undefined || query === null ? '' : query).trim().toLowerCase();
    if (!q) return records.slice();
    const typeName = (id) => {
      const jt = (jobTypes || []).find((j) => j.id === id);
      return jt ? jt.name : '';
    };
    return records.filter((rec) => {
      const hay = [rec.name, rec.client && rec.client.name, rec.client && rec.client.email,
        rec.notes, stageLabel(rec.stage), typeName(rec.jobTypeId)].join(' ').toLowerCase();
      return hay.indexOf(q) !== -1;
    });
  }

  // Edit the details of an existing lead. Moving the shoot date re-resolves the
  // due dates of every task that is still open.
  function updateRecordDetails(rec, patch) {
    if (patch.name !== undefined) rec.name = String(patch.name);
    if (patch.notes !== undefined) rec.notes = String(patch.notes);
    if (patch.clientName !== undefined) rec.client.name = String(patch.clientName);
    if (patch.clientEmail !== undefined) rec.client.email = String(patch.clientEmail);
    if (patch.clientPhone !== undefined) rec.client.phone = String(patch.clientPhone);
    if (patch.shootDate !== undefined) {
      rec.shootDate = patch.shootDate ? new Date(patch.shootDate).toISOString() : null;
      rec.tasks.forEach((t) => { if (!t.done) t.dueDate = resolveDueDate(rec, t); });
    }
    if (patch.jobTypeId !== undefined) rec.jobTypeId = patch.jobTypeId || null;
    return rec;
  }

  // Swap the workflow template of a job while keeping anything already ticked off
  // (matched by task title) so progress is not silently lost.
  function setJobType(rec, jobType) {
    const previous = rec.tasks;
    rec.jobTypeId = jobType ? jobType.id : null;
    rec.tasks = jobType ? buildTasks(rec, jobType) : [];
    rec.tasks.forEach((task) => {
      const match = previous.find((p) => p.title === task.title);
      if (match && match.done) {
        task.done = true;
        task.sent = match.sent;
      }
    });
    return rec;
  }

  // Serialize / parse the whole workspace for offline backup.
  function exportData(state) {
    return JSON.stringify({ version: 1, ...state }, null, 2);
  }

  function importData(json) {
    const data = JSON.parse(json);
    if (!data || data.version !== 1 || !Array.isArray(data.records) || !Array.isArray(data.jobTypes)) {
      throw new Error('Not a valid Kites and Threads workflow backup');
    }
    return { jobTypes: data.jobTypes, records: data.records };
  }

  const api = {
    MILESTONES, STAGE_LABELS, TASK_TYPES, DAY_MS,
    makeJobType, makeTemplateTask, createRecord, buildTasks, resolveDueDate,
    reachMilestone, makeQuote, quoteTotal, acceptQuote, createInvoices,
    invoiceTotal, amountPaid, balanceDue, recordPayment, markMilestoneManual,
    applyClock, runAutomations, runAllAutomations, overdueTasks, stageLabel,
    exportData, importData,
    formatMoney, groupDigits, startOfDay, daysBetween, jobValue, taskProgress,
    nextTask, dashboard, searchRecords, updateRecordDetails, setJobType,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KitesThreadsWorkflow = api;
})(typeof window !== 'undefined' ? window : globalThis);
