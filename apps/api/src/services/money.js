// Earnings ledger, holds, payouts, refunds, incidents, ratings, chat safety. All money is integer paise.
import { sequelize } from '../db/index.js';
import { HttpError } from '../lib/util.js';
import { audit } from './audit.js';
import { addCoins } from './growth.js';

const q = async (sql, replacements, transaction) => (await sequelize.query(sql, { replacements, transaction }))[0];
const one = async (sql, replacements, transaction) => (await q(sql, replacements, transaction))[0];
const notify = (u, type, title, body, data, transaction) => sequelize.query(
  `INSERT INTO notifications (user_id, type, title, body, data) VALUES (:u, :type, :title, :body, :data)`,
  { replacements: { u, type, title, body: body ?? null, data: JSON.stringify(data ?? {}) }, transaction });

export async function moneyRules(transaction) {
  return (await one(`SELECT value FROM app_settings WHERE key = 'money_rules'`, {}, transaction)).value;
}

/** Split one session's price. Fee on the gross; TDS on what is paid to the physio (gross − fee). */
export function split(grossPaise, feePct, tdsPct) {
  const fee = Math.round((grossPaise * feePct) / 100);
  const tds = Math.round(((grossPaise - fee) * tdsPct) / 100);
  return { gross: grossPaise, fee, tds, net: grossPaise - fee - tds };
}

/**
 * Creates earnings for every completed visit of a plan whose payment is confirmed. Idempotent (one entry per visit).
 * Package price is spread evenly across sessions; the last session takes the rounding remainder.
 */
export async function accrueForPlan(planId, transaction) {
  const plan = await one(`SELECT p.id, p.therapist_id, p.price_paise, p.sessions_total FROM plans p
    WHERE p.id = :id AND EXISTS (SELECT 1 FROM payments pay WHERE pay.plan_id = p.id AND pay.status = 'paid')`, { id: planId }, transaction);
  if (!plan) return 0;
  const rules = await moneyRules(transaction);
  const visits = await q(`SELECT v.id, v.completed_at,
      EXISTS (SELECT 1 FROM incidents i WHERE i.visit_id = v.id AND i.status = 'open') AS has_incident,
      (SELECT count(*)::int FROM ledger_entries le WHERE le.plan_id = v.plan_id) AS already
    FROM visits v WHERE v.plan_id = :p AND v.status = 'completed' AND NOT EXISTS (SELECT 1 FROM ledger_entries le WHERE le.visit_id = v.id)
    ORDER BY v.completed_at`, { p: planId }, transaction);
  const per = Math.floor(plan.price_paise / plan.sessions_total);
  let made = 0;
  for (const [i, v] of visits.entries()) {
    const isLast = v.already + i + 1 === plan.sessions_total;
    const gross = isLast ? plan.price_paise - per * (plan.sessions_total - 1) : per;
    const s = split(gross, Number(rules.platformFeePct), Number(rules.tdsPct));
    await q(`INSERT INTO ledger_entries (therapist_id, visit_id, plan_id, gross_paise, fee_paise, tds_paise, net_paise, fee_pct, tds_pct, status, available_at)
      VALUES (:t, :v, :p, :g, :f, :tds, :n, :fp, :tp, :st, :at::timestamptz + make_interval(days => :hold)) ON CONFLICT (visit_id) DO NOTHING`,
    { t: plan.therapist_id, v: v.id, p: planId, g: s.gross, f: s.fee, tds: s.tds, n: s.net, fp: rules.platformFeePct, tp: rules.tdsPct, st: v.has_incident ? 'frozen' : 'held', at: v.completed_at, hold: rules.holdDays }, transaction);
    made++;
  }
  return made;
}

// Held earnings past their hold date become available (run on wallet reads and before building a payout batch).
export async function releaseDue(therapistId, transaction) {
  await q(`UPDATE ledger_entries SET status = 'available', updated_at = now() WHERE status = 'held' AND available_at <= now() ${therapistId ? 'AND therapist_id = :t' : ''}`, { t: therapistId ?? null }, transaction);
}

export async function wallet(therapistId) {
  await releaseDue(therapistId);
  const totals = await q(`SELECT status, COALESCE(sum(net_paise), 0)::int AS net, COALESCE(sum(tds_paise), 0)::int AS tds, count(*)::int AS n
    FROM ledger_entries WHERE therapist_id = :t GROUP BY status`, { t: therapistId });
  const by = s => totals.find(x => x.status === s) ?? { net: 0, tds: 0, n: 0 };
  const entries = await q(`SELECT le.id, le.gross_paise, le.fee_paise, le.tds_paise, le.net_paise, le.status, le.available_at, le.created_at,
      lower(v.during) AS visit_at, u.name AS patient_name, po.reference AS payout_reference
    FROM ledger_entries le JOIN visits v ON v.id = le.visit_id JOIN users u ON u.id = v.patient_id LEFT JOIN payouts po ON po.id = le.payout_id
    WHERE le.therapist_id = :t ORDER BY le.created_at DESC LIMIT 100`, { t: therapistId });
  const payouts = await q(`SELECT id, amount_paise, tds_paise, status, method, reference, paid_at, created_at FROM payouts WHERE therapist_id = :t ORDER BY created_at DESC LIMIT 20`, { t: therapistId });
  return {
    availablePaise: by('available').net, heldPaise: by('held').net, frozenPaise: by('frozen').net,
    paidPaise: by('paid').net, tdsThisYearPaise: totals.reduce((a, x) => a + (x.status === 'reversed' ? 0 : x.tds), 0),
    entries, payouts,
  };
}

// ---------- payouts (paid manually by bank/UPI transfer, then recorded) ----------
export async function buildPayoutBatch(admin, ip) {
  return sequelize.transaction(async t => {
    await releaseDue(null, t);
    const rules = await moneyRules(t);
    const groups = await q(`SELECT therapist_id, sum(net_paise)::int AS amount, sum(tds_paise)::int AS tds, array_agg(id) AS ids
      FROM ledger_entries WHERE status = 'available' AND payout_id IS NULL GROUP BY therapist_id HAVING sum(net_paise) >= :min`, { min: rules.minPayoutPaise }, t);
    if (!groups.length) throw new HttpError(409, 'nothing_to_pay', `No physio has at least ₹${rules.minPayoutPaise / 100} available.`);
    const batch = await one(`INSERT INTO payout_batches (created_by) VALUES (:a) RETURNING id, created_at`, { a: admin.id }, t);
    for (const g of groups) {
      const p = await one(`INSERT INTO payouts (batch_id, therapist_id, amount_paise, tds_paise) VALUES (:b, :t, :a, :tds) RETURNING id`, { b: batch.id, t: g.therapist_id, a: g.amount, tds: g.tds }, t);
      await q(`UPDATE ledger_entries SET payout_id = :p, updated_at = now() WHERE id IN (:ids)`, { p: p.id, ids: g.ids }, t);
    }
    await audit({ actor: admin, action: 'payout_batch.created', targetType: 'payout_batch', targetId: batch.id, after: { payees: groups.length, totalPaise: groups.reduce((a, g) => a + g.amount, 0) }, ip }, t);
    return { batchId: batch.id, payees: groups.length };
  });
}

export async function markPayoutPaid({ admin, payoutId, method, reference, ip }) {
  return sequelize.transaction(async t => {
    const p = await one(`SELECT id, therapist_id, amount_paise, status FROM payouts WHERE id = :id FOR UPDATE`, { id: payoutId }, t);
    if (!p) throw new HttpError(404, 'not_found', 'Payout not found.');
    if (p.status === 'paid') throw new HttpError(409, 'already_paid', 'Already marked paid.');
    // An earning frozen after the batch was built is taken out of this payout.
    const frozen = await one(`SELECT COALESCE(sum(net_paise), 0)::int AS s FROM ledger_entries WHERE payout_id = :p AND status <> 'available'`, { p: p.id }, t);
    if (frozen.s > 0) throw new HttpError(409, 'payout_changed', 'Some earnings in this payout were frozen. Rebuild the batch.');
    await q(`UPDATE payouts SET status = 'paid', method = :m, reference = :r, paid_by = :a, paid_at = now() WHERE id = :id`, { m: method, r: reference, a: admin.id, id: p.id }, t);
    await q(`UPDATE ledger_entries SET status = 'paid', updated_at = now() WHERE payout_id = :p`, { p: p.id }, t);
    await notify(p.therapist_id, 'payout_paid', 'Payout sent', `₹${(p.amount_paise / 100).toLocaleString('en-IN')} sent by ${method.toUpperCase()} · ref ${reference}`, { payoutId: p.id }, t);
    await audit({ actor: admin, action: 'payout.paid', targetType: 'payout', targetId: p.id, after: { method, reference, amountPaise: p.amount_paise }, ip }, t);
    return { status: 'paid' };
  });
}

// ---------- refunds of unused sessions ----------
export async function refundEstimate(patientId, planId) {
  const plan = await one(`SELECT p.id, p.price_paise, p.sessions_total, p.status,
      (SELECT pay.amount_paise FROM payments pay WHERE pay.plan_id = p.id AND pay.status = 'paid' LIMIT 1) AS cash_paise,
      (SELECT pay.coins_used FROM payments pay WHERE pay.plan_id = p.id AND pay.status = 'paid' LIMIT 1) AS coins_used,
      (SELECT count(*)::int FROM visits v WHERE v.plan_id = p.id AND v.status IN ('checked_in', 'completed', 'late_cancelled', 'no_show')) AS used,
      EXISTS (SELECT 1 FROM payments pay WHERE pay.plan_id = p.id AND pay.status = 'paid') AS paid
    FROM plans p WHERE p.id = :id AND p.patient_id = :u`, { id: planId, u: patientId });
  if (!plan) throw new HttpError(404, 'not_found', 'Plan not found.');
  const unused = Math.max(0, plan.sessions_total - plan.used);
  return { planId: plan.id, paid: plan.paid, status: plan.status, sessionsTotal: plan.sessions_total, used: plan.used, unused,
    // Cash back pro rata on what was actually paid; coins used come back pro rata as coins.
    amountPaise: Math.floor(((plan.cash_paise ?? plan.price_paise) * unused) / plan.sessions_total),
    coinsBack: Math.floor(((plan.coins_used ?? 0) * unused) / plan.sessions_total) };
}

export async function requestRefund({ patientId, planId, refundTo }) {
  const est = await refundEstimate(patientId, planId);
  if (!est.paid) throw new HttpError(409, 'not_paid', 'Only paid plans can be refunded. Unpaid bookings can simply be cancelled.');
  if (est.status !== 'active') throw new HttpError(409, 'plan_not_active', 'This plan can’t be refunded.');
  if (est.amountPaise <= 0) throw new HttpError(409, 'nothing_to_refund', 'All sessions in this plan have been used.');
  try {
    const r = await one(`INSERT INTO refunds (patient_id, plan_id, amount_paise, coins_back, reason, refund_to) VALUES (:u, :p, :a, :c, 'unused_sessions', :to) RETURNING id, amount_paise, status`,
      { u: patientId, p: planId, a: est.amountPaise, c: est.coinsBack, to: refundTo });
    return { refundId: r.id, amountPaise: r.amount_paise, status: r.status };
  } catch (e) {
    if (e.name === 'SequelizeUniqueConstraintError') throw new HttpError(409, 'refund_open', 'A refund for this plan is already in progress.');
    throw e;
  }
}

export async function decideRefund({ admin, refundId, approve, note, ip }) {
  return sequelize.transaction(async t => {
    const r = await one(`SELECT * FROM refunds WHERE id = :id FOR UPDATE`, { id: refundId }, t);
    if (!r) throw new HttpError(404, 'not_found', 'Refund not found.');
    if (r.status !== 'requested') throw new HttpError(409, 'already_decided', 'Already decided.');
    if (approve) {
      // Future visits in the plan are cancelled; the plan ends.
      await q(`UPDATE visits SET status = 'cancelled', cancel_reason = 'plan_refunded', updated_at = now() WHERE plan_id = :p AND status IN ('held', 'booked')`, { p: r.plan_id }, t);
      if (r.reason === 'unused_sessions') await q(`UPDATE plans SET status = 'refunded', updated_at = now() WHERE id = :p`, { p: r.plan_id }, t);
      if (r.coins_back > 0) await addCoins({ userId: r.patient_id, delta: r.coins_back, reason: 'refund_return', refId: r.id, note: 'Unused sessions refunded' }, t);
    }
    await q(`UPDATE refunds SET status = :s, note = :n, decided_by = :a, decided_at = now() WHERE id = :id`, { s: approve ? 'approved' : 'rejected', n: note ?? null, a: admin.id, id: r.id }, t);
    await notify(r.patient_id, approve ? 'refund_approved' : 'refund_rejected', approve ? 'Refund approved' : 'Refund not approved',
      approve ? `₹${(r.amount_paise / 100).toLocaleString('en-IN')} will be sent to you within 5–7 working days.` : note, { refundId: r.id }, t);
    await audit({ actor: admin, action: approve ? 'refund.approved' : 'refund.rejected', targetType: 'refund', targetId: r.id, after: { amountPaise: r.amount_paise, note }, ip }, t);
    return { status: approve ? 'approved' : 'rejected' };
  });
}

export async function markRefundPaid({ admin, refundId, reference, ip }) {
  const [row] = await q(`UPDATE refunds SET status = 'paid', reference = :r, paid_by = :a, paid_at = now() WHERE id = :id AND status = 'approved' RETURNING id, patient_id, amount_paise`, { r: reference, a: admin.id, id: refundId });
  if (!row) throw new HttpError(409, 'not_approved', 'Only approved refunds can be marked paid.');
  await notify(row.patient_id, 'refund_paid', 'Refund sent', `₹${(row.amount_paise / 100).toLocaleString('en-IN')} sent · ref ${reference}`, { refundId: row.id });
  await audit({ actor: admin, action: 'refund.paid', targetType: 'refund', targetId: row.id, after: { reference }, ip });
  return { status: 'paid' };
}

// ---------- incidents (7-day protection) ----------
export async function reportIncident({ patientId, visitId, category, description, fileIds = [], ip }) {
  return sequelize.transaction(async t => {
    const rules = await moneyRules(t);
    const v = await one(`SELECT id, therapist_id, status, completed_at, lower(during) AS starts_at FROM visits WHERE id = :id AND patient_id = :u`, { id: visitId, u: patientId }, t);
    if (!v) throw new HttpError(404, 'not_found', 'Visit not found.');
    const ref = v.completed_at ?? v.starts_at;
    if (Date.now() - new Date(ref).getTime() > rules.reportWindowDays * 864e5) throw new HttpError(409, 'window_closed', `Problems can be reported within ${rules.reportWindowDays} days of a visit. Contact support or file a grievance.`);
    const severity = ['behaviour', 'hurt'].includes(category) ? 'critical' : category === 'missing_item' ? 'medium' : 'low';
    const inc = await one(`INSERT INTO incidents (visit_id, reported_by, against_user, category, severity, description, file_ids) VALUES (:v, :u, :t, :c, :s, :d, :f) RETURNING id`,
      { v: v.id, u: patientId, t: v.therapist_id, c: category, s: severity, d: description, f: `{${fileIds.join(',')}}` }, t);
    // Freeze this visit's earning (if not yet paid out) while it is investigated.
    await q(`UPDATE ledger_entries SET status = 'frozen', updated_at = now() WHERE visit_id = :v AND status IN ('held', 'available')`, { v: v.id }, t);
    await notify(v.therapist_id, 'visit_under_review', 'A visit is under review', 'A patient raised a concern. Earnings for that visit are frozen while we check. Our team will contact you.', { incidentId: inc.id }, t);
    await audit({ actor: { id: patientId, primaryRole: 'patient' }, action: 'incident.reported', targetType: 'incident', targetId: inc.id, after: { category, severity }, ip }, t);
    return { incidentId: inc.id, severity, message: 'We’ve received your report and paused the physio’s payment for this visit. We’ll reply within 48 hours.' };
  });
}

export async function decideIncident({ admin, incidentId, uphold, note, refundPaise, ip }) {
  return sequelize.transaction(async t => {
    const inc = await one(`SELECT i.*, v.plan_id, v.patient_id FROM incidents i JOIN visits v ON v.id = i.visit_id WHERE i.id = :id FOR UPDATE OF i`, { id: incidentId }, t);
    if (!inc) throw new HttpError(404, 'not_found', 'Incident not found.');
    if (inc.status !== 'open') throw new HttpError(409, 'already_decided', 'Already decided.');
    await q(`UPDATE incidents SET status = :s, decision_note = :n, decided_by = :a, decided_at = now() WHERE id = :id`, { s: uphold ? 'upheld' : 'dismissed', n: note, a: admin.id, id: inc.id }, t);
    let refundId = null;
    if (uphold) {
      await q(`UPDATE ledger_entries SET status = 'reversed', updated_at = now() WHERE visit_id = :v AND status = 'frozen'`, { v: inc.visit_id }, t);
      if (refundPaise > 0) {
        refundId = (await one(`INSERT INTO refunds (patient_id, plan_id, amount_paise, reason, incident_id, status, decided_by, decided_at, note) VALUES (:u, :p, :a, 'incident', :i, 'approved', :ad, now(), :n) RETURNING id`,
          { u: inc.patient_id, p: inc.plan_id, a: refundPaise, i: inc.id, ad: admin.id, n: note }, t)).id;
      }
    } else {
      await q(`UPDATE ledger_entries SET status = CASE WHEN available_at <= now() THEN 'available'::ledger_status ELSE 'held'::ledger_status END, updated_at = now() WHERE visit_id = :v AND status = 'frozen'`, { v: inc.visit_id }, t);
    }
    await notify(inc.patient_id, 'incident_decided', uphold ? 'We’ve upheld your report' : 'We’ve reviewed your report', note, { incidentId: inc.id }, t);
    await notify(inc.against_user, 'incident_decided', uphold ? 'A report about your visit was upheld' : 'A report about your visit was dismissed', note, { incidentId: inc.id }, t);
    await audit({ actor: admin, action: uphold ? 'incident.upheld' : 'incident.dismissed', targetType: 'incident', targetId: inc.id, after: { note, refundPaise: refundPaise ?? 0 }, ip }, t);
    return { status: uphold ? 'upheld' : 'dismissed', refundId };
  });
}

// ---------- ratings ----------
export async function rateVisit({ patientId, visitId, stars, tags = [], comment }) {
  return sequelize.transaction(async t => {
    const v = await one(`SELECT id, therapist_id, status FROM visits WHERE id = :id AND patient_id = :u`, { id: visitId, u: patientId }, t);
    if (!v) throw new HttpError(404, 'not_found', 'Visit not found.');
    if (v.status !== 'completed') throw new HttpError(409, 'not_completed', 'You can rate a visit after it’s done.');
    try {
      await q(`INSERT INTO ratings (visit_id, patient_id, therapist_id, stars, tags, comment) VALUES (:v, :u, :t, :s, :tags, :c)`,
        { v: v.id, u: patientId, t: v.therapist_id, s: stars, tags: `{${tags.map(x => `"${x}"`).join(',')}}`, c: comment ?? null }, t);
    } catch (e) {
      if (e.name === 'SequelizeUniqueConstraintError') throw new HttpError(409, 'already_rated', 'You’ve already rated this visit.');
      throw e;
    }
    const avg = await one(`SELECT round(avg(stars)::numeric, 2) AS r FROM ratings WHERE therapist_id = :t`, { t: v.therapist_id }, t);
    await q(`UPDATE therapist_profiles SET rating = :r, updated_at = now() WHERE user_id = :t`, { r: avg.r, t: v.therapist_id }, t);
    return { rated: true };
  });
}

// ---------- chat safety ----------
// Contact details are blocked so visits and payments stay inside PhysioCare (safety + leakage).
const PATTERNS = [
  ['phone_number', /(?:\+?91[\s-]?)?[6-9](?:[\s-]?\d){9}/],
  ['upi_id', /\b[\w.-]{2,}@(?:ok)?[a-z]{2,}\b/i],
  ['email', /\b[\w.+-]+@[\w-]+\.[a-z]{2,}\b/i],
  ['off_app', /\b(whats\s?app|wa\.me|gpay|phonepe|paytm|google\s?pay|cash\s?direct|pay\s?me\s?directly)\b/i],
];
export const contactCheck = text => PATTERNS.find(([, re]) => re.test(text))?.[0] ?? null;
