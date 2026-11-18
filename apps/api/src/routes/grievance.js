// Grievance redressal. Officer details and time limits come from .env (GRIEVANCE_*).
// Acknowledge within GRIEVANCE_ACK_HOURS (24 h), resolve within GRIEVANCE_RESOLVE_DAYS (15 days).
// Harassment and safety complaints go to the grievance committee only (with the super admin).
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config/index.js';
import { sequelize } from '../db/index.js';
import { HttpError } from '../lib/util.js';
import { asyncHandler, requireAuth, requireRole, validate } from '../middleware/index.js';
import { audit } from '../services/audit.js';

const q = async (sql, replacements, transaction) => (await sequelize.query(sql, { replacements, transaction }))[0];
const one = async (sql, replacements, transaction) => (await q(sql, replacements, transaction))[0];
const notify = (u, type, title, body, data, transaction) => q(`INSERT INTO notifications (user_id, type, title, body, data) VALUES (:u, :type, :title, :body, :data)`,
  { u, type, title, body: body ?? null, data: JSON.stringify(data ?? {}) }, transaction);

export const GRIEVANCE_CATEGORIES = ['service', 'physio_conduct', 'safety', 'harassment', 'payment', 'refund', 'privacy', 'app', 'other'];
const COMMITTEE_ONLY = ['harassment', 'safety'];
const officer = () => ({
  name: config.grievance.officerName, designation: config.grievance.officerDesignation,
  email: config.grievance.officerEmail || null, phone: config.grievance.officerPhone || null,
  address: config.grievance.address, hours: config.grievance.workingHours,
  ackHours: config.grievance.ackHours, resolveDays: config.grievance.resolveDays,
});

// ---------- public: who the grievance officer is (shown on the website and apps) ----------
export const publicRouter = Router();
publicRouter.get('/grievance-officer', (_req, res) => res.set('Cache-Control', 'public, max-age=300').json({ officer: officer(), categories: GRIEVANCE_CATEGORIES }));

// ---------- anyone signed in: file and follow complaints ----------
export const grievanceRouter = Router();
grievanceRouter.use(requireAuth);
grievanceRouter.post('/', validate(z.object({
  category: z.enum(GRIEVANCE_CATEGORIES),
  description: z.string().trim().min(20, 'Please describe the problem (at least 20 characters).').max(5000),
  visitId: z.string().uuid().optional(),
  fileIds: z.array(z.string().uuid()).max(5).optional(),
})), asyncHandler(async (req, res) => {
  const b = req.body;
  const result = await sequelize.transaction(async t => {
    let against = null;
    if (b.visitId) {
      const v = await one(`SELECT patient_id, therapist_id FROM visits WHERE id = :v AND (patient_id = :u OR therapist_id = :u)`, { v: b.visitId, u: req.user.id }, t);
      if (!v) throw new HttpError(404, 'not_found', 'Visit not found.');
      against = v.patient_id === req.user.id ? v.therapist_id : v.patient_id;
    }
    if (b.fileIds?.length) {
      const own = await one(`SELECT count(*)::int AS n FROM files WHERE id IN (:ids) AND owner_user_id = :u AND hidden_at IS NULL`, { ids: b.fileIds, u: req.user.id }, t);
      if (own.n !== b.fileIds.length) throw new HttpError(400, 'file_invalid', 'Upload the attachments first.');
    }
    const ticket = (await one(`SELECT 'GRV-' || to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYY') || '-' || lpad(nextval('grievance_seq')::text, 5, '0') AS no`, {}, t)).no;
    const g = await one(`INSERT INTO grievances (ticket_no, complainant_id, category, description, visit_id, against_user_id, file_ids, committee, ack_due_at, resolve_due_at)
      VALUES (:no, :u, :c, :d, :v, :a, :f::uuid[], :cm, now() + make_interval(hours => :ack), now() + make_interval(days => :res)) RETURNING id, ticket_no, ack_due_at, resolve_due_at`,
    { no: ticket, u: req.user.id, c: b.category, d: b.description, v: b.visitId ?? null, a: against, f: `{${(b.fileIds ?? []).join(',')}}`, cm: COMMITTEE_ONLY.includes(b.category), ack: config.grievance.ackHours, res: config.grievance.resolveDays }, t);
    await q(`INSERT INTO grievance_events (grievance_id, actor_id, kind, body, public) VALUES (:g, :u, 'created', :d, true)`, { g: g.id, u: req.user.id, d: b.description }, t);
    await notify(req.user.id, 'grievance_received', `Complaint ${g.ticket_no} received`, `We’ll acknowledge it within ${config.grievance.ackHours} hours and resolve it within ${config.grievance.resolveDays} days.`, { grievanceId: g.id }, t);
    return g;
  });
  res.status(201).json({ grievance: result, officer: officer() });
}));
grievanceRouter.get('/', asyncHandler(async (req, res) => {
  res.json({ grievances: await q(`SELECT id, ticket_no, category, status, created_at, ack_due_at, resolve_due_at, resolved_at, resolution FROM grievances WHERE complainant_id = :u ORDER BY created_at DESC`, { u: req.user.id }), officer: officer() });
}));
grievanceRouter.get('/:id', asyncHandler(async (req, res) => {
  const g = await one(`SELECT id, ticket_no, category, description, status, created_at, ack_due_at, resolve_due_at, acknowledged_at, resolved_at, resolution FROM grievances WHERE id = :id AND complainant_id = :u`, { id: req.params.id, u: req.user.id });
  if (!g) throw new HttpError(404, 'not_found', 'Complaint not found.');
  const events = await q(`SELECT kind, body, created_at FROM grievance_events WHERE grievance_id = :g AND public ORDER BY id`, { g: g.id });
  res.json({ grievance: g, events });
}));
grievanceRouter.post('/:id/reply', validate(z.object({ body: z.string().trim().min(2).max(3000) })), asyncHandler(async (req, res) => {
  const g = await one(`SELECT id, status FROM grievances WHERE id = :id AND complainant_id = :u`, { id: req.params.id, u: req.user.id });
  if (!g) throw new HttpError(404, 'not_found', 'Complaint not found.');
  if (['resolved', 'rejected'].includes(g.status)) throw new HttpError(409, 'closed', 'This complaint is closed. File a new one if you need to.');
  await q(`INSERT INTO grievance_events (grievance_id, actor_id, kind, body, public) VALUES (:g, :u, 'reply', :b, true)`, { g: g.id, u: req.user.id, b: req.body.body });
  res.status(201).json({ ok: true });
}));

// ---------- staff: handle complaints ----------
export const adminGrievanceRouter = Router();
adminGrievanceRouter.use(requireAuth, requireRole('grievance_committee', 'ops_admin', 'super_admin'));
// Ops see general complaints; committee-only complaints are visible to the committee and the super admin.
const canSeeCommittee = req => req.user.roles.some(r => r === 'grievance_committee' || r === 'super_admin');
async function load(req, t) {
  const g = await one(`SELECT g.*, c.name AS complainant_name, c.phone AS complainant_phone, a.name AS against_name, a.phone AS against_phone, s.name AS assigned_name
    FROM grievances g JOIN users c ON c.id = g.complainant_id LEFT JOIN users a ON a.id = g.against_user_id LEFT JOIN users s ON s.id = g.assigned_to WHERE g.id = :id`, { id: req.params.id }, t);
  if (!g || (g.committee && !canSeeCommittee(req))) throw new HttpError(404, 'not_found', 'Complaint not found.');
  return g;
}
adminGrievanceRouter.get('/', asyncHandler(async (req, res) => {
  const status = String(req.query.status ?? 'active');
  const rows = await q(`SELECT g.id, g.ticket_no, g.category, g.status, g.committee, g.created_at, g.ack_due_at, g.resolve_due_at, g.acknowledged_at, g.resolved_at,
      c.name AS complainant_name, a.name AS against_name, s.name AS assigned_name,
      (g.status NOT IN ('resolved', 'rejected') AND (g.resolve_due_at < now() OR (g.acknowledged_at IS NULL AND g.ack_due_at < now()))) AS overdue
    FROM grievances g JOIN users c ON c.id = g.complainant_id LEFT JOIN users a ON a.id = g.against_user_id LEFT JOIN users s ON s.id = g.assigned_to
    WHERE (:status = 'all' OR (:status = 'active' AND g.status NOT IN ('resolved', 'rejected')) OR g.status = :status)
      AND (:committee OR NOT g.committee)
    ORDER BY overdue DESC, g.resolve_due_at LIMIT 200`, { status, committee: canSeeCommittee(req) });
  const committee = await q(`SELECT u.id, u.name FROM users u JOIN user_roles r ON r.user_id = u.id WHERE r.role IN ('grievance_committee', 'super_admin') AND u.status = 'active' GROUP BY u.id ORDER BY u.name`);
  res.json({ grievances: rows, committee, officer: officer() });
}));
adminGrievanceRouter.get('/:id', asyncHandler(async (req, res) => {
  const g = await load(req);
  const events = await q(`SELECT e.id, e.kind, e.body, e.public, e.created_at, u.name AS actor_name FROM grievance_events e LEFT JOIN users u ON u.id = e.actor_id WHERE e.grievance_id = :g ORDER BY e.id`, { g: g.id });
  res.json({ grievance: g, events: events.map(e => ({ ...e, id: Number(e.id) })) });
}));
async function act(req, kind, { status, body, isPublic, set = '', extra = {}, notifyTitle }) {
  return sequelize.transaction(async t => {
    const g = await load(req, t);
    if (['resolved', 'rejected'].includes(g.status) && kind !== 'note') throw new HttpError(409, 'closed', 'This complaint is closed.');
    if (status || set) await q(`UPDATE grievances SET ${status ? 'status = :s,' : ''} ${set} updated_at = now() WHERE id = :id`, { s: status, id: g.id, ...extra }, t);
    await q(`INSERT INTO grievance_events (grievance_id, actor_id, kind, body, public) VALUES (:g, :a, :k, :b, :p)`, { g: g.id, a: req.user.id, k: kind, b: body ?? null, p: Boolean(isPublic) }, t);
    if (isPublic && notifyTitle) await notify(g.complainant_id, `grievance_${kind}`, notifyTitle.replace('{no}', g.ticket_no), body ?? null, { grievanceId: g.id }, t);
    await audit({ actor: req.user, action: `grievance.${kind}`, targetType: 'grievance', targetId: g.id, after: { status, body }, ip: req.ip }, t);
    return { ok: true };
  });
}
adminGrievanceRouter.post('/:id/acknowledge', validate(z.object({ message: z.string().trim().max(2000).optional() })), asyncHandler(async (req, res) => {
  res.json(await act(req, 'acknowledged', { status: 'acknowledged', set: 'acknowledged_at = COALESCE(acknowledged_at, now()),', body: req.body.message || `We have received your complaint and are looking into it. We will resolve it within ${config.grievance.resolveDays} days.`, isPublic: true, notifyTitle: 'Complaint {no} acknowledged' }));
}));
adminGrievanceRouter.post('/:id/assign', validate(z.object({ userId: z.string().uuid() })), asyncHandler(async (req, res) => {
  const ok = await one(`SELECT u.name FROM users u JOIN user_roles r ON r.user_id = u.id WHERE u.id = :u AND r.role IN ('grievance_committee', 'ops_admin', 'super_admin') LIMIT 1`, { u: req.body.userId });
  if (!ok) throw new HttpError(400, 'not_staff', 'Assign to a committee member or ops admin.');
  res.json(await act(req, 'assigned', { status: 'in_review', set: 'assigned_to = :to, acknowledged_at = COALESCE(acknowledged_at, now()),', extra: { to: req.body.userId }, body: `Assigned to ${ok.name}` }));
}));
adminGrievanceRouter.post('/:id/note', validate(z.object({ body: z.string().trim().min(2).max(5000), toComplainant: z.boolean().default(false) })), asyncHandler(async (req, res) => {
  res.json(await act(req, req.body.toComplainant ? 'reply' : 'note', { body: req.body.body, isPublic: req.body.toComplainant, notifyTitle: 'Update on complaint {no}' }));
}));
adminGrievanceRouter.post('/:id/escalate', validate(z.object({ reason: z.string().trim().min(5).max(2000) })), asyncHandler(async (req, res) => {
  res.json(await act(req, 'escalated', { set: 'committee = true,', body: req.body.reason }));
}));
adminGrievanceRouter.post('/:id/resolve', validate(z.object({ resolution: z.string().trim().min(10, 'Explain the outcome (at least 10 characters).').max(5000), reject: z.boolean().default(false) })), asyncHandler(async (req, res) => {
  const s = req.body.reject ? 'rejected' : 'resolved';
  res.json(await act(req, s, { status: s, set: 'resolved_at = now(), resolution = :r, acknowledged_at = COALESCE(acknowledged_at, now()),', extra: { r: req.body.resolution }, body: req.body.resolution, isPublic: true, notifyTitle: s === 'resolved' ? 'Complaint {no} resolved' : 'Complaint {no} closed' }));
}));
