import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { config } from '../src/config/index.js';
import { lastCodeSentTo } from '../src/services/sms.js';
import { decrypt, encrypt, providers, syncTherapist } from '../src/services/calendar.js';
import { User, sequelize } from '../src/models/index.js';

const app = createApp();
let n = 0;
const phone = () => `92${String(50000000 + ++n).padStart(8, '0')}`;
const q = (sql, r) => sequelize.query(sql, { replacements: r });
const auth = t => ({ authorization: `Bearer ${t}` });
async function signUp(name, extra = {}) {
  const p = phone();
  await request(app).post('/api/v1/auth/otp/send').send({ phone: p }).expect(200);
  const res = await request(app).post('/api/v1/auth/otp/verify').send({ phone: p, code: lastCodeSentTo(`+91${p}`), ...extra }).expect(201);
  await User.update({ name, gender: 'female' }, { where: { id: res.body.user.id } });
  return { id: res.body.user.id, token: res.body.tokens.accessToken, phone: p };
}
// A visit starting `inMin` minutes from now (45 min long).
async function visit(t, p, { mode = 'home', inMin = 120, status = 'booked' } = {}) {
  const [[pl]] = await q(`INSERT INTO plans (patient_id, therapist_id, mode, sessions_total, price_paise, status) VALUES (:p, :t, :m, 1, 80000, 'active') RETURNING id`, { p: p.id, t: t.id, m: mode });
  const [[v]] = await q(`INSERT INTO visits (therapist_id, patient_id, plan_id, mode, status, during) VALUES (:t, :p, :pl, :m, :s,
    tstzrange(now() + make_interval(mins => :i), now() + make_interval(mins => :i + 45))) RETURNING id`, { t: t.id, p: p.id, pl: pl.id, m: mode, s: status, i: inMin });
  return v.id;
}
const path = url => new URL(url).pathname;

let physio, patient, ops;
beforeAll(async () => {
  physio = await signUp('Asha Kumari', { role: 'therapist' });
  await q(`INSERT INTO therapist_profiles (user_id, qualification, home_lat, home_lng, verification_status) VALUES (:u, 'MPT', 25.6, 85.1, 'verified')`, { u: physio.id });
  patient = await signUp('Ravi Ranjan Singh');
  ops = await signUp('Ops Person');
  await q(`INSERT INTO user_roles (user_id, role) VALUES (:u, 'ops_admin')`, { u: ops.id });
});
afterAll(async () => { await sequelize.close(); });

describe('tokens at rest', () => {
  it('encrypts and decrypts; tampering fails', () => {
    const blob = encrypt('ya29.secret-token');
    expect(blob).not.toContain('secret');
    expect(decrypt(blob)).toBe('ya29.secret-token');
    expect(() => decrypt(blob.slice(0, -2) + 'AA')).toThrow();
  });
});

describe('subscribe-link feeds and .ics', () => {
  let vid;
  beforeAll(async () => { vid = await visit(physio, patient); });
  it('the patient’s feed shows the physio; the physio’s feed shows only the patient’s first name', async () => {
    const pf = (await request(app).get('/api/v1/calendar/me').set(auth(patient.token)).expect(200)).body;
    const pIcs = (await request(app).get(path(pf.feedUrl)).expect(200)).text;
    expect(pIcs).toContain('BEGIN:VCALENDAR');
    expect(pIcs).toContain(`UID:${vid}@physiocare`);
    expect(pIcs).toContain('Physiotherapy with Asha Kumari');
    const tf = (await request(app).get('/api/v1/calendar/me').set(auth(physio.token)).expect(200)).body;
    const tIcs = (await request(app).get(path(tf.feedUrl)).expect(200)).text;
    expect(tIcs).toContain('Home visit · Ravi');
    expect(tIcs).not.toContain('Ranjan');
    expect(tIcs).not.toContain(patient.phone);
  });
  it('rotating the link breaks the old one', async () => {
    const old = (await request(app).get('/api/v1/calendar/me').set(auth(patient.token)).expect(200)).body.feedUrl;
    const fresh = (await request(app).post('/api/v1/calendar/feed/rotate').set(auth(patient.token)).expect(200)).body.feedUrl;
    await request(app).get(path(old)).expect(404);
    await request(app).get(path(fresh)).expect(200);
  });
  it('“Add to calendar” works only for people in the visit', async () => {
    const r = await request(app).get(`/api/v1/calendar/visits/${vid}.ics`).set(auth(patient.token)).expect(200);
    expect(r.headers['content-type']).toMatch(/text\/calendar/);
    await request(app).get(`/api/v1/calendar/visits/${vid}.ics`).set(auth(ops.token)).expect(404);
  });
});

describe('Google Calendar', () => {
  const calls = { upsert: [], del: [] };
  beforeAll(() => {
    Object.assign(providers.google, {
      configured: () => true,
      authUrl: state => `https://accounts.google.com/fake?state=${state}`,
      exchange: async () => ({ accessToken: 'access-1', refreshToken: 'refresh-1', expiresIn: 3600, email: 'asha@gmail.com' }),
      refresh: async () => ({ accessToken: 'access-2', expiresIn: 3600 }),
      busy: async (_t, from) => [{ start: new Date(from.getTime() + 26 * 36e5).toISOString(), end: new Date(from.getTime() + 27 * 36e5).toISOString() }],
      upsertEvent: async (_t, id, e) => { calls.upsert.push(e); return id ?? `evt-${calls.upsert.length}`; },
      deleteEvent: async (_t, id) => { calls.del.push(id); },
    });
  });
  it('only physios can connect; the sign-in link carries a short-lived state', async () => {
    await request(app).get('/api/v1/calendar/google/connect').set(auth(patient.token)).expect(403);
    const { url } = (await request(app).get('/api/v1/calendar/google/connect').set(auth(physio.token)).expect(200)).body;
    const state = new URL(url).searchParams.get('state');
    expect(jwt.verify(state, config.jwtAccessSecret, { audience: 'gcal-connect' }).sub).toBe(physio.id);
    await request(app).get('/api/v1/calendar/google/callback?state=forged&code=x').expect(400);
    const done = await request(app).get(`/api/v1/calendar/google/callback?state=${state}&code=abc`).expect(200);
    expect(done.text).toContain('Google Calendar connected');
    const [[c]] = await q(`SELECT access_token_enc, refresh_token_enc FROM calendar_connections WHERE therapist_id = :t AND provider = 'google'`, { t: physio.id });
    expect(c.access_token_enc).not.toContain('access-1');
    expect(decrypt(c.refresh_token_enc)).toBe('refresh-1');
  });
  it('sync blocks outside busy times and pushes visits; a cancelled visit is removed from Google', async () => {
    const vid = await visit(physio, patient, { inMin: 300 });
    calls.upsert.length = 0;
    await syncTherapist(physio.id);
    const [[{ n: blocks }]] = await q(`SELECT count(*)::int AS n FROM external_busy_blocks WHERE therapist_id = :t AND source = 'sync'`, { t: physio.id });
    expect(blocks).toBe(1);
    const pushed = calls.upsert.find(e => e.uid === `${vid}@physiocare`);
    expect(pushed.title).toBe('PhysioCare · Home visit · Ravi');
    const [[v]] = await q(`SELECT calendar_events FROM visits WHERE id = :id`, { id: vid });
    expect(Object.values(v.calendar_events)[0]).toMatch(/^evt-/);
    calls.upsert.length = 0;
    await syncTherapist(physio.id);
    expect(calls.upsert.find(e => e.uid === `${vid}@physiocare`)).toBeUndefined(); // unchanged: not pushed again
    await q(`UPDATE visits SET status = 'cancelled', updated_at = now() + interval '1 second' WHERE id = :id`, { id: vid });
    await syncTherapist(physio.id);
    expect(calls.del).toContain(Object.values(v.calendar_events)[0]);
  });
  it('the physio sees the connection and can disconnect it', async () => {
    const me = (await request(app).get('/api/v1/calendar/me').set(auth(physio.token)).expect(200)).body;
    const g = me.connections.find(c => c.provider === 'google');
    expect(g).toMatchObject({ account_email: 'asha@gmail.com', status: 'active' });
    expect(g).not.toHaveProperty('access_token_enc');
    await request(app).delete(`/api/v1/calendar/connections/${g.id}`).set(auth(physio.token)).expect(204);
  });
});

describe('Calendly', () => {
  let connId, key;
  beforeAll(() => {
    Object.assign(providers.calendly, {
      me: async token => { if (token !== 'calendly-token-123456789') throw new Error('bad'); return { uri: 'https://api.calendly.com/users/U1', email: 'asha@calendly.test', orgUri: 'https://api.calendly.com/organizations/O1' }; },
      createWebhook: async (_t, { signingKey }) => { key = signingKey; return 'https://api.calendly.com/webhook_subscriptions/W1'; },
      deleteWebhook: async () => undefined,
      busy: async () => [],
    });
  });
  const sign = (body, k = key, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${crypto.createHmac('sha256', k).update(`${t}.${body}`).digest('hex')}`;
  it('connects with a personal access token', async () => {
    await request(app).post('/api/v1/calendar/calendly').set(auth(physio.token)).send({ token: 'wrong-token-xxxxxxxxxxxx' }).expect(400);
    const r = (await request(app).post('/api/v1/calendar/calendly').set(auth(physio.token)).send({ token: 'calendly-token-123456789' }).expect(201)).body;
    expect(r).toMatchObject({ email: 'asha@calendly.test', webhook: true });
    connId = r.id;
  });
  it('a booking made in Calendly blocks that time; cancelling frees it; forged calls are refused', async () => {
    const start = new Date(Date.now() + 3 * 864e5).toISOString(), end = new Date(Date.now() + 3 * 864e5 + 30 * 6e4).toISOString();
    const created = JSON.stringify({ event: 'invitee.created', payload: { scheduled_event: { uri: 'https://api.calendly.com/scheduled_events/E1', start_time: start, end_time: end } } });
    await request(app).post(`/api/v1/webhooks/calendly/${connId}`).set('content-type', 'application/json').set('Calendly-Webhook-Signature', sign(created, 'wrong')).send(created).expect(401);
    await request(app).post(`/api/v1/webhooks/calendly/${connId}`).set('content-type', 'application/json').set('Calendly-Webhook-Signature', sign(created)).send(created).expect(200);
    const count = async () => (await q(`SELECT count(*)::int AS n FROM external_busy_blocks WHERE connection_id = :c`, { c: connId }))[0][0].n;
    expect(await count()).toBe(1);
    const cancelled = created.replace('invitee.created', 'invitee.canceled');
    await request(app).post(`/api/v1/webhooks/calendly/${connId}`).set('content-type', 'application/json').set('Calendly-Webhook-Signature', sign(cancelled)).send(cancelled).expect(200);
    expect(await count()).toBe(0);
  });
});

describe('video visits', () => {
  it('both sides get the same private room inside the join window; the physio starts the session', async () => {
    const vid = await visit(physio, patient, { mode: 'video', inMin: 5 });
    const p = (await request(app).get(`/api/v1/video/${vid}`).set(auth(patient.token)).expect(200)).body;
    const t = (await request(app).get(`/api/v1/video/${vid}`).set(auth(physio.token)).expect(200)).body;
    expect(p.room).toBe(t.room);
    expect(p.room).toMatch(/^PhysioCare-[0-9a-f]{20}$/);
    expect(p.url).toContain('meet.jit.si');
    expect(p.url).toContain('Ravi');
    await request(app).get(`/api/v1/video/${vid}`).set(auth(ops.token)).expect(404);
    await request(app).post(`/api/v1/therapist/visits/${vid}/on-the-way`).set(auth(physio.token)).expect(409);
    await request(app).post(`/api/v1/video/${vid}/start`).set(auth(patient.token)).expect(403);
    expect((await request(app).post(`/api/v1/video/${vid}/start`).set(auth(physio.token)).expect(200)).body.status).toBe('checked_in');
    await request(app).post(`/api/v1/therapist/visits/${vid}/complete`).set(auth(physio.token)).send({ painScore: 2 }).expect(200);
  });
  it('the room is closed outside the window and for home visits', async () => {
    const later = await visit(physio, patient, { mode: 'video', inMin: 180 });
    const r = await request(app).get(`/api/v1/video/${later}`).set(auth(patient.token)).expect(409);
    expect(r.body.error.code).toBe('too_early');
    const home = await visit(physio, patient, { inMin: 5 });
    await request(app).get(`/api/v1/video/${home}`).set(auth(patient.token)).expect(409);
  });
});

describe('console calendar', () => {
  it('ops see every visit for the week with only the patient’s first name', async () => {
    const r = (await request(app).get('/api/v1/admin/calendar?days=7').set(auth(ops.token)).expect(200)).body;
    expect(r.visits.length).toBeGreaterThan(0);
    expect(r.visits[0]).toHaveProperty('therapist_name');
    expect(JSON.stringify(r.visits)).not.toContain('Ranjan');
    await request(app).get('/api/v1/admin/calendar').set(auth(patient.token)).expect(403);
  });
});
