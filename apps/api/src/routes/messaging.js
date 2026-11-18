// Phase 8 routes: devices (push), notification inbox and preferences, maps, masked calls, delivery log.
import express, { Router } from 'express';
import { z } from 'zod';
import { ADMIN_ROLES } from '@physioconnect/shared';
import { config } from '../config/index.js';
import { sequelize } from '../db/index.js';
import { HttpError } from '../lib/util.js';
import { asyncHandler, requireAuth, requireRole, validate } from '../middleware/index.js';
import { audit } from '../services/audit.js';
import { callForVisit, callStatus } from '../services/calls.js';
import { mapsEnabled, placeDetails, reverseGeocode, searchAddress } from '../services/maps.js';
import { dispatchOnce } from '../services/notify.js';

const q = async (sql, replacements) => (await sequelize.query(sql, { replacements }))[0];

// ---------- devices: Expo push tokens ----------
export const devicesRouter = Router();
devicesRouter.use(requireAuth);
devicesRouter.post('/', validate(z.object({
  pushToken: z.string().regex(/^(ExponentPushToken|ExpoPushToken)\[[\w-]+\]$/, 'Not an Expo push token.'),
  platform: z.enum(['android', 'ios', 'web']),
  app: z.enum(['patient', 'therapist', 'partner', 'super_admin', 'web']),
  appVersion: z.string().max(16).optional(),
})), asyncHandler(async (req, res) => {
  const b = req.body;
  // A phone can change hands: the token always belongs to whoever signed in last.
  await q(`INSERT INTO devices (user_id, platform, app, app_version, push_token, last_seen_at) VALUES (:u, :p, :a, :v, :t, now())
    ON CONFLICT (push_token) WHERE push_token IS NOT NULL DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, app = EXCLUDED.app, app_version = EXCLUDED.app_version, last_seen_at = now(), disabled_at = NULL, updated_at = now()`,
  { u: req.user.id, p: b.platform, a: b.app, v: b.appVersion ?? null, t: b.pushToken });
  res.status(201).json({ ok: true });
}));
devicesRouter.delete('/:token', asyncHandler(async (req, res) => {
  await q(`UPDATE devices SET disabled_at = now() WHERE push_token = :t AND user_id = :u`, { t: req.params.token, u: req.user.id });
  res.status(204).end();
}));

// ---------- inbox and preferences ----------
export const inboxRouter = Router();
inboxRouter.use(requireAuth);
inboxRouter.get('/unread-count', asyncHandler(async (req, res) => {
  res.json({ unread: (await q(`SELECT count(*)::int AS n FROM notifications WHERE user_id = :u AND read_at IS NULL`, { u: req.user.id }))[0].n });
}));
inboxRouter.post('/read', validate(z.object({ ids: z.array(z.string().uuid()).max(200).optional() })), asyncHandler(async (req, res) => {
  if (req.body.ids?.length) await q(`UPDATE notifications SET read_at = now() WHERE user_id = :u AND id IN (:ids) AND read_at IS NULL`, { u: req.user.id, ids: req.body.ids });
  else await q(`UPDATE notifications SET read_at = now() WHERE user_id = :u AND read_at IS NULL`, { u: req.user.id });
  res.json({ ok: true });
}));
inboxRouter.get('/preferences', asyncHandler(async (req, res) => {
  const [p] = await q(`SELECT push, sms, whatsapp, language FROM notification_prefs WHERE user_id = :u`, { u: req.user.id });
  res.json({ preferences: p ?? { push: true, sms: true, whatsapp: true, language: 'en' }, note: 'Safety alerts and sign-in codes are always sent.' });
}));
inboxRouter.put('/preferences', validate(z.object({ push: z.boolean(), sms: z.boolean(), whatsapp: z.boolean(), language: z.enum(['en', 'hi']).default('en') })), asyncHandler(async (req, res) => {
  const b = req.body;
  await q(`INSERT INTO notification_prefs (user_id, push, sms, whatsapp, language) VALUES (:u, :p, :s, :w, :l)
    ON CONFLICT (user_id) DO UPDATE SET push = EXCLUDED.push, sms = EXCLUDED.sms, whatsapp = EXCLUDED.whatsapp, language = EXCLUDED.language, updated_at = now()`, { u: req.user.id, p: b.push, s: b.sms, w: b.whatsapp, l: b.language });
  res.json({ preferences: b });
}));

// ---------- maps ----------
export const mapsRouter = Router();
mapsRouter.use(requireAuth);
mapsRouter.get('/config', (_req, res) => res.json({ search: mapsEnabled(), provider: config.maps.provider, bias: { lat: config.maps.biasLat, lng: config.maps.biasLng } }));
mapsRouter.get('/search', asyncHandler(async (req, res) => res.json({ results: await searchAddress(String(req.query.q ?? ''), String(req.query.session ?? '') || undefined) })));
mapsRouter.get('/place/:id', asyncHandler(async (req, res) => res.json({ place: await placeDetails(req.params.id, String(req.query.session ?? '') || undefined) })));
mapsRouter.get('/reverse', asyncHandler(async (req, res) => {
  const lat = Number(req.query.lat), lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new HttpError(400, 'bad_location', 'lat and lng are required.');
  res.json(await reverseGeocode(lat, lng));
}));

// ---------- masked calls ----------
export const callsRouter = Router();
callsRouter.use(requireAuth);
callsRouter.get('/config', (_req, res) => res.json({ enabled: config.calls.provider !== 'none', windowBeforeHours: config.calls.windowBeforeHours, windowAfterHours: config.calls.windowAfterHours }));
callsRouter.post('/visit/:visitId', asyncHandler(async (req, res) => res.json(await callForVisit({ userId: req.user.id, visitId: req.params.visitId }))));

export const callWebhookRouter = Router();
callWebhookRouter.post('/calls/:id', express.urlencoded({ extended: false, limit: '32kb' }), asyncHandler(async (req, res) => res.json(await callStatus(req.params.id, req.body ?? {}))));

// ---------- console: delivery log and test message ----------
export const adminMessagingRouter = Router();
adminMessagingRouter.use(requireAuth, requireRole(...ADMIN_ROLES.filter(r => r !== 'content_editor')));
adminMessagingRouter.get('/', asyncHandler(async (req, res) => {
  const status = ['pending', 'sent', 'failed', 'skipped'].includes(String(req.query.status)) ? String(req.query.status) : null;
  const channel = ['push', 'sms', 'whatsapp'].includes(String(req.query.channel)) ? String(req.query.channel) : null;
  const rows = await q(`SELECT d.id, d.channel, d.status, d.attempts, d.provider, d.error, d.sent_at, d.created_at, d.next_attempt_at, n.type, n.title, u.name, u.phone
    FROM notification_deliveries d JOIN notifications n ON n.id = d.notification_id JOIN users u ON u.id = d.user_id
    WHERE (:s::text IS NULL OR d.status = :s) AND (:c::text IS NULL OR d.channel = :c) ORDER BY d.id DESC LIMIT 200`, { s: status, c: channel });
  const summary = await q(`SELECT channel, status, count(*)::int AS n FROM notification_deliveries WHERE created_at > now() - interval '7 days' GROUP BY channel, status`);
  const calls = await q(`SELECT status, count(*)::int AS n FROM call_logs WHERE created_at > now() - interval '7 days' GROUP BY status`);
  res.json({ deliveries: rows.map(r => ({ ...r, id: Number(r.id) })), summary, calls,
    providers: { push: config.messaging.pushProvider, sms: config.messaging.smsProvider, whatsapp: config.messaging.whatsappProvider, calls: config.calls.provider, maps: mapsEnabled() ? 'google' : 'none' } });
}));
adminMessagingRouter.post('/test', requireRole('super_admin'), validate(z.object({ title: z.string().trim().min(2).max(120).default('Test from PhysioCare') })), asyncHandler(async (req, res) => {
  await q(`INSERT INTO notifications (user_id, type, title, body) VALUES (:u, 'booking_confirmed', :t, 'This is a test of push, SMS and WhatsApp.')`, { u: req.user.id, t: req.body.title });
  await dispatchOnce();
  await audit({ actor: req.user, action: 'messaging.test_sent', targetType: 'user', targetId: req.user.id, ip: req.ip });
  res.json({ ok: true, message: 'Sent to you on every channel that is switched on. See the delivery log below.' });
}));
