import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { lastCodeSentTo } from '../src/services/sms.js';
import { addDays, fromIst, istDate } from '../src/lib/time.js';
import { User, sequelize } from '../src/models/index.js';

const app = createApp();
// Other test files add physios to the same database; matching tests look only at the physios created here.
const ours = ms => ms.map(m => m.id).filter(id => [priya.id, arjun.id].includes(id));
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
  await q(`UPDATE app_settings SET value = '{"upiId": "physioconnect@testbank", "payeeName": "PhysioConnect"}' WHERE key = 'payment_upi'`);
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
    expect(ours(alone.body.matches)).toEqual([priya.id]);
    const family = await request(app).post('/api/v1/therapists/match').set(auth(p.token)).send({ mode: 'home', addressId: id, familyPresent: true }).expect(200);
    const a = family.body.matches.find(m => m.id === arjun.id);
    expect(a.requiresFamilyAndConsent).toBe(true);
  });

  it('respects the patient’s gender preference', async () => {
    const p = await signUp('male');
    await request(app).put('/api/v1/patient/profile').set(auth(p.token)).send({ preferredGender: 'male' }).expect(200);
    const { id } = await addAddress(p.token, ...KANKARBAGH);
    const res = await request(app).post('/api/v1/therapists/match').set(auth(p.token)).send({ mode: 'home', addressId: id }).expect(200);
    expect(ours(res.body.matches)).toEqual([arjun.id]);
  });

  it('refuses home visits in a red zone but allows video', async () => {
    const p = await signUp('male');
    const { id } = await addAddress(p.token, ...DIGHA);
    const res = await request(app).post('/api/v1/therapists/match').set(auth(p.token)).send({ mode: 'home', addressId: id }).expect(409);
    expect(res.body.error.code).toBe('zone_closed');
    const video = await request(app).post('/api/v1/therapists/match').set(auth(p.token)).send({ mode: 'video' }).expect(200);
    expect(ours(video.body.matches)).toHaveLength(2);
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

async function holdAndConfirm(p, therapist, start, method, extra = {}) {
  const { id } = await addAddress(p.token, ...KANKARBAGH);
  const hold = await request(app).post('/api/v1/bookings/hold').set(auth(p.token)).send({ therapistId: therapist.id, start, mode: 'home', addressId: id, ...extra }).expect(201);
  const conf = await request(app).post(`/api/v1/bookings/${hold.body.visitId}/confirm`).set(auth(p.token)).send({ method }).expect(200);
  return { hold: hold.body, conf: conf.body };
}
async function makeAdmin() {
  const a = await signUp('female');
  await q(`INSERT INTO user_roles (user_id, role) VALUES (:u, 'ops_admin')`, { u: a.id });
  return a;
}
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6300010000050001a5f645400000000049454e44ae426082', 'hex');

describe('booking with UPI-QR payment', () => {
  it('confirms the booking at once, then upload proof → ops verifies → invoice', async () => {
    const p = await signUp('male');
    const start = fromIst(day, 9 * 60).toISOString();
    const { hold, conf } = await holdAndConfirm(p, priya, start, 'upi', { packageId: pkgId });
    expect(hold.amountPaise).toBe(640000);
    expect(conf.payment).toMatchObject({ method: 'upi', status: 'pending', upiId: 'physioconnect@testbank' });
    expect(conf.payment.reference).toMatch(/^PC-[A-Z2-9]{6}$/);
    expect(conf.payment.upiUri).toContain('am=6400.00');

    // The slot is booked for everyone else.
    const other = await signUp('male');
    const { id: oa } = await addAddress(other.token, ...KANKARBAGH);
    expect((await request(app).post('/api/v1/bookings/hold').set(auth(other.token)).send({ therapistId: priya.id, start, mode: 'home', addressId: oa }).expect(409)).body.error.code).toBe('slot_taken');

    const qr = await request(app).get(conf.payment.qrUrl).set(auth(p.token)).expect(200);
    expect(qr.headers['content-type']).toBe('image/png');
    await request(app).get(conf.payment.qrUrl).set(auth(other.token)).expect(404); // not someone else's

    const up = await request(app).post('/api/v1/files').set(auth(p.token)).field('purpose', 'payment_proof').attach('file', PNG, { filename: 'gpay.png', contentType: 'image/png' }).expect(201);
    await request(app).post(`/api/v1/payments/${conf.payment.id}/upi-proof`).set(auth(p.token)).send({ utr: '432198765432', fileId: up.body.file.id }).expect(200);

    const admin = await makeAdmin();
    const queue = await request(app).get('/api/v1/admin/payments?status=submitted').set(auth(admin.token)).expect(200);
    expect(queue.body.payments.find(x => x.id === conf.payment.id)).toMatchObject({ utr: '432198765432', proof_file_id: up.body.file.id });
    await request(app).get(`/api/v1/files/${up.body.file.id}/content`).set(auth(admin.token)).expect(200); // staff can see the proof
    await request(app).post(`/api/v1/admin/payments/${conf.payment.id}/review`).set(auth(p.token)).send({ approve: true }).expect(403); // patients can't review

    const rev = await request(app).post(`/api/v1/admin/payments/${conf.payment.id}/review`).set(auth(admin.token)).send({ approve: true }).expect(200);
    expect(rev.body.invoiceNo).toMatch(/^INV-\d{4}-\d{6}$/);
    const list = await request(app).get('/api/v1/bookings').set(auth(p.token)).expect(200);
    expect(list.body.bookings[0]).toMatchObject({ status: 'booked', plan_status: 'active', payment_status: 'paid', zone_color: 'green' });
  });

  it('refuses a UPI reference that was already used', async () => {
    const a = await signUp('male'), b = await signUp('male');
    const x = await holdAndConfirm(a, arjun, fromIst(day, 7 * 60).toISOString(), 'upi');
    const y = await holdAndConfirm(b, arjun, fromIst(day, 16 * 60).toISOString(), 'upi');
    await request(app).post(`/api/v1/payments/${x.conf.payment.id}/upi-proof`).set(auth(a.token)).send({ utr: 'DUP123456789' }).expect(200);
    const res = await request(app).post(`/api/v1/payments/${y.conf.payment.id}/upi-proof`).set(auth(b.token)).send({ utr: 'DUP123456789' }).expect(409);
    expect(res.body.error.code).toBe('utr_used');
  });
});

describe('booking with cash', () => {
  it('physio marks cash received, ops approves', async () => {
    const p = await signUp('male');
    const { conf } = await holdAndConfirm(p, priya, fromIst(day, 13 * 60).toISOString(), 'cash');
    expect(conf.payment.upiId).toBeUndefined();
    await request(app).post(`/api/v1/payments/${conf.payment.id}/cash-received`).set(auth(p.token)).expect(403); // patients can't
    await request(app).post(`/api/v1/payments/${conf.payment.id}/cash-received`).set(auth(arjun.token)).expect(404); // not his patient
    await request(app).post(`/api/v1/payments/${conf.payment.id}/cash-received`).set(auth(priya.token)).expect(200);
    const admin = await makeAdmin();
    const rev = await request(app).post(`/api/v1/admin/payments/${conf.payment.id}/review`).set(auth(admin.token)).send({ approve: true }).expect(200);
    expect(rev.body.status).toBe('paid');
  });
});

describe('booking rules', () => {
  it('leaves travel time between home visits across town', async () => {
    const p = await signUp('male');
    await holdAndConfirm(p, arjun, fromIst(day, 11 * 60).toISOString(), 'cash');
    const far = await signUp('male');
    const farAddr = await addAddress(far.token, ...FAR_KANKAR); // ~3.2 km away → 10 min drive + 10 min buffer
    expect(farAddr.zone.color).toBe('green');
    const res = await request(app).get(`/api/v1/therapists/${arjun.id}/slots`).query({ mode: 'home', from: day, days: 1, addressId: farAddr.id }).set(auth(far.token)).expect(200);
    expect(res.body.slots).not.toContain(fromIst(day, 11 * 60 + 45).toISOString());
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
  });
});

describe('files', () => {
  it('stores files permanently with checksum, private by default, hide instead of delete', async () => {
    const owner = await signUp('male'), stranger = await signUp('male');
    const up = await request(app).post('/api/v1/files').set(auth(owner.token)).attach('file', PNG, { filename: 'x-ray.png', contentType: 'image/png' }).expect(201);
    const f = up.body.file;
    expect(f).toMatchObject({ name: 'x-ray.png', mimeType: 'image/png', sizeBytes: PNG.length, visibility: 'private' });
    expect(f.sha256).toMatch(/^[a-f0-9]{64}$/);
    const got = await request(app).get(`/api/v1/files/${f.id}/content?download=1`).set(auth(owner.token)).buffer(true).parse((res, cb) => { const c = []; res.on('data', d => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); }).expect(200);
    expect(Buffer.compare(got.body, PNG)).toBe(0);
    expect(got.headers['content-disposition']).toContain('attachment');
    await request(app).get(`/api/v1/files/${f.id}/content`).set(auth(stranger.token)).expect(404);
    await request(app).get(`/api/v1/files/${f.id}/content`).expect(401);
    await request(app).delete(`/api/v1/files/${f.id}`).set(auth(owner.token)).expect(204);
    await request(app).get(`/api/v1/files/${f.id}`).set(auth(owner.token)).expect(404);
    const [[row]] = await q(`SELECT hidden_at IS NOT NULL AS hidden FROM files WHERE id = :id`, { id: f.id });
    expect(row.hidden).toBe(true); // still kept
  });

  it('rejects files whose content doesn’t match an allowed type, and public uploads by non-staff', async () => {
    const u = await signUp('male');
    const fake = await request(app).post('/api/v1/files').set(auth(u.token)).attach('file', Buffer.from('not really a png'), { filename: 'a.png', contentType: 'image/png' }).expect(415);
    expect(fake.body.error.code).toBe('file_type_not_allowed');
    await request(app).post('/api/v1/files').set(auth(u.token)).field('visibility', 'public').attach('file', PNG, { filename: 'a.png', contentType: 'image/png' }).expect(403);
  });

  it('lets staff publish public files that anyone can read', async () => {
    const admin = await makeAdmin();
    const up = await request(app).post('/api/v1/files').set(auth(admin.token)).field('visibility', 'public').field('purpose', 'website_media').attach('file', PNG, { filename: 'hero.png', contentType: 'image/png' }).expect(201);
    const res = await request(app).get(up.body.file.url).expect(200);
    expect(res.headers['cache-control']).toContain('public');
  });
});
