import { Router } from 'express';
import { z } from 'zod';
import { sequelize } from '../db/index.js';
import { HttpError } from '../lib/util.js';
import { asyncHandler, requireAuth, requireRole, validate } from '../middleware/index.js';
import { audit } from '../services/audit.js';
import {
  buildPayoutBatch, contactCheck, decideIncident, decideRefund, markPayoutPaid, markRefundPaid, moneyRules,
  rateVisit, refundEstimate, releaseDue, reportIncident, requestRefund, wallet,
} from '../services/money.js';

const q = async (sql, replacements) => (await sequelize.query(sql, { replacements }))[0];
const one = async (sql, replacements) => (await q(sql, replacements))[0];

// ---------- physio wallet ----------
export const walletRouter = Router();
walletRouter.use(requireAuth, requireRole('therapist'));
walletRouter.get('/', asyncHandler(async (req, res) => res.json(await wallet(req.user.id))));

// ---------- patient: plans, refunds, incidents, ratings ----------
export const patientMoneyRouter = Router();
patientMoneyRouter.use(requireAuth, requireRole('patient'));

patientMoneyRouter.get('/plans', asyncHandler(async (req, res) => {
  const plans = await q(`SELECT p.id, p.status, p.sessions_total, p.price_paise, p.valid_until, p.mode, u.name AS therapist_name, pay.status AS payment_status,
      (SELECT count(*)::int FROM visits v WHERE v.plan_id = p.id AND v.status = 'completed') AS completed
    FROM plans p JOIN users u ON u.id = p.therapist_id LEFT JOIN payments pay ON pay.plan_id = p.id
    WHERE p.patient_id = :u AND p.status <> 'pending' ORDER BY p.created_at DESC`, { u: req.user.id });
  res.json({ plans });
}));
patientMoneyRouter.get('/plans/:id/refund-estimate', asyncHandler(async (req, res) => res.json(await refundEstimate(req.user.id, req.params.id))));
patientMoneyRouter.post('/plans/:id/refund', validate(z.object({ refundTo: z.string().trim().min(5).max(200) })),
  asyncHandler(async (req, res) => res.status(201).json(await requestRefund({ patientId: req.user.id, planId: req.params.id, refundTo: req.body.refundTo }))));
patientMoneyRouter.get('/refunds', asyncHandler(async (req, res) => {
  res.json({ refunds: await q(`SELECT id, plan_id, amount_paise, reason, status, reference, note, created_at, paid_at FROM refunds WHERE patient_id = :u ORDER BY created_at DESC`, { u: req.user.id }) });
}));
patientMoneyRouter.post('/incidents', validate(z.object({
  visitId: z.string().uuid(),
  category: z.enum(['missing_item', 'behaviour', 'no_show', 'hurt', 'payment', 'other']),
  description: z.string().trim().min(10, 'Tell us a little more (at least 10 characters).').max(3000),
  fileIds: z.array(z.string().uuid()).max(5).optional(),
})), asyncHandler(async (req, res) => res.status(201).json(await reportIncident({ patientId: req.user.id, ...req.body, ip: req.ip }))));
patientMoneyRouter.post('/visits/:id/rating', validate(z.object({
  stars: z.number().int().min(1).max(5),
  tags: z.array(z.enum(['on_time', 'explained_clearly', 'respectful', 'felt_better', 'too_rushed', 'late'])).max(6).optional(),
  comment: z.string().trim().max(1000).optional(),
})), asyncHandler(async (req, res) => res.status(201).json(await rateVisit({ patientId: req.user.id, visitId: req.params.id, ...req.body }))));

// ---------- chat (patient ↔ physio, per plan) ----------
export const chatRouter = Router();
chatRouter.use(requireAuth);
async function chatPlan(req) {
  const p = await one(`SELECT id, patient_id, therapist_id, status FROM plans WHERE id = :id`, { id: req.params.planId });
  if (!p || (p.patient_id !== req.user.id && p.therapist_id !== req.user.id)) throw new HttpError(404, 'not_found', 'Conversation not found.');
  return p;
}
chatRouter.get('/:planId/messages', asyncHandler(async (req, res) => {
  const p = await chatPlan(req);
  const after = Number(req.query.after) || 0;
  const messages = await q(`SELECT id, sender_id, body, created_at FROM chat_messages WHERE plan_id = :p AND id > :after ORDER BY id LIMIT 200`, { p: p.id, after });
  res.json({ messages: messages.map(m => ({ ...m, id: Number(m.id), mine: m.sender_id === req.user.id })) });
}));
chatRouter.post('/:planId/messages', validate(z.object({ body: z.string().trim().min(1).max(1000) })), asyncHandler(async (req, res) => {
  const p = await chatPlan(req);
  if (['refunded', 'cancelled'].includes(p.status)) throw new HttpError(409, 'chat_closed', 'This conversation is closed.');
  const reason = contactCheck(req.body.body);
  if (reason) {
    await q(`INSERT INTO chat_blocked_attempts (plan_id, sender_id, body, reason) VALUES (:p, :u, :b, :r)`, { p: p.id, u: req.user.id, b: req.body.body, r: reason });
    throw new HttpError(422, 'contact_details_blocked', 'Phone numbers, UPI IDs and payment outside the app can’t be shared in chat. Use the call button; it connects you without sharing numbers.');
  }
  const [m] = await q(`INSERT INTO chat_messages (plan_id, sender_id, body) VALUES (:p, :u, :b) RETURNING id, created_at`, { p: p.id, u: req.user.id, b: req.body.body });
  res.status(201).json({ id: Number(m.id), createdAt: m.created_at });
}));

// ---------- admin: incidents, refunds, payouts, TDS, money rules ----------
export const adminMoneyRouter = Router();
adminMoneyRouter.use(requireAuth);
const ops = requireRole('ops_admin', 'super_admin');
const finance = requireRole('finance', 'super_admin');

adminMoneyRouter.get('/incidents', ops, asyncHandler(async (req, res) => {
  const status = ['open', 'upheld', 'dismissed'].includes(String(req.query.status)) ? String(req.query.status) : 'open';
  res.json({ incidents: await q(`SELECT i.id, i.category, i.severity, i.description, i.file_ids, i.status, i.decision_note, i.created_at, i.visit_id,
      pu.name AS patient_name, tu.name AS therapist_name, lower(v.during) AS visit_at
    FROM incidents i JOIN visits v ON v.id = i.visit_id JOIN users pu ON pu.id = i.reported_by LEFT JOIN users tu ON tu.id = i.against_user
    WHERE i.status = :s ORDER BY (i.severity = 'critical') DESC, i.created_at LIMIT 200`, { s: status }) });
}));
adminMoneyRouter.post('/incidents/:id/decide', ops, validate(z.object({ uphold: z.boolean(), note: z.string().trim().min(3).max(1000), refundPaise: z.number().int().min(0).max(10_000_000).optional() })),
  asyncHandler(async (req, res) => res.json(await decideIncident({ admin: req.user, incidentId: req.params.id, ...req.body, ip: req.ip }))));

adminMoneyRouter.get('/refunds', requireRole('ops_admin', 'finance', 'super_admin'), asyncHandler(async (req, res) => {
  const status = ['requested', 'approved', 'paid', 'rejected'].includes(String(req.query.status)) ? String(req.query.status) : 'requested';
  res.json({ refunds: await q(`SELECT r.id, r.amount_paise, r.reason, r.status, r.refund_to, r.reference, r.note, r.created_at, u.name AS patient_name, u.phone AS patient_phone
    FROM refunds r JOIN users u ON u.id = r.patient_id WHERE r.status = :s ORDER BY r.created_at LIMIT 200`, { s: status }) });
}));
adminMoneyRouter.post('/refunds/:id/decide', requireRole('ops_admin', 'finance', 'super_admin'), validate(z.object({ approve: z.boolean(), note: z.string().trim().max(500).optional() })),
  asyncHandler(async (req, res) => res.json(await decideRefund({ admin: req.user, refundId: req.params.id, ...req.body, ip: req.ip }))));
adminMoneyRouter.post('/refunds/:id/paid', finance, validate(z.object({ reference: z.string().trim().min(4).max(64) })),
  asyncHandler(async (req, res) => res.json(await markRefundPaid({ admin: req.user, refundId: req.params.id, reference: req.body.reference, ip: req.ip }))));

adminMoneyRouter.post('/payout-batches', finance, asyncHandler(async (req, res) => res.status(201).json(await buildPayoutBatch(req.user, req.ip))));
adminMoneyRouter.get('/payouts', finance, asyncHandler(async (req, res) => {
  await releaseDue();
  const status = req.query.status === 'paid' ? 'paid' : 'pending';
  res.json({ payouts: await q(`SELECT po.id, po.batch_id, po.amount_paise, po.tds_paise, po.status, po.method, po.reference, po.paid_at, po.created_at,
      u.name AS therapist_name, u.phone AS therapist_phone, (SELECT count(*)::int FROM ledger_entries le WHERE le.payout_id = po.id) AS sessions
    FROM payouts po JOIN users u ON u.id = po.therapist_id WHERE po.status = :s ORDER BY po.created_at DESC LIMIT 300`, { s: status }) });
}));
adminMoneyRouter.post('/payouts/:id/paid', finance, validate(z.object({ method: z.enum(['bank', 'upi']), reference: z.string().trim().min(4).max(64) })),
  asyncHandler(async (req, res) => res.json(await markPayoutPaid({ admin: req.user, payoutId: req.params.id, ...req.body, ip: req.ip }))));

// TDS deducted per physio in a period (for returns and certificates).
adminMoneyRouter.get('/tds', finance, asyncHandler(async (req, res) => {
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from)) ? String(req.query.from) : `${new Date().getUTCFullYear()}-04-01`;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to)) ? String(req.query.to) : new Date().toISOString().slice(0, 10);
  res.json({ from, to, rows: await q(`SELECT u.id, u.name, u.phone, sum(le.gross_paise)::int AS gross_paise, sum(le.fee_paise)::int AS fee_paise, sum(le.tds_paise)::int AS tds_paise, sum(le.net_paise)::int AS net_paise, count(*)::int AS sessions
    FROM ledger_entries le JOIN users u ON u.id = le.therapist_id
    WHERE le.status <> 'reversed' AND le.created_at >= :from::date AND le.created_at < :to::date + 1 GROUP BY u.id ORDER BY u.name`, { from, to }) });
}));

adminMoneyRouter.get('/money-rules', finance, asyncHandler(async (_req, res) => res.json({ rules: await moneyRules() })));
// Super admin only. Changes apply to new earnings; existing ones keep the rates they were created with.
adminMoneyRouter.put('/money-rules', requireRole('super_admin'), validate(z.object({
  platformFeePct: z.number().min(0).max(50), tdsPct: z.number().min(0).max(30), holdDays: z.number().int().min(0).max(30),
  minPayoutPaise: z.number().int().min(0).max(10_000_000), reportWindowDays: z.number().int().min(1).max(30),
})), asyncHandler(async (req, res) => {
  const before = await moneyRules();
  await q(`UPDATE app_settings SET value = :v, updated_by = :a, updated_at = now() WHERE key = 'money_rules'`, { v: JSON.stringify(req.body), a: req.user.id });
  await audit({ actor: req.user, action: 'money_rules.changed', targetType: 'setting', targetId: 'money_rules', before, after: req.body, ip: req.ip });
  res.json({ rules: req.body });
}));
