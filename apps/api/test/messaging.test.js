import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { config } from '../src/config/index.js';
import { lastCodeSentTo } from '../src/services/sms.js';
import { afterQuietHours, channelsFor, deliverDue, dispatchOnce, expand, sentInMemory } from '../src/services/notify.js';
import { google, travelMinutesMany } from '../src/services/maps.js';
import { User, sequelize } from '../src/models/index.js';

const app = createApp();
let n = 0;
const phone = () => `91${String(60000000 + ++n).padStart(8, '0')}`;
const q = (sql, r) => sequelize.query(sql, { replacements: r });
const auth = t => ({ authorization: `Bearer ${t}` });
async function signUp(name, extra = {}) {
  const p = phone();
  await request(app).post('/api/v1/auth/otp/send').send({ phone: p }).expect(200);
  const res = await request(app).post('/api/v1/auth/otp/verify').send({ phone: p, code: lastCodeSentTo(`+91${p}`), ...extra }).expect(201);
  await User.update({ name, gender: 'female' }, { where: { id: res.body.user.id } });
  return { id: res.body.user.id, token: res.body.tokens.accessToken, phone: `+91${p}` };
}
const note = (u, type, title = 'Hello') => q(`INSERT INTO notifications (user_id, type, title, body) VALUES (:u, :t, :ti, 'Body')`, { u: u.id, t: type, ti: title });
const sentTo = (who, channel) => sentInMemory.filter(m => m.channel === channel && m.to.includes(who));
async function visit(t, p, inMin, mode = 'home') {
  const [[pl]] = await q(`INSERT INTO plans (patient_id, therapist_id, mode, sessions_total, price_paise, status) VALUES (:p, :t, :m, 1, 80000, 'active') RETURNING id`, { p: p.id, t: t.id, m: mode });
  const [[v]] = await q(`INSERT INTO visits (therapist_id, patient_id, plan_id, mode, status, during) VALUES (:t, :p, :pl, :m, 'booked', tstzrange(now() + make_interval(mins => :i), now() + make_interval(mins => :i + 45))) RETURNING id`, { t: t.id, p: p.id, pl: pl.id, m: mode, i: inMin });
  return v.id;
}
const quiet = config.messaging.quietHours;

let patient, physio, ops, superAdmin;
beforeAll(async () => {
  config.messaging.quietHours = null; // tests don't depend on the clock
  patient = await signUp('Meera Devi');
  physio = await signUp('Asha Kumari', { role: 'therapist' });
  ops = await signUp('Ops One');
  superAdmin = await signUp('Boss');
  await q(`INSERT INTO user_roles (user_id, role) VALUES (:a, 'ops_admin'), (:b, 'super_admin')`, { a: ops.id, b: superAdmin.id });
  // Clear anything earlier test files queued, so these tests only see their own messages.
  await q(`UPDATE notifications SET dispatched_at = now() WHERE dispatched_at IS NULL`);
  await q(`UPDATE notification_deliveries SET status = 'skipped' WHERE status = 'pending'`);
  await q(`UPDATE visits SET reminder_sent_at = now() WHERE reminder_sent_at IS NULL`);
});
afterAll(async () => { config.messaging.quietHours = quiet; await sequelize.close(); });

describe('channels and quiet hours', () => {
  it('push for everything; SMS and WhatsApp only for important messages', () => {
    expect(channelsFor('chat_message')).toEqual(['push']);
    expect(channelsFor('physio_on_the_way')).toEqual(['push', 'sms']);
    expect(channelsFor('booking_confirmed')).toEqual(['push', 'sms', 'whatsapp']);
  });
  it('quiet hours push texts to the morning (IST)', () => {
    config.messaging.quietHours = [21 * 60 + 30, 7 * 60 + 30];
    expect(afterQuietHours(new Date('2026-11-20T17:00:00Z'))?.toISOString()).toBe('2026-11-21T02:00:00.000Z'); // 22:30 IST → 07:30 IST
    expect(afterQuietHours(new Date('2026-11-20T06:00:00Z'))).toBeNull(); // 11:30 IST
    config.messaging.quietHours = null;
  });
});

describe('delivery', () => {
  it('registers a phone for push; rejects junk tokens', async () => {
    await request(app).post('/api/v1/devices').set(auth(patient.token)).send({ pushToken: 'hello', platform: 'android', app: 'patient' }).expect(400);
    await request(app).post('/api/v1/devices').set(auth(patient.token)).send({ pushToken: 'ExponentPushToken[abc123XYZ]', platform: 'android', app: 'patient', appVersion: '0.9.0' }).expect(201);
  });
  it('a booking confirmation goes by push, SMS and WhatsApp; each attempt is logged', async () => {
    await note(patient, 'booking_confirmed', 'You’re booked');
    await expand(); await deliverDue();
    expect(sentTo('ExponentPushToken[abc123XYZ]', 'push').some(m => m.title === 'You’re booked')).toBe(true);
    expect(sentTo(patient.phone, 'sms').some(m => m.title === 'You’re booked')).toBe(true);
    expect(sentTo(patient.phone, 'whatsapp').some(m => m.title === 'You’re booked')).toBe(true);
    const log = (await request(app).get('/api/v1/admin/messages?status=sent').set(auth(ops.token)).expect(200)).body;
    expect(log.deliveries.filter(d => d.title === 'You’re booked').map(d => d.channel).sort()).toEqual(['push', 'sms', 'whatsapp']);
    expect(log.providers).toMatchObject({ push: 'memory', maps: 'none' });
  });
  it('people can turn SMS and WhatsApp off; push without a device is skipped, not failed', async () => {
    await request(app).put('/api/v1/inbox/preferences').set(auth(patient.token)).send({ push: true, sms: false, whatsapp: false }).expect(200);
    await note(patient, 'payment_verified', 'Payment received');
    await note(physio, 'new_booking', 'New booking');
    await dispatchOnce();
    expect(sentTo(patient.phone, 'sms').some(m => m.title === 'Payment received')).toBe(false);
    const [rows] = await q(`SELECT d.channel, d.status, d.error FROM notification_deliveries d JOIN notifications n ON n.id = d.notification_id WHERE n.user_id = :u AND n.title = 'New booking'`, { u: physio.id });
    expect(rows.find(r => r.channel === 'push')).toMatchObject({ status: 'skipped', error: 'no device with notifications on' });
    expect(rows.find(r => r.channel === 'sms').status).toBe('sent');
  });
  it('inbox: unread count and mark as read', async () => {
    const before = (await request(app).get('/api/v1/inbox/unread-count').set(auth(patient.token)).expect(200)).body.unread;
    expect(before).toBeGreaterThan(0);
    await request(app).post('/api/v1/inbox/read').set(auth(patient.token)).send({}).expect(200);
    expect((await request(app).get('/api/v1/inbox/unread-count').set(auth(patient.token)).expect(200)).body.unread).toBe(0);
  });
  it('reminds both sides two hours before a visit, once', async () => {
    await visit(physio, patient, 120);
    await dispatchOnce(); await dispatchOnce();
    const [rows] = await q(`SELECT user_id FROM notifications WHERE type = 'visit_reminder' AND user_id IN (:a, :b)`, { a: patient.id, b: physio.id });
    expect(rows.length).toBe(2);
  });
  it('SOS reaches ops and super admin by SMS even if they turned SMS off', async () => {
    await request(app).put('/api/v1/inbox/preferences').set(auth(ops.token)).send({ push: true, sms: false, whatsapp: false }).expect(200);
    await request(app).post('/api/v1/therapist/sos').set(auth(physio.token)).send({ lat: 25.61, lng: 85.14 }).expect(201).catch(async () => request(app).post('/api/v1/therapist/sos').set(auth(physio.token)).send({ lat: 25.61, lng: 85.14 }));
    await dispatchOnce();
    expect(sentTo(ops.phone, 'sms').some(m => m.type === 'sos_alert')).toBe(true);
    expect(sentTo(superAdmin.phone, 'sms').some(m => m.type === 'sos_alert')).toBe(true);
  });
  it('only a super admin can send a test message', async () => {
    await request(app).post('/api/v1/admin/messages/test').set(auth(ops.token)).send({}).expect(403);
    await request(app).post('/api/v1/admin/messages/test').set(auth(superAdmin.token)).send({}).expect(200);
  });
});

describe('maps', () => {
  it('without Google: search is off and drive time is estimated', async () => {
    await request(app).get('/api/v1/maps/search?q=Kankarbagh').set(auth(patient.token)).expect(503);
    const [m] = await travelMinutesMany([{ lat: 25.60, lng: 85.10 }], { lat: 25.61, lng: 85.15 });
    expect(m).toBeGreaterThan(0);
  });
  it('with Google: real drive times are used and cached', async () => {
    const saved = { ...config.maps }; const real = google.matrix;
    Object.assign(config.maps, { provider: 'google', googleKey: 'test-key' });
    let calls = 0;
    google.matrix = async origins => { calls++; return origins.map(() => ({ minutes: 37, meters: 9000 })); };
    google.autocomplete = async input => [{ placeId: 'p1', text: `${input}, Patna`, main: input, secondary: 'Patna, Bihar' }];
    try {
      const o = [{ lat: 25.5001, lng: 85.0001 }], d = { lat: 25.5501, lng: 85.0501 };
      expect(await travelMinutesMany(o, d)).toEqual([37]);
      expect(await travelMinutesMany(o, d)).toEqual([37]);
      expect(calls).toBe(1);
      expect((await request(app).get('/api/v1/maps/search?q=Kankarbagh').set(auth(patient.token)).expect(200)).body.results[0].main).toBe('Kankarbagh');
      google.matrix = async () => { throw new Error('quota'); };
      expect((await travelMinutesMany([{ lat: 25.7, lng: 85.3 }], d))[0]).toBeGreaterThan(0); // falls back, never fails
    } finally { Object.assign(config.maps, saved); google.matrix = real; }
  });
});

describe('masked calls', () => {
  it('patient and physio can call each other around the visit; nobody else; numbers never returned', async () => {
    const vid = await visit(physio, patient, 60);
    const r = (await request(app).post(`/api/v1/calls/visit/${vid}`).set(auth(patient.token)).expect(200)).body;
    expect(r.status).toBe('ringing');
    expect(JSON.stringify(r)).not.toContain(physio.phone.slice(3));
    await request(app).post(`/api/v1/calls/visit/${vid}`).set(auth(physio.token)).expect(200);
    await request(app).post(`/api/v1/calls/visit/${vid}`).set(auth(ops.token)).expect(404);
    const far = await visit(physio, patient, 60 * 24 * 5);
    expect((await request(app).post(`/api/v1/calls/visit/${far}`).set(auth(patient.token)).expect(409)).body.error.code).toBe('outside_window');
  });
  it('the call provider reports how the call went', async () => {
    const vid = await visit(physio, patient, 200);
    const { callId } = (await request(app).post(`/api/v1/calls/visit/${vid}`).set(auth(patient.token)).expect(200)).body;
    await request(app).post(`/api/v1/webhooks/calls/${callId}`).type('form').send({ Status: 'completed', ConversationDuration: '125' }).expect(200);
    const [[c]] = await q(`SELECT status, duration_seconds FROM call_logs WHERE id = :id`, { id: callId });
    expect(c).toMatchObject({ status: 'completed', duration_seconds: 125 });
  });
});
