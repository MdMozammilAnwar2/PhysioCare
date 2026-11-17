import { Router } from 'express';
import { z } from 'zod';
import { sequelize } from '../db/index.js';
import { HttpError } from '../lib/util.js';
import { asyncHandler, requireAuth, requireRole, validate } from '../middleware/index.js';
import { audit } from '../services/audit.js';
import { REQUIRED_DOCS } from './therapist.js';

export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole('ops_admin', 'super_admin', 'city_coordinator'));
const q = async (sql, replacements, transaction) => (await sequelize.query(sql, { replacements, transaction }))[0];
const one = async (sql, replacements, transaction) => (await q(sql, replacements, transaction))[0];
const notify = (u, type, title, body, transaction) => sequelize.query(`INSERT INTO notifications (user_id, type, title, body) VALUES (:u, :type, :title, :body)`, { replacements: { u, type, title, body }, transaction });

// ---------- verification ----------
adminRouter.get('/verification', asyncHandler(async (req, res) => {
  const status = ['applied', 'under_review', 'verified', 'suspended'].includes(String(req.query.status)) ? String(req.query.status) : 'under_review';
  const rows = await q(`SELECT u.id, u.name, u.phone, u.gender, tp.qualification, tp.years_experience, tp.specialisations, tp.submitted_at, tp.verification_status,
      (SELECT count(*)::int FROM (SELECT DISTINCT ON (type) status FROM therapist_documents d WHERE d.therapist_id = u.id ORDER BY type, created_at DESC) x WHERE x.status = 'approved') AS docs_approved
    FROM therapist_profiles tp JOIN users u ON u.id = tp.user_id WHERE tp.verification_status = :s ORDER BY tp.submitted_at NULLS LAST LIMIT 200`, { s: status });
  res.json({ therapists: rows, requiredDocuments: REQUIRED_DOCS.length });
}));

adminRouter.get('/therapists/:id', asyncHandler(async (req, res) => {
  const t = await one(`SELECT u.id, u.name, u.phone, u.gender, u.status, tp.* FROM users u JOIN therapist_profiles tp ON tp.user_id = u.id WHERE u.id = :id`, { id: req.params.id });
  if (!t) throw new HttpError(404, 'not_found', 'Therapist not found.');
  const documents = await q(`SELECT DISTINCT ON (d.type) d.id, d.type, d.status, d.review_note, d.expires_on, d.created_at, f.id AS file_id, f.mime_type, f.original_name
    FROM therapist_documents d JOIN files f ON f.id = d.file_id WHERE d.therapist_id = :id ORDER BY d.type, d.created_at DESC`, { id: t.id });
  const agreement = await one(`SELECT version, created_at, meta FROM consents WHERE user_id = :id AND document = 'partner_agreement' AND accepted ORDER BY created_at DESC LIMIT 1`, { id: t.id });
  res.json({ therapist: t, documents, agreement, requiredDocuments: REQUIRED_DOCS });
}));

adminRouter.post('/documents/:id/review', validate(z.object({ approve: z.boolean(), note: z.string().trim().max(300).optional() })), asyncHandler(async (req, res) => {
  const d = await one(`SELECT id, therapist_id, type, status FROM therapist_documents WHERE id = :id`, { id: req.params.id });
  if (!d) throw new HttpError(404, 'not_found', 'Document not found.');
  if (!req.body.approve && !req.body.note) throw new HttpError(400, 'note_required', 'Tell the physio what to fix.');
  await sequelize.transaction(async t => {
    await q(`UPDATE therapist_documents SET status = :s, review_note = :n, reviewed_by = :a, reviewed_at = now() WHERE id = :id`, { s: req.body.approve ? 'approved' : 'rejected', n: req.body.note ?? null, a: req.user.id, id: d.id }, t);
    if (!req.body.approve) await notify(d.therapist_id, 'document_rejected', 'Please upload a document again', req.body.note, t);
    await audit({ actor: req.user, action: req.body.approve ? 'document.approved' : 'document.rejected', targetType: 'therapist_document', targetId: d.id, after: { type: d.type, note: req.body.note }, ip: req.ip }, t);
  });
  res.json({ status: req.body.approve ? 'approved' : 'rejected' });
}));

adminRouter.post('/therapists/:id/verify', validate(z.object({ approve: z.boolean(), note: z.string().trim().max(500).optional() })), asyncHandler(async (req, res) => {
  const t = await one(`SELECT verification_status FROM therapist_profiles WHERE user_id = :id`, { id: req.params.id });
  if (!t) throw new HttpError(404, 'not_found', 'Therapist not found.');
  if (t.verification_status !== 'under_review') throw new HttpError(409, 'not_under_review', 'Only submitted applications can be decided.');
  if (req.body.approve) {
    const docs = await q(`SELECT DISTINCT ON (type) type, status FROM therapist_documents WHERE therapist_id = :id ORDER BY type, created_at DESC`, { id: req.params.id });
    const notApproved = REQUIRED_DOCS.filter(type => !docs.some(d => d.type === type && d.status === 'approved'));
    if (notApproved.length) throw new HttpError(409, 'documents_not_approved', 'Approve every document first.', { notApproved });
  } else if (!req.body.note) throw new HttpError(400, 'note_required', 'Give a reason; the physio will see it.');
  await sequelize.transaction(async tx => {
    await q(`UPDATE therapist_profiles SET verification_status = :s, verified_at = CASE WHEN :ok THEN now() END, verified_by = CASE WHEN :ok THEN :a::uuid END, review_note = :n, updated_at = now() WHERE user_id = :id`,
      { s: req.body.approve ? 'verified' : 'applied', ok: req.body.approve, a: req.user.id, n: req.body.note ?? null, id: req.params.id }, tx);
    await notify(req.params.id, req.body.approve ? 'verified' : 'verification_returned', req.body.approve ? 'You’re verified' : 'Your application needs changes',
      req.body.approve ? 'You can now set your hours and start getting patients.' : req.body.note, tx);
    await audit({ actor: req.user, action: req.body.approve ? 'therapist.verified' : 'therapist.returned', targetType: 'user', targetId: req.params.id, before: { status: 'under_review' }, after: { status: req.body.approve ? 'verified' : 'applied', note: req.body.note }, ip: req.ip }, tx);
  });
  res.json({ status: req.body.approve ? 'verified' : 'applied' });
}));

// ---------- live visits and SOS ----------
adminRouter.get('/live-visits', asyncHandler(async (_req, res) => {
  const visits = await q(`SELECT v.id, v.status, v.mode, lower(v.during) AS starts_at, upper(v.during) AS ends_at, v.checked_in_at,
      tu.name AS therapist_name, z.name AS zone_name, z.color AS zone_color,
      (now() > upper(v.during) AND v.status = 'checked_in') AS overrun,
      loc.lat, loc.lng, loc.recorded_at AS location_at
    FROM visits v JOIN users tu ON tu.id = v.therapist_id LEFT JOIN zones z ON z.id = v.zone_id
      LEFT JOIN LATERAL (SELECT lat, lng, recorded_at FROM visit_locations l WHERE l.visit_id = v.id ORDER BY recorded_at DESC LIMIT 1) loc ON true
    WHERE v.status IN ('on_the_way', 'checked_in') ORDER BY lower(v.during)`);
  const sos = await q(`SELECT s.id, s.status, s.lat, s.lng, s.created_at, s.visit_id, u.name AS raised_by_name, u.phone AS raised_by_phone
    FROM sos_events s JOIN users u ON u.id = s.raised_by WHERE s.status <> 'resolved' ORDER BY s.created_at`);
  res.json({ sos, visits });
}));

adminRouter.post('/sos/:id/acknowledge', asyncHandler(async (req, res) => {
  const [row] = await q(`UPDATE sos_events SET status = 'acknowledged', acknowledged_by = :a, acknowledged_at = now() WHERE id = :id AND status = 'open' RETURNING id, created_at, acknowledged_at`, { a: req.user.id, id: req.params.id });
  if (!row) throw new HttpError(409, 'not_open', 'Already acknowledged or resolved.');
  await audit({ actor: req.user, action: 'sos.acknowledged', targetType: 'sos', targetId: row.id, after: { responseSeconds: Math.round((new Date(row.acknowledged_at) - new Date(row.created_at)) / 1000) }, ip: req.ip });
  res.json({ status: 'acknowledged' });
}));

adminRouter.post('/sos/:id/resolve', validate(z.object({ note: z.string().trim().min(3).max(1000) })), asyncHandler(async (req, res) => {
  const [row] = await q(`UPDATE sos_events SET status = 'resolved', resolved_by = :a, resolved_at = now(), resolution_note = :n,
      acknowledged_by = COALESCE(acknowledged_by, :a), acknowledged_at = COALESCE(acknowledged_at, now()) WHERE id = :id AND status <> 'resolved' RETURNING id`, { a: req.user.id, n: req.body.note, id: req.params.id });
  if (!row) throw new HttpError(409, 'already_resolved', 'Already resolved.');
  await audit({ actor: req.user, action: 'sos.resolved', targetType: 'sos', targetId: row.id, after: { note: req.body.note }, ip: req.ip });
  res.json({ status: 'resolved' });
}));
