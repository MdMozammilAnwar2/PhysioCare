// Phase 5 · Control: users and blocks, staff and roles, zones, platform settings, audit log, dashboard.
// Super admin can never be created, given or blocked through the API.
import { Router } from 'express';
import { z } from 'zod';
import { ADMIN_ROLES, ASSIGNABLE_STAFF_ROLES } from '@physioconnect/shared';
import { sequelize } from '../db/index.js';
import { HttpError, normalizeIndianPhone } from '../lib/util.js';
import { asyncHandler, requireAuth, requireRole, validate } from '../middleware/index.js';
import { audit } from '../services/audit.js';
import { schedulingRules } from '../services/rules.js';

const q = async (sql, replacements, transaction) => (await sequelize.query(sql, { replacements, transaction }))[0];
const one = async (sql, replacements, transaction) => (await q(sql, replacements, transaction))[0];
const notify = (u, type, title, body, data, transaction) => q(`INSERT INTO notifications (user_id, type, title, body, data) VALUES (:u, :type, :title, :body, :data)`,
  { u, type, title, body: body ?? null, data: JSON.stringify(data ?? {}) }, transaction);
const phoneField = z.string().transform((v, ctx) => normalizeIndianPhone(v) ?? (ctx.addIssue({ code: 'custom', message: 'Enter a valid Indian mobile number.' }), z.NEVER));
// Staff who may see people and operations data. Content editors only manage the website.
const PEOPLE_ROLES = ADMIN_ROLES.filter(r => r !== 'content_editor');
const isSuper = req => req.user.roles.includes('super_admin');

export const BLOCK_REASONS = ['fraud', 'abuse', 'harassment', 'safety', 'no_show_repeat', 'payment_default', 'fake_documents', 'off_platform', 'spam', 'legal', 'other'];

export const controlRouter = Router();
controlRouter.use(requireAuth);
const staff = requireRole('ops_admin', 'city_coordinator', 'super_admin');
const superOnly = requireRole('super_admin');

// ---------- users and blocks ----------
controlRouter.get('/users', requireRole(...PEOPLE_ROLES), asyncHandler(async (req, res) => {
  const term = String(req.query.q ?? '').trim();
  const role = String(req.query.role ?? '');
  const status = String(req.query.status ?? '');
  const users = await q(`SELECT u.id, u.name, u.phone, u.gender, u.status, u.created_at, u.last_login_at,
      COALESCE(array_agg(r.role::text) FILTER (WHERE r.role IS NOT NULL), '{}') AS roles,
      (SELECT jsonb_build_object('reason', b.reason_code, 'note', b.note, 'endsAt', b.ends_at, 'at', b.created_at) FROM blocks b WHERE b.user_id = u.id AND b.lifted_at IS NULL ORDER BY b.created_at DESC LIMIT 1) AS block
    FROM users u LEFT JOIN user_roles r ON r.user_id = u.id
    WHERE (:t = '' OR u.phone ILIKE :like OR u.name ILIKE :like)
      AND (:status = '' OR u.status::text = :status)
    GROUP BY u.id
    HAVING (:role = '' OR :role = ANY(array_agg(r.role::text)))
    ORDER BY u.created_at DESC LIMIT 100`, { t: term, like: `%${term}%`, role, status });
  res.json({ users });
}));

controlRouter.get('/users/:id', requireRole(...PEOPLE_ROLES), asyncHandler(async (req, res) => {
  const u = await one(`SELECT id, name, phone, gender, status, created_at, last_login_at FROM users WHERE id = :id`, { id: req.params.id });
  if (!u) throw new HttpError(404, 'not_found', 'User not found.');
  const [roles, blocks, personal, visits] = await Promise.all([
    q(`SELECT role FROM user_roles WHERE user_id = :id`, { id: u.id }),
    q(`SELECT b.id, b.reason_code, b.note, b.ends_at, b.until_review, b.created_at, b.lifted_at, b.lift_note, bu.name AS blocked_by_name, lu.name AS lifted_by_name
       FROM blocks b LEFT JOIN users bu ON bu.id = b.blocked_by LEFT JOIN users lu ON lu.id = b.lifted_by WHERE b.user_id = :id ORDER BY b.created_at DESC`, { id: u.id }),
    q(`SELECT pb.blocker_id, pb.blocked_id, pb.reason_code, pb.note, pb.created_at, a.name AS blocker_name, b.name AS blocked_name
       FROM personal_blocks pb JOIN users a ON a.id = pb.blocker_id JOIN users b ON b.id = pb.blocked_id WHERE pb.blocker_id = :id OR pb.blocked_id = :id ORDER BY pb.created_at DESC`, { id: u.id }),
    one(`SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'completed')::int AS completed FROM visits WHERE patient_id = :id OR therapist_id = :id`, { id: u.id }),
  ]);
  res.json({ user: { ...u, roles: roles.map(r => r.role) }, blocks, personalBlocks: personal, visits, reasons: BLOCK_REASONS });
}));

controlRouter.post('/users/:id/block', staff, validate(z.object({
  reasonCode: z.enum(BLOCK_REASONS),
  note: z.string().trim().min(5, 'Write what happened (at least 5 characters).').max(2000),
  days: z.number().int().min(1).max(3650).optional(), // empty = until reviewed / permanent
})), asyncHandler(async (req, res) => {
  const target = await one(`SELECT u.id, u.status, COALESCE(array_agg(r.role::text) FILTER (WHERE r.role IS NOT NULL), '{}') AS roles FROM users u LEFT JOIN user_roles r ON r.user_id = u.id WHERE u.id = :id GROUP BY u.id`, { id: req.params.id });
  if (!target) throw new HttpError(404, 'not_found', 'User not found.');
  if (target.id === req.user.id) throw new HttpError(409, 'self_block', 'You can’t block yourself.');
  if (target.roles.includes('super_admin')) throw new HttpError(403, 'protected_account', 'A super admin account can’t be blocked from the app.');
  if (target.roles.some(r => ADMIN_ROLES.includes(r)) && !isSuper(req)) throw new HttpError(403, 'forbidden', 'Only a super admin can block staff.');
  await sequelize.transaction(async t => {
    const b = await one(`INSERT INTO blocks (user_id, reason_code, note, ends_at, until_review, blocked_by) VALUES (:u, :r, :n, :ends, :review, :by) RETURNING id`,
      { u: target.id, r: req.body.reasonCode, n: req.body.note, ends: req.body.days ? new Date(Date.now() + req.body.days * 864e5) : null, review: !req.body.days, by: req.user.id }, t);
    await q(`UPDATE users SET status = 'blocked', updated_at = now() WHERE id = :u`, { u: target.id }, t);
    await q(`UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = :u AND revoked_at IS NULL`, { u: target.id }, t); // signs them out everywhere
    // A blocked physio stops getting new bookings; their upcoming visits are flagged for ops to reassign.
    await q(`UPDATE therapist_profiles SET accepting = false WHERE user_id = :u`, { u: target.id }, t);
    await audit({ actor: req.user, action: 'user.blocked', targetType: 'user', targetId: target.id, before: { status: target.status }, after: { blockId: b.id, ...req.body }, ip: req.ip }, t);
  });
  res.json({ status: 'blocked' });
}));

controlRouter.post('/users/:id/unblock', staff, validate(z.object({ note: z.string().trim().min(3).max(2000) })), asyncHandler(async (req, res) => {
  const target = await one(`SELECT u.id, u.status, COALESCE(array_agg(r.role::text) FILTER (WHERE r.role IS NOT NULL), '{}') AS roles FROM users u LEFT JOIN user_roles r ON r.user_id = u.id WHERE u.id = :id GROUP BY u.id`, { id: req.params.id });
  if (!target) throw new HttpError(404, 'not_found', 'User not found.');
  if (target.status !== 'blocked') throw new HttpError(409, 'not_blocked', 'This account isn’t blocked.');
  if (target.roles.some(r => ADMIN_ROLES.includes(r)) && !isSuper(req)) throw new HttpError(403, 'forbidden', 'Only a super admin can unblock staff.');
  await sequelize.transaction(async t => {
    await q(`UPDATE blocks SET lifted_at = now(), lifted_by = :a, lift_note = :n WHERE user_id = :u AND lifted_at IS NULL`, { a: req.user.id, n: req.body.note, u: target.id }, t);
    await q(`UPDATE users SET status = 'active', updated_at = now() WHERE id = :u`, { u: target.id }, t);
    await notify(target.id, 'account_unblocked', 'Your account is active again', req.body.note, {}, t);
    await audit({ actor: req.user, action: 'user.unblocked', targetType: 'user', targetId: target.id, after: { note: req.body.note }, ip: req.ip }, t);
  });
  res.json({ status: 'active' });
}));

controlRouter.get('/blocks', requireRole(...PEOPLE_ROLES), asyncHandler(async (req, res) => {
  const active = req.query.active !== '0';
  res.json({ blocks: await q(`SELECT b.id, b.user_id, u.name, u.phone, b.reason_code, b.note, b.ends_at, b.until_review, b.created_at, b.lifted_at, b.lift_note, bu.name AS blocked_by_name,
      COALESCE((SELECT array_agg(role::text) FROM user_roles r WHERE r.user_id = u.id), '{}') AS roles
    FROM blocks b JOIN users u ON u.id = b.user_id LEFT JOIN users bu ON bu.id = b.blocked_by
    WHERE ${active ? 'b.lifted_at IS NULL' : 'b.lifted_at IS NOT NULL'} ORDER BY b.created_at DESC LIMIT 200`) });
}));

// Personal blocks (physio ↔ patient), for review.
controlRouter.get('/personal-blocks', requireRole(...PEOPLE_ROLES), asyncHandler(async (_req, res) => {
  res.json({ blocks: await q(`SELECT pb.blocker_id, pb.blocked_id, pb.reason_code, pb.note, pb.created_at, a.name AS blocker_name, a.phone AS blocker_phone, b.name AS blocked_name, b.phone AS blocked_phone
    FROM personal_blocks pb JOIN users a ON a.id = pb.blocker_id JOIN users b ON b.id = pb.blocked_id ORDER BY pb.created_at DESC LIMIT 200`) });
}));

// ---------- staff and roles (super admin only) ----------
controlRouter.get('/staff', superOnly, asyncHandler(async (_req, res) => {
  res.json({ roles: ASSIGNABLE_STAFF_ROLES, staff: await q(`SELECT u.id, u.name, u.phone, u.status, u.last_login_at, array_agg(r.role::text ORDER BY r.role) AS roles
    FROM users u JOIN user_roles r ON r.user_id = u.id WHERE r.role::text IN (:admin) GROUP BY u.id ORDER BY u.name NULLS LAST`, { admin: ADMIN_ROLES }) });
}));
controlRouter.post('/staff', superOnly, validate(z.object({ phone: phoneField, name: z.string().trim().min(2).max(120).optional(), role: z.enum(ASSIGNABLE_STAFF_ROLES) })),
  asyncHandler(async (req, res) => {
    const result = await sequelize.transaction(async t => {
      let u = await one(`SELECT id, name FROM users WHERE phone = :p`, { p: req.body.phone }, t);
      if (!u) u = await one(`INSERT INTO users (phone, name) VALUES (:p, :n) RETURNING id, name`, { p: req.body.phone, n: req.body.name ?? null }, t);
      else if (req.body.name && !u.name) await q(`UPDATE users SET name = :n WHERE id = :id`, { n: req.body.name, id: u.id }, t);
      await q(`INSERT INTO user_roles (user_id, role) VALUES (:u, :r) ON CONFLICT DO NOTHING`, { u: u.id, r: req.body.role }, t);
      await audit({ actor: req.user, action: 'staff.role_given', targetType: 'user', targetId: u.id, after: { role: req.body.role }, ip: req.ip }, t);
      return { userId: u.id };
    });
    res.status(201).json(result);
  }));
controlRouter.delete('/staff/:id/roles/:role', superOnly, asyncHandler(async (req, res) => {
  if (!ASSIGNABLE_STAFF_ROLES.includes(req.params.role)) throw new HttpError(403, 'protected_role', 'This role can’t be changed from the app.');
  const rows = await q(`DELETE FROM user_roles WHERE user_id = :u AND role::text = :r RETURNING user_id`, { u: req.params.id, r: req.params.role });
  if (!rows.length) throw new HttpError(404, 'not_found', 'This person doesn’t have that role.');
  await q(`UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = :u AND revoked_at IS NULL`, { u: req.params.id });
  await audit({ actor: req.user, action: 'staff.role_removed', targetType: 'user', targetId: req.params.id, after: { role: req.params.role }, ip: req.ip });
  res.status(204).end();
}));

// ---------- zones ----------
const ZONE_COLORS = ['green', 'blue', 'yellow', 'orange', 'red'];
controlRouter.get('/zones', requireRole(...PEOPLE_ROLES), asyncHandler(async (_req, res) => {
  const zones = await q(`SELECT z.id, z.name, z.color, z.reason, z.review_on, z.center_lat, z.center_lng, z.radius_km::float AS radius_km, z.updated_at, c.name AS city, c.id AS city_id,
      (SELECT count(*)::int FROM visits v WHERE v.zone_id = z.id AND lower(v.during) >= now() AND v.status IN ('booked', 'on_the_way', 'checked_in')) AS upcoming
    FROM zones z JOIN cities c ON c.id = z.city_id ORDER BY c.name, z.name`);
  const cities = await q(`SELECT id, name, status FROM cities ORDER BY name`);
  res.json({ zones, cities, colors: ZONE_COLORS });
}));
const zoneShape = { centerLat: z.number().min(20).max(30), centerLng: z.number().min(80).max(90), radiusKm: z.number().min(0.2).max(30) };
controlRouter.post('/zones', staff, validate(z.object({ cityId: z.string().uuid(), name: z.string().trim().min(2).max(80), color: z.enum(ZONE_COLORS), reason: z.string().trim().min(3).max(500), ...zoneShape })),
  asyncHandler(async (req, res) => {
    const b = req.body;
    try {
      const zone = await one(`INSERT INTO zones (city_id, name, color, reason, center_lat, center_lng, radius_km, updated_by) VALUES (:c, :n, :col, :r, :lat, :lng, :rad, :a) RETURNING id`,
        { c: b.cityId, n: b.name, col: b.color, r: b.reason, lat: b.centerLat, lng: b.centerLng, rad: b.radiusKm, a: req.user.id });
      await q(`INSERT INTO zone_changes (zone_id, to_color, reason, changed_by) VALUES (:z, :c, :r, :a)`, { z: zone.id, c: b.color, r: b.reason, a: req.user.id });
      await audit({ actor: req.user, action: 'zone.created', targetType: 'zone', targetId: zone.id, after: b, ip: req.ip });
      res.status(201).json({ id: zone.id });
    } catch (e) {
      if (e.name === 'SequelizeUniqueConstraintError') throw new HttpError(409, 'zone_exists', 'A zone with this name already exists in this city.');
      throw e;
    }
  }));
controlRouter.patch('/zones/:id', staff, validate(z.object({
  color: z.enum(ZONE_COLORS).optional(), reason: z.string().trim().min(3).max(500), reviewOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  centerLat: zoneShape.centerLat.optional(), centerLng: zoneShape.centerLng.optional(), radiusKm: zoneShape.radiusKm.optional(),
})), asyncHandler(async (req, res) => {
  const z0 = await one(`SELECT * FROM zones WHERE id = :id`, { id: req.params.id });
  if (!z0) throw new HttpError(404, 'not_found', 'Zone not found.');
  const b = req.body;
  // Turning a zone Red stops new bookings; only a super admin may do it.
  if (b.color === 'red' && z0.color !== 'red' && !isSuper(req)) throw new HttpError(403, 'super_admin_only', 'Only a super admin can turn a zone Red.');
  await sequelize.transaction(async t => {
    await q(`UPDATE zones SET color = COALESCE(:col, color), reason = :r, review_on = CASE WHEN :setReview THEN :review::date ELSE review_on END,
        center_lat = COALESCE(:lat, center_lat), center_lng = COALESCE(:lng, center_lng), radius_km = COALESCE(:rad, radius_km), updated_by = :a, updated_at = now() WHERE id = :id`,
    { col: b.color ?? null, r: b.reason, setReview: b.reviewOn !== undefined, review: b.reviewOn ?? null, lat: b.centerLat ?? null, lng: b.centerLng ?? null, rad: b.radiusKm ?? null, a: req.user.id, id: z0.id }, t);
    if (b.color && b.color !== z0.color) await q(`INSERT INTO zone_changes (zone_id, from_color, to_color, reason, changed_by) VALUES (:z, :f, :c, :r, :a)`, { z: z0.id, f: z0.color, c: b.color, r: b.reason, a: req.user.id }, t);
    await audit({ actor: req.user, action: 'zone.updated', targetType: 'zone', targetId: z0.id, before: { color: z0.color, radiusKm: z0.radius_km }, after: b, ip: req.ip }, t);
  });
  res.json({ ok: true });
}));
controlRouter.get('/zones/:id/history', requireRole(...PEOPLE_ROLES), asyncHandler(async (req, res) => {
  res.json({ changes: await q(`SELECT zc.from_color, zc.to_color, zc.reason, zc.created_at, u.name AS changed_by FROM zone_changes zc LEFT JOIN users u ON u.id = zc.changed_by WHERE zc.zone_id = :id ORDER BY zc.created_at DESC`, { id: req.params.id }) });
}));

// ---------- platform settings (super admin) ----------
controlRouter.get('/settings', requireRole(...PEOPLE_ROLES), asyncHandler(async (_req, res) => {
  const rows = await q(`SELECT key, value, updated_at FROM app_settings WHERE key IN ('maintenance', 'min_app_version')`);
  res.json({ ...Object.fromEntries(rows.map(r => [r.key, r.value])), scheduling: await schedulingRules() });
}));
controlRouter.put('/settings/maintenance', superOnly, validate(z.object({ enabled: z.boolean(), message: z.string().trim().max(300).nullable().optional() })), asyncHandler(async (req, res) => {
  const value = { enabled: req.body.enabled, message: req.body.message || null };
  await q(`UPDATE app_settings SET value = :v, updated_by = :a, updated_at = now() WHERE key = 'maintenance'`, { v: JSON.stringify(value), a: req.user.id });
  await audit({ actor: req.user, action: value.enabled ? 'maintenance.on' : 'maintenance.off', targetType: 'settings', targetId: 'maintenance', after: value, ip: req.ip });
  res.json({ maintenance: value });
}));
const semver = z.string().regex(/^\d+\.\d+\.\d+$/, 'Use a version like 0.6.0');
controlRouter.put('/settings/min-app-version', superOnly, validate(z.object({ patient: semver, therapist: semver, partner: semver, super_admin: semver })), asyncHandler(async (req, res) => {
  await q(`UPDATE app_settings SET value = :v, updated_by = :a, updated_at = now() WHERE key = 'min_app_version'`, { v: JSON.stringify(req.body), a: req.user.id });
  await audit({ actor: req.user, action: 'min_app_version.updated', targetType: 'settings', targetId: 'min_app_version', after: req.body, ip: req.ip });
  res.json({ min_app_version: req.body });
}));
const positive = z.number().int().min(0).max(10_000);
controlRouter.put('/settings/scheduling', superOnly, validate(z.object({
  visitMinutes: z.object({ home: positive, video: positive, clinic: positive }),
  travelBufferMinutes: positive, bookingWindowDays: positive, minNoticeHours: positive, paymentHoldMinutes: positive,
  offerHoldMinutes: positive, minDaysBetweenSessions: positive, maxVisitsPerDay: positive, freeRescheduleHours: positive,
})), asyncHandler(async (req, res) => {
  await q(`INSERT INTO scheduling_rules (rules, created_by) VALUES (:r, :a)`, { r: JSON.stringify(req.body), a: req.user.id });
  await audit({ actor: req.user, action: 'scheduling_rules.updated', targetType: 'settings', targetId: 'scheduling', after: req.body, ip: req.ip });
  res.json({ scheduling: req.body });
}));

// ---------- audit log (super admin) ----------
controlRouter.get('/audit', superOnly, asyncHandler(async (req, res) => {
  const action = String(req.query.action ?? '').trim();
  const target = String(req.query.target ?? '').trim();
  const before = Number(req.query.before) || null;
  const rows = await q(`SELECT a.id, a.action, a.target_type, a.target_id, a.before, a.after, a.ip::text AS ip, a.created_at, a.actor_role, u.name AS actor_name, u.phone AS actor_phone
    FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id
    WHERE (:action = '' OR a.action ILIKE :actionLike) AND (:target = '' OR a.target_id = :target) AND (:before::bigint IS NULL OR a.id < :before::bigint)
    ORDER BY a.id DESC LIMIT 100`, { action, actionLike: `%${action}%`, target, before });
  res.json({ entries: rows.map(r => ({ ...r, id: Number(r.id) })) });
}));

// ---------- dashboard (every staff role; the page shows what the role needs) ----------
controlRouter.get('/dashboard', requireRole(...ADMIN_ROLES), asyncHandler(async (req, res) => {
  const istToday = `(now() AT TIME ZONE 'Asia/Kolkata')::date`;
  const [today, queues, growth, money, trend] = await Promise.all([
    one(`SELECT count(*)::int AS visits,
        count(*) FILTER (WHERE status = 'completed')::int AS completed,
        count(*) FILTER (WHERE status IN ('on_the_way', 'checked_in'))::int AS live,
        count(*) FILTER (WHERE status IN ('cancelled', 'late_cancelled', 'no_show'))::int AS lost
      FROM visits WHERE (lower(during) AT TIME ZONE 'Asia/Kolkata')::date = ${istToday} AND status <> 'held'`),
    one(`SELECT
        (SELECT count(*)::int FROM sos_events WHERE status IN ('open', 'acknowledged')) AS sos,
        (SELECT count(*)::int FROM therapist_profiles WHERE verification_status = 'under_review') AS verifications,
        (SELECT count(*)::int FROM payments WHERE status = 'submitted') AS payments,
        (SELECT count(*)::int FROM incidents WHERE status = 'open') AS incidents,
        (SELECT count(*)::int FROM refunds WHERE status IN ('requested', 'approved')) AS refunds,
        (SELECT count(*)::int FROM partner_orgs WHERE status = 'pending') AS partners,
        (SELECT count(*)::int FROM grievances WHERE status NOT IN ('resolved', 'rejected')) AS grievances,
        (SELECT count(*)::int FROM grievances WHERE status NOT IN ('resolved', 'rejected') AND (resolve_due_at < now() OR (acknowledged_at IS NULL AND ack_due_at < now()))) AS grievances_overdue,
        (SELECT count(*)::int FROM blocks WHERE lifted_at IS NULL) AS blocked`),
    one(`SELECT
        (SELECT count(*)::int FROM users WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date = ${istToday}) AS signups_today,
        (SELECT count(*)::int FROM users WHERE created_at >= now() - interval '7 days') AS signups_7d,
        (SELECT count(*)::int FROM attributions WHERE locked_at >= now() - interval '7 days') AS first_paid_7d,
        (SELECT count(*)::int FROM therapist_profiles WHERE verification_status = 'verified') AS physios_verified,
        (SELECT count(*)::int FROM partner_orgs WHERE status = 'approved') AS partners_active`),
    one(`SELECT
        (SELECT COALESCE(sum(amount_paise), 0)::bigint FROM payments WHERE status = 'paid' AND verified_at >= now() - interval '7 days') AS collected_7d,
        (SELECT COALESCE(sum(amount_paise), 0)::bigint FROM payments WHERE status = 'paid' AND verified_at >= now() - interval '30 days') AS collected_30d,
        (SELECT COALESCE(sum(amount_paise), 0)::bigint FROM payments WHERE status IN ('pending', 'submitted')) AS outstanding,
        (SELECT COALESCE(sum(amount_paise), 0)::bigint FROM payouts WHERE status = 'pending') AS payouts_due,
        (SELECT COALESCE(sum(amount_paise), 0)::bigint FROM refunds WHERE status = 'approved') AS refunds_due,
        (SELECT COALESCE(sum(amount_paise), 0)::bigint FROM partner_rewards WHERE status = 'earned') AS partner_rewards_due`),
    q(`SELECT to_char(d, 'YYYY-MM-DD') AS day,
        (SELECT count(*)::int FROM visits v WHERE (lower(v.during) AT TIME ZONE 'Asia/Kolkata')::date = d AND v.status = 'completed') AS completed,
        (SELECT COALESCE(sum(amount_paise), 0)::bigint FROM payments p WHERE p.status = 'paid' AND (p.verified_at AT TIME ZONE 'Asia/Kolkata')::date = d) AS collected
      FROM generate_series(${istToday} - 13, ${istToday}, interval '1 day') d ORDER BY d`),
  ]);
  const toNum = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Number(v)]));
  res.json({ today, queues, growth, money: toNum(money), trend: trend.map(t => ({ ...t, collected: Number(t.collected) })) });
}));

// ---------- personal blocks by physios and patients ----------
export const personalBlocksRouter = Router();
personalBlocksRouter.use(requireAuth, requireRole('therapist', 'patient'));
personalBlocksRouter.get('/', asyncHandler(async (req, res) => {
  res.json({ blocks: await q(`SELECT pb.blocked_id, u.name, pb.reason_code, pb.note, pb.created_at FROM personal_blocks pb JOIN users u ON u.id = pb.blocked_id WHERE pb.blocker_id = :u ORDER BY pb.created_at DESC`, { u: req.user.id }) });
}));
personalBlocksRouter.post('/', validate(z.object({ userId: z.string().uuid(), reasonCode: z.enum(['abuse', 'harassment', 'safety', 'no_show_repeat', 'payment_default', 'unsafe_home', 'other']), note: z.string().trim().max(1000).optional() })),
  asyncHandler(async (req, res) => {
    // You can block only someone you've had a booking with.
    const had = await one(`SELECT 1 AS x FROM visits WHERE (patient_id = :me AND therapist_id = :o) OR (therapist_id = :me AND patient_id = :o) LIMIT 1`, { me: req.user.id, o: req.body.userId });
    if (!had) throw new HttpError(404, 'not_found', 'You can only block someone you’ve had a booking with.');
    await q(`INSERT INTO personal_blocks (blocker_id, blocked_id, reason_code, note) VALUES (:me, :o, :r, :n) ON CONFLICT (blocker_id, blocked_id) DO UPDATE SET reason_code = EXCLUDED.reason_code, note = EXCLUDED.note`,
      { me: req.user.id, o: req.body.userId, r: req.body.reasonCode, n: req.body.note ?? null });
    await audit({ actor: req.user, action: 'personal_block.added', targetType: 'user', targetId: req.body.userId, after: { reasonCode: req.body.reasonCode }, ip: req.ip });
    res.status(201).json({ ok: true, message: 'Done. You won’t be matched with each other again. Our team reviews every block.' });
  }));
personalBlocksRouter.delete('/:userId', asyncHandler(async (req, res) => {
  await q(`DELETE FROM personal_blocks WHERE blocker_id = :me AND blocked_id = :o`, { me: req.user.id, o: req.params.userId });
  res.status(204).end();
}));
