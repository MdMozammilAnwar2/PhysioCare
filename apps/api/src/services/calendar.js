// Calendars: private subscribe feeds (.ics), Google Calendar (two-way), Calendly (busy times in), and sync.
// Outside events only ever block time; PhysioCare never reads their titles or attendees.
// Events we put in a physio's calendar show the patient's first name and area only — the address stays in the app.
import crypto from 'node:crypto';
import { config } from '../config/index.js';
import { sequelize } from '../db/index.js';
import { HttpError, randomToken } from '../lib/util.js';

const q = async (sql, replacements, transaction) => (await sequelize.query(sql, { replacements, transaction }))[0];
const one = async (sql, replacements, transaction) => (await q(sql, replacements, transaction))[0];

// ---------- tokens are encrypted at rest (AES-256-GCM) ----------
const KEY = crypto.createHash('sha256').update(config.calendar.tokenKey).digest();
export function encrypt(text) {
  if (text == null) return null;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const data = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return `v1.${iv.toString('base64url')}.${c.getAuthTag().toString('base64url')}.${data.toString('base64url')}`;
}
export function decrypt(blob) {
  if (!blob) return null;
  const [, iv, tag, data] = blob.split('.');
  const d = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8');
}

// ---------- .ics (RFC 5545) ----------
const icsDate = d => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const esc = s => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const fold = line => { const out = []; let s = line; while (s.length > 74) { out.push(s.slice(0, 74)); s = ` ${s.slice(74)}`; } out.push(s); return out.join('\r\n'); };
export function ics(name, events) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Healthtropic//PhysioCare//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${esc(name)}`, 'X-WR-TIMEZONE:Asia/Kolkata', 'REFRESH-INTERVAL;VALUE=DURATION:PT30M'];
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${icsDate(e.updated ?? Date.now())}`, `DTSTART:${icsDate(e.start)}`, `DTEND:${icsDate(e.end)}`,
      `SUMMARY:${esc(e.title)}`, ...(e.location ? [`LOCATION:${esc(e.location)}`] : []), ...(e.description ? [`DESCRIPTION:${esc(e.description)}`] : []),
      ...(e.url ? [`URL:${e.url}`] : []), `STATUS:${e.cancelled ? 'CANCELLED' : 'CONFIRMED'}`, 'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Reminder', 'TRIGGER:-PT60M', 'END:VALARM', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

const VISIT_SQL = `SELECT v.id, v.mode, v.status, lower(v.during) AS starts_at, upper(v.during) AS ends_at, v.updated_at, v.patient_id, v.therapist_id, v.calendar_events,
    split_part(pu.name, ' ', 1) AS patient_first, tu.name AS physio_name, z.name AS zone_name
  FROM visits v JOIN users pu ON pu.id = v.patient_id JOIN users tu ON tu.id = v.therapist_id LEFT JOIN zones z ON z.id = v.zone_id`;
const ACTIVE = ['booked', 'on_the_way', 'checked_in', 'completed'];
const LIVE_OR_DONE = `v.status IN ('booked', 'on_the_way', 'checked_in', 'completed', 'cancelled', 'late_cancelled', 'no_show')`;
const modeLabel = m => ({ home: 'Home visit', video: 'Video session', clinic: 'Clinic visit' }[m] ?? 'Visit');

/** The event as each side sees it. Physio: patient first name + area. Patient: physio name. */
export function visitEvent(v, forRole) {
  const physio = forRole === 'therapist';
  return {
    uid: `${v.id}@physiocare`, start: v.starts_at, end: v.ends_at, updated: v.updated_at,
    title: physio ? `PhysioCare · ${modeLabel(v.mode)} · ${v.patient_first || 'Patient'}` : `Physiotherapy with ${v.physio_name} (PhysioCare)`,
    location: v.mode === 'video' ? 'Video call (join from the PhysioCare app)' : v.zone_name ? `${v.zone_name}, Patna` : null,
    description: physio ? 'Open the PhysioCare Partner app for the address, check-in and notes.' : v.mode === 'video' ? 'Join the video call from My bookings 10 minutes before the start.' : 'Give your physio the check-in code from the app when they arrive.',
    url: physio ? null : `${config.siteUrl.replace(/\/$/, '')}/bookings`,
    cancelled: !ACTIVE.includes(v.status),
  };
}

// ---------- private subscribe feeds ----------
export async function feedSecret(userId) {
  const row = await one(`INSERT INTO calendar_feeds (user_id, secret) VALUES (:u, :s) ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id RETURNING secret`, { u: userId, s: randomToken(24) });
  return row.secret;
}
export async function rotateFeed(userId) {
  return (await one(`INSERT INTO calendar_feeds (user_id, secret) VALUES (:u, :s) ON CONFLICT (user_id) DO UPDATE SET secret = EXCLUDED.secret, created_at = now() RETURNING secret`, { u: userId, s: randomToken(24) })).secret;
}
export const feedUrl = secret => `${config.publicApiUrl}/api/v1/calendar/feed/${secret}.ics`;
export async function feedIcs(secret) {
  const f = await one(`SELECT f.user_id, u.status, EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.id AND r.role = 'therapist') AS is_physio
    FROM calendar_feeds f JOIN users u ON u.id = f.user_id WHERE f.secret = :s`, { s: secret });
  if (!f || f.status !== 'active') throw new HttpError(404, 'not_found', 'Calendar not found.');
  await q(`UPDATE calendar_feeds SET last_fetched_at = now() WHERE user_id = :u`, { u: f.user_id });
  const visits = await q(`${VISIT_SQL} WHERE (v.therapist_id = :u OR v.patient_id = :u) AND ${LIVE_OR_DONE}
      AND lower(v.during) BETWEEN now() - make_interval(days => :back) AND now() + make_interval(days => :ahead) ORDER BY lower(v.during)`,
  { u: f.user_id, back: config.calendar.feedDaysBack, ahead: config.calendar.feedDaysAhead });
  return ics(f.is_physio ? 'PhysioCare visits' : 'My physiotherapy (PhysioCare)', visits.map(v => visitEvent(v, v.therapist_id === f.user_id ? 'therapist' : 'patient')));
}
/** One visit as a downloadable .ics ("Add to calendar"). */
export async function visitIcs(userId, visitId) {
  const v = await one(`${VISIT_SQL} WHERE v.id = :id AND (v.patient_id = :u OR v.therapist_id = :u)`, { id: visitId, u: userId });
  if (!v) throw new HttpError(404, 'not_found', 'Visit not found.');
  return ics('PhysioCare', [visitEvent(v, v.therapist_id === userId ? 'therapist' : 'patient')]);
}

// ---------- providers (HTTP calls; tests swap these for fakes) ----------
async function http(url, { method = 'GET', token, body, form } = {}) {
  const res = await fetch(url, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : body ? { 'content-type': 'application/json' } : {}) },
    body: form ? new URLSearchParams(form) : body ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error_description || data.error?.message || data.message || `HTTP ${res.status}`); e.status = res.status; e.code = data.error; throw e; }
  return data;
}
export const googleRedirectUri = () => `${config.publicApiUrl}/api/v1/calendar/google/callback`;
export const providers = {
  google: {
    configured: () => Boolean(config.calendar.googleClientId && config.calendar.googleClientSecret),
    authUrl: state => `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
      client_id: config.calendar.googleClientId, redirect_uri: googleRedirectUri(), response_type: 'code', access_type: 'offline', prompt: 'consent',
      scope: 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy https://www.googleapis.com/auth/userinfo.email', state,
    })}`,
    async exchange(code) {
      const t = await http('https://oauth2.googleapis.com/token', { method: 'POST', form: { code, client_id: config.calendar.googleClientId, client_secret: config.calendar.googleClientSecret, redirect_uri: googleRedirectUri(), grant_type: 'authorization_code' } });
      const me = await http('https://www.googleapis.com/oauth2/v2/userinfo', { token: t.access_token }).catch(() => ({}));
      return { accessToken: t.access_token, refreshToken: t.refresh_token, expiresIn: t.expires_in, email: me.email ?? null };
    },
    async refresh(refreshToken) {
      const t = await http('https://oauth2.googleapis.com/token', { method: 'POST', form: { refresh_token: refreshToken, client_id: config.calendar.googleClientId, client_secret: config.calendar.googleClientSecret, grant_type: 'refresh_token' } });
      return { accessToken: t.access_token, expiresIn: t.expires_in };
    },
    async busy(token, from, to) {
      const r = await http('https://www.googleapis.com/calendar/v3/freeBusy', { method: 'POST', token, body: { timeMin: from.toISOString(), timeMax: to.toISOString(), items: [{ id: 'primary' }] } });
      return (r.calendars?.primary?.busy ?? []).map(b => ({ id: `${b.start}/${b.end}`, start: b.start, end: b.end }));
    },
    async upsertEvent(token, eventId, e) {
      const body = { summary: e.title, location: e.location ?? undefined, description: e.description, start: { dateTime: new Date(e.start).toISOString() }, end: { dateTime: new Date(e.end).toISOString() }, reminders: { useDefault: true },
        extendedProperties: { private: { physiocare: '1' } } };
      const base = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
      return (eventId ? await http(`${base}/${encodeURIComponent(eventId)}`, { method: 'PUT', token, body }) : await http(base, { method: 'POST', token, body })).id;
    },
    async deleteEvent(token, eventId) {
      await http(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`, { method: 'DELETE', token }).catch(e => { if (e.status !== 404 && e.status !== 410) throw e; });
    },
  },
  calendly: {
    async me(token) { const r = await http(`${config.calendar.calendlyApiUrl}/users/me`, { token }); return { uri: r.resource.uri, email: r.resource.email, orgUri: r.resource.current_organization }; },
    async createWebhook(token, { url, orgUri, userUri, signingKey }) {
      const r = await http(`${config.calendar.calendlyApiUrl}/webhook_subscriptions`, { method: 'POST', token, body: { url, events: ['invitee.created', 'invitee.canceled'], organization: orgUri, user: userUri, scope: 'user', signing_key: signingKey } });
      return r.resource.uri;
    },
    async deleteWebhook(token, uri) { await http(uri, { method: 'DELETE', token }).catch(() => undefined); },
    async busy(token, userUri, from, to) {
      const r = await http(`${config.calendar.calendlyApiUrl}/scheduled_events?${new URLSearchParams({ user: userUri, status: 'active', min_start_time: from.toISOString(), max_start_time: to.toISOString(), count: '100' })}`, { token });
      return (r.collection ?? []).map(e => ({ id: e.uri, start: e.start_time, end: e.end_time }));
    },
  },
};

// ---------- connections ----------
export async function connections(therapistId) {
  return q(`SELECT id, provider, account_email, status, last_synced_at, last_error, created_at FROM calendar_connections WHERE therapist_id = :t ORDER BY created_at`, { t: therapistId });
}
export async function saveGoogle(therapistId, tokens) {
  return one(`INSERT INTO calendar_connections (therapist_id, provider, account_email, access_token_enc, refresh_token_enc, token_expires_at, external_calendar_id, status, last_error, scopes)
    VALUES (:t, 'google', :email, :at, :rt, now() + make_interval(secs => :exp), 'primary', 'active', NULL, '{calendar.events,calendar.freebusy}')
    ON CONFLICT (therapist_id, provider) DO UPDATE SET account_email = EXCLUDED.account_email, access_token_enc = EXCLUDED.access_token_enc,
      refresh_token_enc = COALESCE(EXCLUDED.refresh_token_enc, calendar_connections.refresh_token_enc), token_expires_at = EXCLUDED.token_expires_at, status = 'active', last_error = NULL, updated_at = now()
    RETURNING id`, { t: therapistId, email: tokens.email, at: encrypt(tokens.accessToken), rt: encrypt(tokens.refreshToken ?? null), exp: Number(tokens.expiresIn ?? 3600) });
}
export async function connectCalendly(therapistId, token) {
  const me = await providers.calendly.me(token).catch(() => { throw new HttpError(400, 'calendly_token_invalid', 'Calendly didn’t accept this token. Create a personal access token in Calendly › Integrations › API & Webhooks.'); });
  const old = await one(`SELECT id, access_token_enc, webhook_id FROM calendar_connections WHERE therapist_id = :t AND provider = 'calendly'`, { t: therapistId });
  if (old?.webhook_id) await providers.calendly.deleteWebhook(decrypt(old.access_token_enc), old.webhook_id);
  const row = await one(`INSERT INTO calendar_connections (therapist_id, provider, account_email, access_token_enc, external_calendar_id, status) VALUES (:t, 'calendly', :email, :tok, :uri, 'active')
    ON CONFLICT (therapist_id, provider) DO UPDATE SET account_email = EXCLUDED.account_email, access_token_enc = EXCLUDED.access_token_enc, external_calendar_id = EXCLUDED.external_calendar_id, status = 'active', last_error = NULL, updated_at = now()
    RETURNING id`, { t: therapistId, email: me.email, tok: encrypt(token), uri: me.uri });
  const signingKey = randomToken(32);
  let webhookId = null;
  try { webhookId = await providers.calendly.createWebhook(token, { url: `${config.publicApiUrl}/api/v1/webhooks/calendly/${row.id}`, orgUri: me.orgUri, userUri: me.uri, signingKey }); }
  catch { /* free Calendly plans have no webhooks; the regular sync still reads busy times */ }
  await q(`UPDATE calendar_connections SET webhook_id = :w, webhook_secret_enc = :s WHERE id = :id`, { w: webhookId, s: webhookId ? encrypt(signingKey) : null, id: row.id });
  return { id: row.id, email: me.email, webhook: Boolean(webhookId) };
}
export async function disconnect(therapistId, connectionId) {
  const c = await one(`SELECT * FROM calendar_connections WHERE id = :id AND therapist_id = :t`, { id: connectionId, t: therapistId });
  if (!c) throw new HttpError(404, 'not_found', 'Connection not found.');
  if (c.provider === 'calendly' && c.webhook_id) await providers.calendly.deleteWebhook(decrypt(c.access_token_enc), c.webhook_id);
  await q(`DELETE FROM calendar_connections WHERE id = :id`, { id: c.id }); // busy blocks go with it (cascade)
  await q(`UPDATE visits SET calendar_events = calendar_events - :id WHERE therapist_id = :t AND (calendar_events ->> :id) IS NOT NULL`, { id: c.id, t: therapistId });
}

async function googleToken(c) {
  if (c.token_expires_at && new Date(c.token_expires_at) > new Date(Date.now() + 60_000)) return decrypt(c.access_token_enc);
  const r = await providers.google.refresh(decrypt(c.refresh_token_enc));
  await q(`UPDATE calendar_connections SET access_token_enc = :a, token_expires_at = now() + make_interval(secs => :e) WHERE id = :id`, { a: encrypt(r.accessToken), e: Number(r.expiresIn ?? 3600), id: c.id });
  return r.accessToken;
}
async function replaceBusy(c, events) {
  await sequelize.transaction(async t => {
    await q(`DELETE FROM external_busy_blocks WHERE connection_id = :c AND source = 'sync'`, { c: c.id }, t);
    for (const e of events) {
      if (!(new Date(e.end) > new Date(e.start))) continue;
      await q(`INSERT INTO external_busy_blocks (connection_id, therapist_id, during, external_id, source) VALUES (:c, :t, tstzrange(:s, :e), :x, 'sync') ON CONFLICT DO NOTHING`, { c: c.id, t: c.therapist_id, s: e.start, e: e.end, x: String(e.id).slice(0, 256) }, t);
    }
  });
}

/** Pull busy times in; push PhysioCare visits out (Google). Records the result on the connection. */
export async function syncConnection(c) {
  const from = new Date(), to = new Date(Date.now() + config.calendar.syncDaysAhead * 864e5);
  try {
    if (c.provider === 'google') {
      const token = await googleToken(c);
      // Our own pushed events would come back as "busy": leave out times that are PhysioCare visits.
      const ours = await q(`SELECT lower(during) AS s, upper(during) AS e FROM visits WHERE therapist_id = :t AND (calendar_events ->> :c) IS NOT NULL`, { t: c.therapist_id, c: c.id });
      const busy = (await providers.google.busy(token, from, to)).filter(b => !ours.some(o => +new Date(o.s) === +new Date(b.start) && +new Date(o.e) === +new Date(b.end)));
      await replaceBusy(c, busy);
      const visits = await q(`${VISIT_SQL} WHERE v.therapist_id = :t AND ${LIVE_OR_DONE} AND upper(v.during) >= now() - interval '1 day'
          AND (v.calendar_synced_at IS NULL OR v.updated_at > v.calendar_synced_at OR (v.calendar_events ->> :c) IS NULL)`, { t: c.therapist_id, c: c.id });
      for (const v of visits) {
        const existing = v.calendar_events?.[c.id] ?? null;
        const e = visitEvent(v, 'therapist');
        if (e.cancelled) { if (existing) await providers.google.deleteEvent(token, existing); await q(`UPDATE visits SET calendar_events = calendar_events - :c, calendar_synced_at = now() WHERE id = :id`, { c: c.id, id: v.id }); continue; }
        const id = await providers.google.upsertEvent(token, existing, e);
        await q(`UPDATE visits SET calendar_events = calendar_events || jsonb_build_object(:c::text, :e::text), calendar_synced_at = now() WHERE id = :id`, { c: c.id, e: id, id: v.id });
      }
    } else if (c.provider === 'calendly') {
      await replaceBusy(c, await providers.calendly.busy(decrypt(c.access_token_enc), c.external_calendar_id, from, to));
    }
    await q(`UPDATE calendar_connections SET last_synced_at = now(), last_error = NULL, status = 'active' WHERE id = :id`, { id: c.id });
    return { ok: true };
  } catch (err) {
    const revoked = err.code === 'invalid_grant' || err.status === 401;
    await q(`UPDATE calendar_connections SET last_error = :e, status = :s WHERE id = :id`, { e: String(err.message).slice(0, 500), s: revoked ? 'revoked' : 'error', id: c.id });
    return { ok: false, error: err.message };
  }
}
export async function syncTherapist(therapistId) {
  const list = await q(`SELECT * FROM calendar_connections WHERE therapist_id = :t AND status <> 'revoked' AND provider IN ('google', 'calendly')`, { t: therapistId });
  return Promise.all(list.map(syncConnection));
}
export async function syncAll() {
  const list = await q(`SELECT * FROM calendar_connections WHERE status <> 'revoked' AND provider IN ('google', 'calendly')`);
  for (const c of list) await syncConnection(c); // one at a time: gentle on Google's rate limits
  return list.length;
}

// ---------- Calendly webhook ----------
export async function calendlyWebhook(connectionId, rawBody, signatureHeader) {
  const c = await one(`SELECT * FROM calendar_connections WHERE id = :id AND provider = 'calendly'`, { id: connectionId });
  if (!c?.webhook_secret_enc) throw new HttpError(404, 'not_found', 'Unknown webhook.');
  const parts = Object.fromEntries(String(signatureHeader ?? '').split(',').map(p => p.split('=').map(s => s.trim())));
  const expected = crypto.createHmac('sha256', decrypt(c.webhook_secret_enc)).update(`${parts.t}.${rawBody}`).digest('hex');
  const ok = parts.v1 && parts.v1.length === expected.length && crypto.timingSafeEqual(Buffer.from(parts.v1), Buffer.from(expected));
  if (!ok || Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) throw new HttpError(401, 'bad_signature', 'Signature check failed.');
  const body = JSON.parse(rawBody);
  const ev = body.payload?.scheduled_event;
  if (!ev?.uri) return { ignored: true };
  if (body.event === 'invitee.created') {
    await q(`INSERT INTO external_busy_blocks (connection_id, therapist_id, during, external_id, source) VALUES (:c, :t, tstzrange(:s, :e), :x, 'webhook')
      ON CONFLICT (connection_id, external_id) WHERE external_id IS NOT NULL DO UPDATE SET during = EXCLUDED.during`, { c: c.id, t: c.therapist_id, s: ev.start_time, e: ev.end_time, x: ev.uri });
  } else if (body.event === 'invitee.canceled') {
    await q(`DELETE FROM external_busy_blocks WHERE connection_id = :c AND external_id = :x`, { c: c.id, x: ev.uri });
  }
  return { ok: true };
}
