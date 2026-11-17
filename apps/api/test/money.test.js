import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { lastCodeSentTo } from '../src/services/sms.js';
import { checkinCode } from '../src/services/visits.js';
import { split } from '../src/services/money.js';
import { User, sequelize } from '../src/models/index.js';

const app = createApp();
let n = 0;
const phone = () => `95${String(10000000 + ++n).padStart(8, '0')}`;
const q = (sql, r) => sequelize.query(sql, { replacements: r });
const auth = t => ({ authorization: `Bearer ${t}` });

async function signUp(gender, extra = {}) {
  const p = phone();
  await request(app).post('/api/v1/auth/otp/send').send({ phone: p }).expect(200);
  const res = await request(app).post('/api/v1/auth/otp/verify').send({ phone: p, code: lastCodeSentTo(`+91${p}`), ...extra }).expect(201);
  await User.update({ gender, name: `User ${n}` }, { where: { id: res.body.user.id } });
  return { id: res.body.user.id, token: res.body.tokens.accessToken };
}
async function withRole(role) { const u = await signUp('female'); await q(`INSERT INTO user_roles (user_id, role) VALUES (:u, :r)`, { u: u.id, r: role }); return u; }
async function physio() {
  const t = await signUp('female', { role: 'therapist' });
  await q(`INSERT INTO therapist_profiles (user_id, qualification, home_lat, home_lng, verification_status) VALUES (:u, 'MPT', 25.6, 85.15, 'verified')`, { u: t.id });
  return t;
}
// A paid (or pending) plan with `count` booked visits for today.
async function plan(t, p, { sessions = 3, price = 300000, paid = true, count = 1 } = {}) {
  const [[pl]] = await q(`INSERT INTO plans (patient_id, therapist_id, mode, sessions_total, price_paise, status) VALUES (:p, :t, 'home', :s, :price, 'active') RETURNING id`, { p: p.id, t: t.id, s: sessions, price });
  const [[pay]] = await q(`INSERT INTO payments (patient_id, plan_id, amount_paise, provider, method, reference, status) VALUES (:p, :pl, :a, 'offline', 'upi', :ref, :st) RETURNING id`,
    { p: p.id, pl: pl.id, a: price, ref: `PC-T${String(++n).padStart(5, '0')}`, st: paid ? 'paid' : 'submitted' });
  const visits = [];
  for (let i = 0; i < count; i++) {
    const [[v]] = await q(`INSERT INTO visits (therapist_id, patient_id, plan_id, mode, status, during)
      VALUES (:t, :p, :pl, 'home', 'booked', tstzrange(now() - make_interval(mins => :o), now() - make_interval(mins => :o) + interval '45 minutes')) RETURNING id`, { t: t.id, p: p.id, pl: pl.id, o: i * 46 }); // earlier today, back to back, so check-in stays on the visit day
    visits.push(v.id);
  }
  return { planId: pl.id, paymentId: pay.id, visits };
}
async function complete(t, visitId) {
  await request(app).post(`/api/v1/therapist/visits/${visitId}/check-in`).set(auth(t.token)).send({ code: checkinCode(visitId) }).expect(200);
  await request(app).post(`/api/v1/therapist/visits/${visitId}/complete`).set(auth(t.token)).send({ painScore: 3 }).expect(200);
}

let superAdmin, finance, ops;
beforeAll(async () => {
  superAdmin = await withRole('super_admin');
  finance = await withRole('finance');
  ops = await withRole('ops_admin');
  await request(app).put('/api/v1/admin/money/money-rules').set(auth(superAdmin.token)).send({ platformFeePct: 10, tdsPct: 1, holdDays: 7, minPayoutPaise: 50000, reportWindowDays: 7 }).expect(200);
});
afterAll(async () => { await sequelize.close(); });

describe('money rules', () => {
  it('only a super admin can change fee and TDS rates', async () => {
    await request(app).put('/api/v1/admin/money/money-rules').set(auth(finance.token)).send({ platformFeePct: 5, tdsPct: 1, holdDays: 7, minPayoutPaise: 50000, reportWindowDays: 7 }).expect(403);
    expect((await request(app).get('/api/v1/admin/money/money-rules').set(auth(finance.token)).expect(200)).body.rules.platformFeePct).toBe(10);
  });
  it('splits a session: fee on gross, TDS on the rest, net adds up', () => {
    expect(split(100000, 10, 1)).toEqual({ gross: 100000, fee: 10000, tds: 900, net: 89100 });
  });
});

describe('earnings → hold → payout', () => {
  it('a completed, paid session earns, holds 7 days, then pays out in a batch', async () => {
    const t = await physio(), p = await signUp('male');
    const { visits } = await plan(t, p, { sessions: 3, price: 300000 });
    await complete(t, visits[0]);
    let w = (await request(app).get('/api/v1/therapist/wallet').set(auth(t.token)).expect(200)).body;
    expect(w.heldPaise).toBe(89100); // ₹1,000 − 10% fee − 1% TDS
    expect(w.availablePaise).toBe(0);
    expect(w.entries[0]).toMatchObject({ gross_paise: 100000, fee_paise: 10000, tds_paise: 900, status: 'held' });

    await q(`UPDATE ledger_entries SET available_at = now() - interval '1 minute' WHERE therapist_id = :t`, { t: t.id }); // hold passed
    w = (await request(app).get('/api/v1/therapist/wallet').set(auth(t.token)).expect(200)).body;
    expect(w.availablePaise).toBe(89100);

    await request(app).post('/api/v1/admin/money/payout-batches').set(auth(ops.token)).expect(403); // finance only
    await request(app).post('/api/v1/admin/money/payout-batches').set(auth(finance.token)).expect(201);
    const pending = (await request(app).get('/api/v1/admin/money/payouts').set(auth(finance.token)).expect(200)).body.payouts.find(x => x.therapist_name === `User ${n}` || x.amount_paise === 89100);
    expect(pending).toMatchObject({ status: 'pending', sessions: 1 });
    await request(app).post(`/api/v1/admin/money/payouts/${pending.id}/paid`).set(auth(finance.token)).send({ method: 'upi', reference: 'UTR998877665544' }).expect(200);
    w = (await request(app).get('/api/v1/therapist/wallet').set(auth(t.token)).expect(200)).body;
    expect(w).toMatchObject({ availablePaise: 0, paidPaise: 89100 });
    expect(w.payouts[0]).toMatchObject({ status: 'paid', reference: 'UTR998877665544' });
  });

  it('no earning until the payment is confirmed; confirming it later creates the earning', async () => {
    const t = await physio(), p = await signUp('male');
    const { visits, paymentId } = await plan(t, p, { sessions: 1, price: 80000, paid: false });
    await complete(t, visits[0]);
    expect((await request(app).get('/api/v1/therapist/wallet').set(auth(t.token)).expect(200)).body.heldPaise).toBe(0);
    await request(app).post(`/api/v1/admin/payments/${paymentId}/review`).set(auth(finance.token)).send({ approve: true }).expect(200);
    expect((await request(app).get('/api/v1/therapist/wallet').set(auth(t.token)).expect(200)).body.heldPaise).toBe(split(80000, 10, 1).net);
  });

  it('spreads a package across sessions with the remainder on the last one', async () => {
    const t = await physio(), p = await signUp('male');
    const { visits } = await plan(t, p, { sessions: 3, price: 100000, count: 3 });
    for (const v of visits) await complete(t, v);
    const [rows] = await q(`SELECT gross_paise FROM ledger_entries WHERE therapist_id = :t ORDER BY created_at`, { t: t.id });
    expect(rows.map(r => r.gross_paise)).toEqual([33333, 33333, 33334]);
  });
});

describe('incidents freeze earnings', () => {
  it('report → frozen (left out of payouts) → dismissed → unfrozen', async () => {
    const t = await physio(), p = await signUp('male');
    const { visits } = await plan(t, p, { sessions: 1, price: 100000 });
    await complete(t, visits[0]);
    const r = await request(app).post('/api/v1/patient/incidents').set(auth(p.token)).send({ visitId: visits[0], category: 'missing_item', description: 'A watch was missing after the visit.' }).expect(201);
    expect((await request(app).get('/api/v1/therapist/wallet').set(auth(t.token)).expect(200)).body.frozenPaise).toBe(89100);
    const list = await request(app).get('/api/v1/admin/money/incidents').set(auth(ops.token)).expect(200);
    expect(list.body.incidents.find(i => i.id === r.body.incidentId)).toMatchObject({ category: 'missing_item', severity: 'medium' });
    await request(app).post(`/api/v1/admin/money/incidents/${r.body.incidentId}/decide`).set(auth(ops.token)).send({ uphold: false, note: 'Watch found by the family.' }).expect(200);
    const w = (await request(app).get('/api/v1/therapist/wallet').set(auth(t.token)).expect(200)).body;
    expect(w.frozenPaise).toBe(0);
    expect(w.heldPaise).toBe(89100);
  });

  it('upheld → earning reversed and patient refunded', async () => {
    const t = await physio(), p = await signUp('male');
    const { visits } = await plan(t, p, { sessions: 1, price: 100000 });
    await complete(t, visits[0]);
    const r = await request(app).post('/api/v1/patient/incidents').set(auth(p.token)).send({ visitId: visits[0], category: 'behaviour', description: 'The physio was rude and left early.' }).expect(201);
    expect(r.body.severity).toBe('critical');
    const d = await request(app).post(`/api/v1/admin/money/incidents/${r.body.incidentId}/decide`).set(auth(ops.token)).send({ uphold: true, note: 'Confirmed by call recording.', refundPaise: 100000 }).expect(200);
    const [[le]] = await q(`SELECT status FROM ledger_entries WHERE visit_id = :v`, { v: visits[0] });
    expect(le.status).toBe('reversed');
    await request(app).post(`/api/v1/admin/money/refunds/${d.body.refundId}/paid`).set(auth(finance.token)).send({ reference: 'UTR112233445566' }).expect(200);
    const mine = await request(app).get('/api/v1/patient/refunds').set(auth(p.token)).expect(200);
    expect(mine.body.refunds[0]).toMatchObject({ status: 'paid', reason: 'incident', amount_paise: 100000 });
  });

  it('only within the report window', async () => {
    const t = await physio(), p = await signUp('male');
    const { visits } = await plan(t, p, { sessions: 1 });
    await complete(t, visits[0]);
    await q(`UPDATE visits SET completed_at = now() - interval '8 days' WHERE id = :v`, { v: visits[0] });
    expect((await request(app).post('/api/v1/patient/incidents').set(auth(p.token)).send({ visitId: visits[0], category: 'other', description: 'Something went wrong at the visit.' }).expect(409)).body.error.code).toBe('window_closed');
  });
});

describe('refund of unused sessions', () => {
  it('pro-rata estimate → request → approve cancels future visits → paid', async () => {
    const t = await physio(), p = await signUp('male');
    const { planId, visits } = await plan(t, p, { sessions: 3, price: 300000, count: 2 });
    await complete(t, visits[0]);
    const est = (await request(app).get(`/api/v1/patient/plans/${planId}/refund-estimate`).set(auth(p.token)).expect(200)).body;
    expect(est).toMatchObject({ used: 1, unused: 2, amountPaise: 200000 });
    const r = await request(app).post(`/api/v1/patient/plans/${planId}/refund`).set(auth(p.token)).send({ refundTo: 'rohit@okaxis' }).expect(201);
    expect((await request(app).post(`/api/v1/patient/plans/${planId}/refund`).set(auth(p.token)).send({ refundTo: 'rohit@okaxis' }).expect(409)).body.error.code).toBe('refund_open');
    await request(app).post(`/api/v1/admin/money/refunds/${r.body.refundId}/decide`).set(auth(ops.token)).send({ approve: true }).expect(200);
    const [[v2]] = await q(`SELECT status, cancel_reason FROM visits WHERE id = :v`, { v: visits[1] });
    expect(v2).toMatchObject({ status: 'cancelled', cancel_reason: 'plan_refunded' });
    await request(app).post(`/api/v1/admin/money/refunds/${r.body.refundId}/paid`).set(auth(ops.token)).send({ reference: 'UTR000000000000' }).expect(403); // finance only
    await request(app).post(`/api/v1/admin/money/refunds/${r.body.refundId}/paid`).set(auth(finance.token)).send({ reference: 'UTR445566778899' }).expect(200);
    const plans = await request(app).get('/api/v1/patient/plans').set(auth(p.token)).expect(200);
    expect(plans.body.plans.find(x => x.id === planId).status).toBe('refunded');
  });
});

describe('ratings', () => {
  it('rate a completed visit once; the physio’s average updates', async () => {
    const t = await physio(), p = await signUp('male');
    const { visits } = await plan(t, p, { sessions: 2, count: 2 });
    await request(app).post(`/api/v1/patient/visits/${visits[0]}/rating`).set(auth(p.token)).send({ stars: 5 }).expect(409); // not done yet
    await complete(t, visits[0]); await complete(t, visits[1]);
    await request(app).post(`/api/v1/patient/visits/${visits[0]}/rating`).set(auth(p.token)).send({ stars: 5, tags: ['on_time', 'explained_clearly'] }).expect(201);
    await request(app).post(`/api/v1/patient/visits/${visits[1]}/rating`).set(auth(p.token)).send({ stars: 4 }).expect(201);
    await request(app).post(`/api/v1/patient/visits/${visits[1]}/rating`).set(auth(p.token)).send({ stars: 1 }).expect(409);
    const [[tp]] = await q(`SELECT rating FROM therapist_profiles WHERE user_id = :t`, { t: t.id });
    expect(Number(tp.rating)).toBe(4.5);
  });
});

describe('chat', () => {
  it('patient and physio chat; contact details are blocked; outsiders can’t read', async () => {
    const t = await physio(), p = await signUp('male'), stranger = await signUp('male');
    const { planId } = await plan(t, p);
    await request(app).post(`/api/v1/chat/${planId}/messages`).set(auth(t.token)).send({ body: 'I’ll reach by 9. Keep a firm chair ready.' }).expect(201);
    await request(app).post(`/api/v1/chat/${planId}/messages`).set(auth(p.token)).send({ body: 'Sure, gate is on the left.' }).expect(201);
    for (const body of ['call me on 98765 43210', 'pay me at priya.physio@okhdfcbank', 'lets talk on whatsapp']) {
      expect((await request(app).post(`/api/v1/chat/${planId}/messages`).set(auth(t.token)).send({ body }).expect(422)).body.error.code).toBe('contact_details_blocked');
    }
    const msgs = (await request(app).get(`/api/v1/chat/${planId}/messages`).set(auth(p.token)).expect(200)).body.messages;
    expect(msgs.map(m => m.mine)).toEqual([false, true]);
    expect((await request(app).get(`/api/v1/chat/${planId}/messages?after=${msgs[0].id}`).set(auth(p.token)).expect(200)).body.messages).toHaveLength(1);
    await request(app).get(`/api/v1/chat/${planId}/messages`).set(auth(stranger.token)).expect(404);
    const [[b]] = await q(`SELECT count(*)::int AS c FROM chat_blocked_attempts WHERE plan_id = :p`, { p: planId });
    expect(b.c).toBe(3); // kept for leakage review
  });
});
