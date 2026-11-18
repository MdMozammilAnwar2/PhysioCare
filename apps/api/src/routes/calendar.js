// Phase 7 routes: calendar connections and feeds, Calendly webhook, video visits, console calendar.
import express, { Router } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { ADMIN_ROLES } from '@physioconnect/shared';
import { config } from '../config/index.js';
import { sequelize } from '../db/index.js';
import { HttpError } from '../lib/util.js';
import { asyncHandler, requireAuth, requireRole, validate } from '../middleware/index.js';
import { audit } from '../services/audit.js';
import {
  calendlyWebhook, connectCalendly, connections, disconnect, feedIcs, feedSecret, feedUrl, providers, rotateFeed, saveGoogle, syncTherapist, visitIcs,
} from '../services/calendar.js';
import { joinVideo, startVideo } from '../services/visits.js';

const q = async (sql, replacements) => (await sequelize.query(sql, { replacements }))[0];
const sendIcs = (res, body, filename) => res.set({ 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': `${filename ? 'attachment' : 'inline'}; filename="${filename ?? 'physiocare.ics'}"`, 'Cache-Control': 'private, max-age=300' }).send(body);

// ---------- public: subscribe-link feed and Google sign-in return ----------
export const publicCalendarRouter = Router();
publicCalendarRouter.get('/feed/:secret.ics', asyncHandler(async (req, res) => sendIcs(res, await feedIcs(req.params.secret))));
const page = (title, text) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font-family:'Plus Jakarta Sans',system-ui,sans-serif;background:#F7F6FC;color:#1F1A4D;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:16px}
main{background:#fff;border:1px solid #E4E1F5;border-radius:20px;padding:32px;max-width:420px;text-align:center}h1{font-size:24px;margin:0 0 8px}p{color:#5E5A7A}</style></head>
<body><main><h1>${title}</h1><p>${text}</p></main></body></html>`;
publicCalendarRouter.get('/google/callback', asyncHandler(async (req, res) => {
  let claims;
  try { claims = jwt.verify(String(req.query.state ?? ''), config.jwtAccessSecret, { audience: 'gcal-connect' }); }
  catch { return res.status(400).send(page('Link expired', 'Open the PhysioCare Partner app and tap “Connect Google Calendar” again.')); }
  if (req.query.error || !req.query.code) return res.send(page('Not connected', 'Google Calendar was not connected. You can try again from the app.'));
  try {
    const tokens = await providers.google.exchange(String(req.query.code));
    const c = await sequelize.transaction(async () => saveGoogle(claims.sub, tokens));
    await audit({ actor: { id: claims.sub, primaryRole: 'therapist' }, action: 'calendar.google_connected', targetType: 'calendar', targetId: c.id, after: { email: tokens.email }, ip: req.ip });
    syncTherapist(claims.sub).catch(() => undefined);
    res.send(page('Google Calendar connected', `Your PhysioCare visits will appear in ${tokens.email ?? 'your calendar'}, and your other appointments will block those times. You can close this page.`));
  } catch {
    res.status(502).send(page('Couldn’t connect', 'Google didn’t accept the connection. Please try again from the app.'));
  }
}));

// ---------- Calendly webhook (raw body for the signature check) ----------
export const webhookRouter = Router();
webhookRouter.post('/calendly/:id', express.raw({ type: '*/*', limit: '256kb' }), asyncHandler(async (req, res) => {
  res.json(await calendlyWebhook(req.params.id, Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '', req.get('calendly-webhook-signature')));
}));

// ---------- signed in: my calendar ----------
export const calendarRouter = Router();
calendarRouter.use(requireAuth);
calendarRouter.get('/me', asyncHandler(async (req, res) => {
  const isPhysio = req.user.roles.includes('therapist');
  res.json({ feedUrl: feedUrl(await feedSecret(req.user.id)), connections: isPhysio ? await connections(req.user.id) : [], googleAvailable: isPhysio && providers.google.configured(), calendlyAvailable: isPhysio });
}));
calendarRouter.post('/feed/rotate', asyncHandler(async (req, res) => {
  await audit({ actor: req.user, action: 'calendar.feed_rotated', targetType: 'user', targetId: req.user.id, ip: req.ip });
  res.json({ feedUrl: feedUrl(await rotateFeed(req.user.id)) });
}));
calendarRouter.get('/visits/:id.ics', asyncHandler(async (req, res) => sendIcs(res, await visitIcs(req.user.id, req.params.id), 'physiocare-visit.ics')));
calendarRouter.get('/google/connect', requireRole('therapist'), asyncHandler(async (req, res) => {
  if (!providers.google.configured()) throw new HttpError(503, 'google_not_configured', 'Google Calendar isn’t set up on the server yet (GOOGLE_CLIENT_ID).');
  const state = jwt.sign({ sub: req.user.id }, config.jwtAccessSecret, { audience: 'gcal-connect', expiresIn: '10m' });
  res.json({ url: providers.google.authUrl(state) });
}));
calendarRouter.post('/calendly', requireRole('therapist'), validate(z.object({ token: z.string().trim().min(20).max(2000) })), asyncHandler(async (req, res) => {
  const r = await connectCalendly(req.user.id, req.body.token);
  await audit({ actor: req.user, action: 'calendar.calendly_connected', targetType: 'calendar', targetId: r.id, after: { email: r.email, webhook: r.webhook }, ip: req.ip });
  syncTherapist(req.user.id).catch(() => undefined);
  res.status(201).json(r);
}));
calendarRouter.delete('/connections/:id', requireRole('therapist'), asyncHandler(async (req, res) => {
  await disconnect(req.user.id, req.params.id);
  await audit({ actor: req.user, action: 'calendar.disconnected', targetType: 'calendar', targetId: req.params.id, ip: req.ip });
  res.status(204).end();
}));
calendarRouter.post('/sync', requireRole('therapist'), asyncHandler(async (req, res) => {
  const results = await syncTherapist(req.user.id);
  res.json({ results, connections: await connections(req.user.id) });
}));

// ---------- video visits ----------
export const videoRouter = Router();
videoRouter.use(requireAuth);
videoRouter.get('/:visitId', asyncHandler(async (req, res) => res.json(await joinVideo({ userId: req.user.id, visitId: req.params.visitId }))));
videoRouter.post('/:visitId/start', requireRole('therapist'), asyncHandler(async (req, res) => res.json(await startVideo({ therapistId: req.user.id, visitId: req.params.visitId, ip: req.ip }))));

// ---------- console: everyone's calendar ----------
export const adminCalendarRouter = Router();
adminCalendarRouter.use(requireAuth, requireRole(...ADMIN_ROLES.filter(r => r !== 'content_editor')));
adminCalendarRouter.get('/', asyncHandler(async (req, res) => {
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from)) ? String(req.query.from) : new Date(Date.now() + 5.5 * 36e5).toISOString().slice(0, 10);
  const days = Math.min(31, Math.max(1, Number(req.query.days) || 7));
  const visits = await q(`SELECT v.id, v.mode, v.status, lower(v.during) AS starts_at, upper(v.during) AS ends_at, v.therapist_id, tu.name AS therapist_name,
      split_part(pu.name, ' ', 1) AS patient_first, z.name AS zone_name, z.color AS zone_color, v.physio_consent
    FROM visits v JOIN users tu ON tu.id = v.therapist_id JOIN users pu ON pu.id = v.patient_id LEFT JOIN zones z ON z.id = v.zone_id
    WHERE v.status <> 'held' AND lower(v.during) >= (:from::date)::timestamp AT TIME ZONE 'Asia/Kolkata'
      AND lower(v.during) < ((:from::date + :days)::timestamp AT TIME ZONE 'Asia/Kolkata') ORDER BY lower(v.during)`, { from, days });
  const busy = await q(`SELECT b.therapist_id, lower(b.during) AS starts_at, upper(b.during) AS ends_at, c.provider FROM external_busy_blocks b JOIN calendar_connections c ON c.id = b.connection_id
    WHERE b.during && tstzrange((:from::date)::timestamp AT TIME ZONE 'Asia/Kolkata', ((:from::date + :days)::timestamp AT TIME ZONE 'Asia/Kolkata'))`, { from, days });
  const leave = await q(`SELECT therapist_id, lower(during) AS starts_at, upper(during) AS ends_at, reason FROM leave_periods
    WHERE during && tstzrange((:from::date)::timestamp AT TIME ZONE 'Asia/Kolkata', ((:from::date + :days)::timestamp AT TIME ZONE 'Asia/Kolkata'))`, { from, days });
  res.json({ from, days, visits, busy, leave });
}));
