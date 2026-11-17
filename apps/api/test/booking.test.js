import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { lastCodeSentTo } from '../src/services/sms.js';
import { checkoutSignature, webhookSignature } from '../src/services/payments.js';
import { addDays, fromIst, istDate } from '../src/lib/time.js';
import { User, sequelize } from '../src/models/index.js';

const app = createApp();
let n = 0;
const phone = () => `97${String(10000000 + ++n).padStart(8, '0')}`;
const q = (sql, r) => sequelize.query(sql, { replacements: r });
const auth = t => ({ authorization: `Bearer ${t}` });

async function signUp(gender, extra = {}) {
  const p = phone();
  await request(app).post('/api/v1/auth/otp/send').send({ phone: p }).expect(200);
  const res = await request(app).post('/api/v1/auth/otp/verify').send({ phone: p, code: lastCodeSentTo(`+91${p}`), ...extra }).expect(201);
  await User.update({ gender }, { where: { id: res.body.user.id } });
  return { id: res.body.user.id, token: res.body.tokens.accessToken };
}
async function addAddress(token, lat, lng) {
  const res = await request(app).post('/api/v1/patient/addresses').set(auth(token)).send({ line1: 'House 12, Road 4', lat, lng }).expect(201);
  return res.body;
}

// Kankarbagh (green), Boring Road (orange), Digha (red)
const KANKARBAGH = [25.594, 85.158], BORING = [25.616, 85.115], DIGHA = [25.643, 85.098], FAR_KANKAR = [25.594, 85.190]; // inside the zone, ~3.2 km from the first address
const day = addDays(istDate(new Date()), 3); // 3 days ahead, always past the 3-hour notice
let priya, arjun, pkgId;

beforeAll(async () => {
  const city = (await q(`INSERT INTO cities (name, status) VALUES ('TestPatna', 'live') RETURNING id`))[0][0].id;
  await q(`INSERT INTO zones (city_id, name, color, center_lat, center_lng, radius_km) VALUES
    (:c, 'Kankarbagh', 'green', 25.594, 85.158, 4), (:c, 'Boring Road', 'orange', 25.616, 85.115, 1.5), (:c, 'Digha', 'red', 25.643, 85.098, 1.5)`, { c: city });
  priya = await signUp('female', { role: 'therapist' });
  arjun = await signUp('male', { role: 'therapist' });
  for (const [t, lat, lng, rating] of [[priya, 25.596, 85.150, 4.9], [arjun, 25.600, 85.140, 4.7]]) {
    await q(`INSERT INTO therapist_profiles (user_id, qualification, home_lat, home_lng, service_radius_km, verification_status, rating, specialisations)
      VALUES (:u, 'MPT', :lat, :lng, 10, 'verified', :r, '{after_surgery}')`, { u: t.id, lat, lng, r: rating });
    await q(`INSERT INTO therapist_prices (therapist_id, mode, price_paise) VALUES (:u, 'home', 80000), (:u, 'video', 50000)`, { u: t.id });
    for (let wd = 0; wd < 7; wd++) await q(`INSERT INTO availability_rules (therapist_id, weekday, start_time, end_time, modes) VALUES (:u, :wd, '07:00', '21:00', '{home,video}')`, { u: t.id, wd });
  }
  pkgId = (await q(`INSERT INTO packages (therapist_id, name, mode, sessions, price_paise) VALUES (:u, '10-session recovery plan', 'home', 10, 640000) RETURNING id`, { u: priya.id }))[0][0].id;
});
afterAll(async () => { await sequelize.close(); });

describe('addresses and zones', () => {
  it('maps an address to its zone colour', async () => {
    const p = await signUp('male');
    expect((await addAddress(p.token, ...KANKARBAGH)).zone).toMatchObject({ name: 'Kankarbagh', color: 'green' });
    expect((await addAddress(p.token, ...DIGHA)).zone.color).toBe('red');
  });
});

describe('matching', () => {
  it('never matches a woman with a male physio unless family is present, and then flags consent', async () => {
    const p = await signUp('female');
    const { id } = await addAddress(p.token, ...KANKARBAGH);
    const alone = await request(app).post('/api/v1/therapists/match').set(auth(p.token)).send({ mode: 'home', addressId: id }).expect(200);
    expect(alone.body.matches.map(m => m.id)).toEqual([priya.id]);
    const family = await request(app).post('/api/v1/therapists/match').set(auth(p.token)).send({ mode: 'home', addressId: id, familyPresent: true }).expect(200);
    const a = family.body.matches.find(m => m.id === arjun.id);
    expect(a.requiresFamilyAndConsent).toBe(true);
  });

  it('respects the patient’s gender preference', async () => {
    const p = await signUp('male');
    await request(app).put('/api/v1/patient/profile').set(auth(p.token)).send({ preferredGender: 'male' }).expect(200);
    const { id } = await addAddress(p.token, ...KANKARBAGH);
    const res = await request(app).post('/api/v1/therapists/match').set(auth(p.token)).send({ mode: 'home', addressId: id }).expect(200);
    expect(res.body.matches.map(m => m.id)).toEqual([arjun.id]);
  });

  it('refuses home visits in a red zone but allows video', async () => {
    const p = await signUp('male');
    const { id } = await addAddress(p.token, ...DIGHA);
    const res = await request(app).post('/api/v1/therapists/match').set(auth(p.token)).send({ mode: 'home', addressId: id }).expect(409);
    expect(res.body.error.code).toBe('zone_closed');
    const video = await request(app).post('/api/v1/therapists/match').set(auth(p.token)).send({ mode: 'video' }).expect(200);
    expect(video.body.matches.length).toBe(2);
  });
});

describe('slots', () => {
  it('limits orange-zone home visits to 8 AM – 6 PM', async () => {
    const p = await signUp('male');
    const { id } = await addAddress(p.token, ...BORING);
    const res = await request(app).get(`/api/v1/therapists/${priya.id}/slots`).query({ mode: 'home', from: day, days: 1, addressId: id }).set(auth(p.token)).expect(200);
    expect(res.body.slots[0]).toBe(fromIst(day, 8 * 60).toISOString());
    expect(res.body.slots.at(-1)).toBe(fromIst(day, 18 * 60 - 45).toISOString()); // last 45-min visit ends by 6 PM
  });
});

describe('booking and payment', () => {
  it('holds a slot, confirms on a valid payment, and issues an invoice', async () => {
    const p = await signUp('male');
    const { id } = await addAddress(p.token, ...KANKARBAGH);
    const start = fromIst(day, 9 * 60).toISOString();
    const hold = await request(app).post('/api/v1/bookings/hold').set(auth(p.token)).send({ therapistId: priya.id, start, mode: 'home', addressId: id, packageId: pkgId }).expect(201);
    expect(hold.body).toMatchObject({ amountPaise: 640000, payment: { provider: 'fake' } });

    // Someone else can't take the held slot.
    const other = await signUp('male');
    const { id: otherAddr } = await addAddress(other.token, ...KANKARBAGH);
    const clash = await request(app).post('/api/v1/bookings/hold').set(auth(other.token)).send({ therapistId: priya.id, start, mode: 'home', addressId: otherAddr }).expect(409);
    expect(clash.body.error.code).toBe('slot_taken');

    const { orderId } = hold.body.payment;
    const bad = await request(app).post('/api/v1/payments/razorpay/verify').set(auth(p.token)).send({ orderId, paymentId: 'pay_test_1', signature: 'a'.repeat(64) }).expect(400);
    expect(bad.body.error.code).toBe('signature_invalid');

    const ok = await request(app).post('/api/v1/payments/razorpay/verify').set(auth(p.token))
      .send({ orderId, paymentId: 'pay_test_1', signature: checkoutSignature(orderId, 'pay_test_1') }).expect(200);
    expect(ok.body.invoiceNo).toMatch(/^INV-\d{4}-\d{6}$/);
    expect(ok.body.needsNewTime).toBe(false);

    const list = await request(app).get('/api/v1/bookings').set(auth(p.token)).expect(200);
    expect(list.body.bookings[0]).toMatchObject({ status: 'booked', plan_status: 'active', sessions_total: 10, zone_color: 'green' });
    const notes = await request(app).get('/api/v1/notifications').set(auth(p.token)).expect(200);
    expect(notes.body.notifications[0].type).toBe('booking_confirmed');

    // Razorpay webhook for the same payment is accepted and changes nothing (idempotent).
    const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_test_1', order_id: orderId } } } });
    await request(app).post('/api/v1/payments/razorpay/webhook').set('content-type', 'application/json').set('x-razorpay-signature', webhookSignature(body)).send(body).expect(200);
    const [[{ c }]] = await q(`SELECT count(*)::int AS c FROM payments WHERE provider_order_id = :o AND status = 'paid'`, { o: orderId });
    expect(c).toBe(1);
  });

  it('rejects a webhook with a bad signature', async () => {
    const body = JSON.stringify({ event: 'payment.captured' });
    await request(app).post('/api/v1/payments/razorpay/webhook').set('content-type', 'application/json').set('x-razorpay-signature', 'b'.repeat(64)).send(body).expect(400);
  });

  it('leaves travel time between home visits across town', async () => {
    const p = await signUp('male');
    const near = await addAddress(p.token, ...KANKARBAGH);
    const start = fromIst(day, 11 * 60).toISOString();
    const hold = await request(app).post('/api/v1/bookings/hold').set(auth(p.token)).send({ therapistId: arjun.id, start, mode: 'home', addressId: near.id }).expect(201);
    const { orderId } = hold.body.payment;
    await request(app).post('/api/v1/payments/razorpay/verify').set(auth(p.token)).send({ orderId, paymentId: 'pay_t2', signature: checkoutSignature(orderId, 'pay_t2') }).expect(200);

    const far = await signUp('male');
    const farAddr = await addAddress(far.token, ...FAR_KANKAR); // ~3.2 km away → 10 min drive + 10 min buffer
    expect(farAddr.zone.color).toBe('green');
    const res = await request(app).get(`/api/v1/therapists/${arjun.id}/slots`).query({ mode: 'home', from: day, days: 1, addressId: farAddr.id }).set(auth(far.token)).expect(200);
    expect(res.body.slots).not.toContain(fromIst(day, 11 * 60 + 45).toISOString()); // right after the visit: no time to drive
    expect(res.body.slots).toContain(fromIst(day, 12 * 60 + 15).toISOString());
  });

  it('enforces the gender rule at booking time too', async () => {
    const p = await signUp('female');
    const { id } = await addAddress(p.token, ...KANKARBAGH);
    const start = fromIst(day, 15 * 60).toISOString();
    const res = await request(app).post('/api/v1/bookings/hold').set(auth(p.token)).send({ therapistId: arjun.id, start, mode: 'home', addressId: id }).expect(409);
    expect(res.body.error.code).toBe('gender_rule');
    const ok = await request(app).post('/api/v1/bookings/hold').set(auth(p.token))
      .send({ therapistId: arjun.id, start, mode: 'home', addressId: id, familyMember: { name: 'Sunil Sharma', relation: 'Husband' } }).expect(201);
    expect(ok.body.needsPhysioConsent).toBe(true);
    const [[{ c }]] = await q(`SELECT count(*)::int AS c FROM consents WHERE user_id = :u AND document = 'gender_safety'`, { u: p.id });
    expect(c).toBe(1);
  });
});
