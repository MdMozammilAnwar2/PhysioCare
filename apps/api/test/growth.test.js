import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { lastCodeSentTo } from '../src/services/sms.js';
import { User, sequelize } from '../src/models/index.js';

const app = createApp();
let n = 0;
const phone = () => `96${String(20000000 + ++n).padStart(8, '0')}`;
const q = (sql, r) => sequelize.query(sql, { replacements: r });
const auth = t => ({ authorization: `Bearer ${t}` });

async function signUp(extra = {}, gender = 'female') {
  const p = phone();
  await request(app).post('/api/v1/auth/otp/send').send({ phone: p }).expect(200);
  const res = await request(app).post('/api/v1/auth/otp/verify').send({ phone: p, code: lastCodeSentTo(`+91${p}`), ...extra }).expect(201);
  await User.update({ gender, name: `Growth ${n}` }, { where: { id: res.body.user.id } });
  return { id: res.body.user.id, token: res.body.tokens.accessToken, phone: p };
}
async function withRole(role) { const u = await signUp(); await q(`INSERT INTO user_roles (user_id, role) VALUES (:u, :r)`, { u: u.id, r: role }); return u; }
const coins = async u => (await request(app).get('/api/v1/growth/coins').set(auth(u.token)).expect(200)).body.balance;

let physio;
// A held booking for the patient, ready to confirm (price ₹3000, 3 sessions).
async function held(patient) {
  const [[pl]] = await q(`INSERT INTO plans (patient_id, therapist_id, mode, sessions_total, price_paise, status) VALUES (:p, :t, 'home', 3, 300000, 'pending') RETURNING id`, { p: patient.id, t: physio.id });
  const [[v]] = await q(`INSERT INTO visits (therapist_id, patient_id, plan_id, mode, status, hold_expires_at, during)
    VALUES (:t, :p, :pl, 'home', 'held', now() + interval '10 minutes', tstzrange(now() + make_interval(days => 2, mins => :o), now() + make_interval(days => 2, mins => :o) + interval '45 minutes')) RETURNING id`,
  { t: physio.id, p: patient.id, pl: pl.id, o: (++n % 20) * 50 });
  return { planId: pl.id, visitId: v.id };
}
async function payCash(patient, ops, useCoins) {
  const h = await held(patient);
  const c = await request(app).post(`/api/v1/bookings/${h.visitId}/confirm`).set(auth(patient.token)).send({ method: 'cash', useCoins }).expect(200);
  await q(`UPDATE payments SET status = 'submitted', submitted_at = now() WHERE id = :id`, { id: c.body.payment.id });
  await request(app).post(`/api/v1/admin/payments/${c.body.payment.id}/review`).set(auth(ops.token)).send({ approve: true }).expect(200);
  return { ...h, payment: c.body.payment };
}

let superAdmin, ops, finance;
beforeAll(async () => {
  superAdmin = await withRole('super_admin');
  ops = await withRole('ops_admin');
  finance = await withRole('finance');
  physio = await signUp({ role: 'therapist' }, 'female');
  await q(`INSERT INTO therapist_profiles (user_id, qualification, home_lat, home_lng, verification_status) VALUES (:u, 'MPT', 25.6, 85.15, 'verified')`, { u: physio.id });
  await request(app).put('/api/v1/admin/growth/rules').set(auth(superAdmin.token)).send({ welcomeCoins: 500, referrerCoins: 1000, maxCoinPct: 20, partnerRewardPaise: 10000 }).expect(200);
});
afterAll(async () => { await sequelize.close(); });

describe('growth rules', () => {
  it('only a super admin can change them', async () => {
    await request(app).put('/api/v1/admin/growth/rules').set(auth(ops.token)).send({ welcomeCoins: 9, referrerCoins: 9, maxCoinPct: 9, partnerRewardPaise: 9 }).expect(403);
    expect((await request(app).get('/api/v1/admin/growth/rules').set(auth(ops.token)).expect(200)).body).toMatchObject({ coinsPerRupee: 10, rules: { welcomeCoins: 500 } });
  });
});

describe('partners', () => {
  let owner, partnerId, code;
  it('a doctor applies; no QR until approved', async () => {
    owner = await signUp({ role: 'partner_owner' });
    const r = await request(app).post('/api/v1/partner/apply').set(auth(owner.token)).send({ name: 'Dr Sinha Ortho Clinic', type: 'doctor', registrationNo: 'BMC-1234', payoutTo: 'sinha@okaxis' }).expect(201);
    partnerId = r.body.partnerId;
    await request(app).post('/api/v1/partner/apply').set(auth(owner.token)).send({ name: 'Again', type: 'doctor' }).expect(409);
    await request(app).post('/api/v1/partner/links').set(auth(owner.token)).send({ label: 'Front desk' }).expect(409);
    expect((await request(app).get('/api/v1/admin/growth/partners?status=pending').set(auth(ops.token)).expect(200)).body.partners.some(p => p.id === partnerId)).toBe(true);
  });
  it('ops approve; the main QR is created and can be downloaded', async () => {
    await request(app).post(`/api/v1/admin/growth/partners/${partnerId}/decide`).set(auth(ops.token)).send({ approve: false }).expect(400);
    await request(app).post(`/api/v1/admin/growth/partners/${partnerId}/decide`).set(auth(ops.token)).send({ approve: true }).expect(200);
    const me = (await request(app).get('/api/v1/partner/me').set(auth(owner.token)).expect(200)).body;
    expect(me.partner.status).toBe('approved');
    expect(me.links).toHaveLength(1);
    code = me.links[0].code;
    expect(code).toMatch(/^DRSIN[A-Z2-9]{4}$/);
    const png = await request(app).get(me.links[0].qrUrl).set(auth(owner.token)).expect(200);
    expect(png.headers['content-type']).toBe('image/png');
    await request(app).post('/api/v1/partner/links').set(auth(owner.token)).send({ label: 'Reception' }).expect(201);
  });
  it('a QR scan is logged and redirects to the website with the code', async () => {
    const r = await request(app).get(`/r/${code}?src=qr`).expect(302);
    expect(r.headers.location).toContain(`ref=${code}`);
    const unknown = await request(app).get('/r/NOPE1234').expect(302);
    expect(unknown.headers.location).not.toContain('ref=');
  });
  it('a patient from the QR gets welcome coins, pays with them, and the partner earns once', async () => {
    const patient = await signUp({ ref: code });
    expect(await coins(patient)).toBe(500);
    const first = await payCash(patient, ops, true);
    expect(first.payment).toMatchObject({ amountPaise: 295000, coinsUsed: 500, coinDiscountPaise: 5000 });
    expect(await coins(patient)).toBe(0);
    await payCash(patient, ops, false); // second plan: no second reward
    const me = (await request(app).get('/api/v1/partner/me').set(auth(owner.token)).expect(200)).body;
    expect(me.earnedPaise).toBe(10000);
    expect(me.links[0]).toMatchObject({ scans: 1, signups: 1, paid: 1 });
  });
  it('finance pays the partner with a reference', async () => {
    await request(app).post(`/api/v1/admin/growth/partners/${partnerId}/rewards/paid`).set(auth(ops.token)).send({ reference: 'UTR998877' }).expect(403);
    expect((await request(app).post(`/api/v1/admin/growth/partners/${partnerId}/rewards/paid`).set(auth(finance.token)).send({ reference: 'UTR998877' }).expect(200)).body.totalPaise).toBe(10000);
    await request(app).post(`/api/v1/admin/growth/partners/${partnerId}/rewards/paid`).set(auth(finance.token)).send({ reference: 'UTR998878' }).expect(409);
  });
  it('a suspended partner earns nothing and the QR stops crediting', async () => {
    await request(app).post(`/api/v1/admin/growth/partners/${partnerId}/decide`).set(auth(ops.token)).send({ approve: false, note: 'Paused' }).expect(200);
    const p = await signUp({ ref: code });
    expect(await coins(p)).toBe(0);
  });
  it('staff can add a partner directly (approved, with a QR)', async () => {
    const r = await request(app).post('/api/v1/admin/growth/partners').set(auth(ops.token)).send({ name: 'Patna Path Lab', type: 'pathology_lab', phone: '9876501234', contactName: 'Mr Kumar' }).expect(201);
    expect(r.body.code).toMatch(/^PATNA/);
    await request(app).post('/api/v1/admin/growth/partners').set(auth(ops.token)).send({ name: 'Bad', type: 'lab', phone: '12345' }).expect(400);
  });
});

describe('friend referral and coins', () => {
  it('the friend gets welcome coins; the referrer earns when the friend’s first visit is paid', async () => {
    const a = await signUp();
    const ref = (await request(app).get('/api/v1/growth/referral').set(auth(a.token)).expect(200)).body;
    expect(ref.url).toContain(`/r/${ref.code}`);
    const b = await signUp({ ref: ref.code });
    expect(await coins(b)).toBe(500);
    expect(await coins(a)).toBe(0);
    await payCash(b, ops, false);
    expect(await coins(a)).toBe(1000);
    await payCash(b, ops, false);
    expect(await coins(a)).toBe(1000); // only once per friend
    expect((await request(app).get('/api/v1/growth/referral').set(auth(a.token)).expect(200)).body).toMatchObject({ joined: 1, booked: 1 });
  });
  it('coins pay at most 20% and come back pro rata on a refund', async () => {
    const p = await signUp();
    await request(app).post('/api/v1/admin/growth/coins/adjust').set(auth(ops.token)).send({ phone: p.phone, delta: 99999, note: 'test' }).expect(403);
    await request(app).post('/api/v1/admin/growth/coins/adjust').set(auth(superAdmin.token)).send({ phone: p.phone, delta: 9000, note: 'Goodwill' }).expect(200);
    const preview = (await request(app).get('/api/v1/growth/coins/checkout?amountPaise=300000').set(auth(p.token)).expect(200)).body;
    expect(preview).toMatchObject({ coins: 6000, discountPaise: 60000 });
    const b = await payCash(p, ops, true);
    expect(b.payment.amountPaise).toBe(240000);
    expect(await coins(p)).toBe(3000);
    const est = (await request(app).get(`/api/v1/patient/plans/${b.planId}/refund-estimate`).set(auth(p.token)).expect(200)).body;
    expect(est).toMatchObject({ unused: 3, amountPaise: 240000, coinsBack: 6000 });
    const r = await request(app).post(`/api/v1/patient/plans/${b.planId}/refund`).set(auth(p.token)).send({ refundTo: 'me@okicici' }).expect(201);
    await request(app).post(`/api/v1/admin/money/refunds/${r.body.refundId}/decide`).set(auth(ops.token)).send({ approve: true }).expect(200);
    expect(await coins(p)).toBe(9000);
  });
});

describe('attribution report', () => {
  it('shows sign-ups by source and top partners', async () => {
    const r = (await request(app).get('/api/v1/admin/growth/attribution').set(auth(finance.token)).expect(200)).body;
    expect(r.bySource.find(s => s.source === 'partner_permanent_qr')).toBeTruthy();
    expect(r.partners.some(p => p.name === 'Dr Sinha Ortho Clinic' && p.paid === 1)).toBe(true);
    expect(r.coins.issued).toBeGreaterThan(0);
  });
});
