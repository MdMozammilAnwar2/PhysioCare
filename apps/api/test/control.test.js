import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { lastCodeSentTo } from '../src/services/sms.js';
import { User, sequelize } from '../src/models/index.js';

const app = createApp();
let n = 0;
const phone = () => `97${String(30000000 + ++n).padStart(8, '0')}`;
const q = (sql, r) => sequelize.query(sql, { replacements: r });
const auth = t => ({ authorization: `Bearer ${t}` });

async function signUp(extra = {}) {
  const p = phone();
  await request(app).post('/api/v1/auth/otp/send').send({ phone: p }).expect(200);
  const res = await request(app).post('/api/v1/auth/otp/verify').send({ phone: p, code: lastCodeSentTo(`+91${p}`), ...extra }).expect(201);
  await User.update({ gender: 'female', name: `Control ${n}` }, { where: { id: res.body.user.id } });
  return { id: res.body.user.id, token: res.body.tokens.accessToken, refresh: res.body.tokens.refreshToken, phone: p };
}
async function withRole(role) { const u = await signUp(); await q(`INSERT INTO user_roles (user_id, role) VALUES (:u, :r)`, { u: u.id, r: role }); return u; }

let superAdmin, ops, finance;
beforeAll(async () => {
  superAdmin = await withRole('super_admin');
  ops = await withRole('ops_admin');
  finance = await withRole('finance');
});
afterAll(async () => { await sequelize.close(); });

describe('blocking', () => {
  it('ops block a patient: signed out at once, and they can’t sign in', async () => {
    const p = await signUp();
    await request(app).post(`/api/v1/admin/control/users/${p.id}/block`).set(auth(ops.token)).send({ reasonCode: 'abuse', note: 'x' }).expect(400);
    await request(app).post(`/api/v1/admin/control/users/${p.id}/block`).set(auth(ops.token)).send({ reasonCode: 'abuse', note: 'Abusive calls to the physio' }).expect(200);
    await request(app).get('/api/v1/me').set(auth(p.token)).expect(403);
    await request(app).post('/api/v1/auth/refresh').send({ refreshToken: p.refresh }).expect(401);
    const list = (await request(app).get('/api/v1/admin/control/blocks').set(auth(finance.token)).expect(200)).body.blocks;
    expect(list.some(b => b.user_id === p.id && b.reason_code === 'abuse')).toBe(true);
    await request(app).post(`/api/v1/admin/control/users/${p.id}/unblock`).set(auth(ops.token)).send({ note: 'Apologised; warned' }).expect(200);
    await request(app).get('/api/v1/me').set(auth(p.token)).expect(200);
  });
  it('a timed block ends by itself', async () => {
    const p = await signUp();
    await request(app).post(`/api/v1/admin/control/users/${p.id}/block`).set(auth(ops.token)).send({ reasonCode: 'no_show_repeat', note: 'Three no-shows', days: 7 }).expect(200);
    await request(app).get('/api/v1/me').set(auth(p.token)).expect(403);
    await q(`UPDATE blocks SET ends_at = now() - interval '1 minute' WHERE user_id = :u`, { u: p.id });
    await request(app).get('/api/v1/me').set(auth(p.token)).expect(200);
  });
  it('only a super admin can block staff, and nobody can block a super admin', async () => {
    await request(app).post(`/api/v1/admin/control/users/${finance.id}/block`).set(auth(ops.token)).send({ reasonCode: 'other', note: 'Testing staff block' }).expect(403);
    await request(app).post(`/api/v1/admin/control/users/${superAdmin.id}/block`).set(auth(ops.token)).send({ reasonCode: 'other', note: 'Testing super block' }).expect(403);
    const other = await withRole('super_admin');
    await request(app).post(`/api/v1/admin/control/users/${other.id}/block`).set(auth(superAdmin.token)).send({ reasonCode: 'other', note: 'Testing super block' }).expect(403);
    await request(app).post(`/api/v1/admin/control/users/${superAdmin.id}/block`).set(auth(superAdmin.token)).send({ reasonCode: 'other', note: 'Block myself' }).expect(409);
    const staffer = await withRole('city_coordinator');
    await request(app).post(`/api/v1/admin/control/users/${staffer.id}/block`).set(auth(superAdmin.token)).send({ reasonCode: 'other', note: 'Left the company' }).expect(200);
  });
  it('a physio can block a patient they visited; matching then skips them', async () => {
    const t = await signUp({ role: 'therapist' });
    const p = await signUp();
    await request(app).post('/api/v1/blocks').set(auth(t.token)).send({ userId: p.id, reasonCode: 'unsafe_home' }).expect(404);
    await q(`INSERT INTO plans (id, patient_id, therapist_id, mode, sessions_total, price_paise, status) VALUES (gen_random_uuid(), :p, :t, 'home', 1, 100000, 'active')`, { p: p.id, t: t.id });
    await q(`INSERT INTO visits (therapist_id, patient_id, plan_id, mode, status, during) SELECT :t, :p, id, 'home', 'completed', tstzrange(now() - interval '3 days', now() - interval '3 days' + interval '45 minutes') FROM plans WHERE patient_id = :p`, { t: t.id, p: p.id });
    await request(app).post('/api/v1/blocks').set(auth(t.token)).send({ userId: p.id, reasonCode: 'unsafe_home', note: 'Aggressive relative' }).expect(201);
    expect((await request(app).get('/api/v1/blocks').set(auth(t.token)).expect(200)).body.blocks).toHaveLength(1);
    expect((await request(app).get('/api/v1/admin/control/personal-blocks').set(auth(ops.token)).expect(200)).body.blocks.some(b => b.blocked_id === p.id)).toBe(true);
  });
});

describe('staff and roles', () => {
  it('a super admin gives and removes staff roles; super admin can never be given', async () => {
    await request(app).post('/api/v1/admin/control/staff').set(auth(ops.token)).send({ phone: '9811112222', role: 'finance' }).expect(403);
    await request(app).post('/api/v1/admin/control/staff').set(auth(superAdmin.token)).send({ phone: '9811112222', role: 'super_admin' }).expect(400);
    const r = await request(app).post('/api/v1/admin/control/staff').set(auth(superAdmin.token)).send({ phone: '9811112222', name: 'Neha', role: 'grievance_committee' }).expect(201);
    const staff = (await request(app).get('/api/v1/admin/control/staff').set(auth(superAdmin.token)).expect(200)).body.staff;
    expect(staff.find(s => s.id === r.body.userId).roles).toContain('grievance_committee');
    await request(app).delete(`/api/v1/admin/control/staff/${superAdmin.id}/roles/super_admin`).set(auth(superAdmin.token)).expect(403);
    await request(app).delete(`/api/v1/admin/control/staff/${r.body.userId}/roles/grievance_committee`).set(auth(superAdmin.token)).expect(204);
  });
});

describe('zones', () => {
  it('ops add and recolour zones with a reason; only a super admin can turn one Red', async () => {
    const { zones, cities } = (await request(app).get('/api/v1/admin/control/zones').set(auth(ops.token)).expect(200)).body;
    const patna = cities.find(c => c.name === 'Patna') ?? (await q(`INSERT INTO cities (name, status) VALUES ('Patna', 'live') ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`))[0][0];
    const created = await request(app).post('/api/v1/admin/control/zones').set(auth(ops.token)).send({ cityId: patna.id, name: `Test Zone ${n}`, color: 'blue', reason: 'Launching soon', centerLat: 25.6, centerLng: 85.1, radiusKm: 1.5 }).expect(201);
    await request(app).patch(`/api/v1/admin/control/zones/${created.body.id}`).set(auth(ops.token)).send({ color: 'red', reason: 'Flooding' }).expect(403);
    await request(app).patch(`/api/v1/admin/control/zones/${created.body.id}`).set(auth(ops.token)).send({ color: 'green', reason: 'Enough physios now' }).expect(200);
    await request(app).patch(`/api/v1/admin/control/zones/${created.body.id}`).set(auth(superAdmin.token)).send({ color: 'red', reason: 'Flooding' }).expect(200);
    const h = (await request(app).get(`/api/v1/admin/control/zones/${created.body.id}/history`).set(auth(ops.token)).expect(200)).body.changes;
    expect(h.map(c => c.to_color)).toEqual(['red', 'green', 'blue']);
    expect(zones).toBeInstanceOf(Array);
  });
});

describe('platform settings', () => {
  it('maintenance mode shows on the public status API; only super admin can switch it', async () => {
    await request(app).put('/api/v1/admin/control/settings/maintenance').set(auth(ops.token)).send({ enabled: true }).expect(403);
    await request(app).put('/api/v1/admin/control/settings/maintenance').set(auth(superAdmin.token)).send({ enabled: true, message: 'Upgrading till 2 AM' }).expect(200);
    expect((await request(app).get('/api/v1/status').expect(200)).body).toMatchObject({ status: 'maintenance', maintenance: { message: 'Upgrading till 2 AM' } });
    await request(app).put('/api/v1/admin/control/settings/maintenance').set(auth(superAdmin.token)).send({ enabled: false }).expect(200);
    await request(app).put('/api/v1/admin/control/settings/min-app-version').set(auth(superAdmin.token)).send({ patient: '0.6', therapist: '0.1.0', partner: '0.1.0', super_admin: '0.1.0' }).expect(400);
  });
  it('audit log is super admin only', async () => {
    await request(app).get('/api/v1/admin/control/audit').set(auth(ops.token)).expect(403);
    const e = (await request(app).get('/api/v1/admin/control/audit?action=maintenance').set(auth(superAdmin.token)).expect(200)).body.entries;
    expect(e[0].action).toMatch(/^maintenance\./);
  });
  it('each role’s dashboard has only its own sections; money never reaches non-finance roles', async () => {
    const dash = async u => (await request(app).get('/api/v1/admin/control/dashboard').set(auth(u.token)).expect(200)).body;
    const f = await dash(finance);
    expect(f.sections).toEqual(['today', 'queues', 'money', 'growth']);
    expect(Object.keys(f.queues).sort()).toEqual(['payments', 'refunds']);
    expect(f.trend).toHaveLength(14);
    expect(f.trend[0]).toHaveProperty('collected');
    const o = await dash(ops);
    expect(o.sections).toEqual(['today', 'queues', 'growth', 'grievance', 'website']);
    expect(o.money).toBeUndefined();
    expect(o.trend[0]).not.toHaveProperty('collected');
    const editor = await withRole('content_editor');
    const e = await dash(editor);
    expect(e.sections).toEqual(['website']);
    expect(e.money).toBeUndefined(); expect(e.today).toBeUndefined(); expect(e.queues).toBeUndefined();
    expect(e.website).toHaveProperty('published');
    const committee = await withRole('grievance_committee');
    const g = await dash(committee);
    expect(g.sections).toEqual(['queues', 'grievance']);
    expect(Object.keys(g.queues).sort()).toEqual(['grievances', 'grievances_overdue']);
    expect(g.grievance).toHaveProperty('avg_days_to_resolve');
    expect(g.money).toBeUndefined();
    const s = await dash(superAdmin);
    expect(s.sections).toEqual(['today', 'queues', 'money', 'growth', 'grievance', 'website']);
  });
});

describe('grievances', () => {
  it('officer details are public', async () => {
    const r = (await request(app).get('/api/v1/public/grievance-officer').expect(200)).body;
    expect(r.officer).toMatchObject({ name: 'Dr Gunjan', ackHours: 24, resolveDays: 15 });
  });
  it('a patient files a complaint; ops acknowledge, reply and resolve; the patient sees public updates only', async () => {
    const p = await signUp();
    await request(app).post('/api/v1/grievances').set(auth(p.token)).send({ category: 'service', description: 'too short' }).expect(400);
    const g = (await request(app).post('/api/v1/grievances').set(auth(p.token)).send({ category: 'refund', description: 'My refund was approved 10 days ago but has not arrived yet.' }).expect(201)).body.grievance;
    expect(g.ticket_no).toMatch(/^GRV-\d{4}-\d{5}$/);
    await request(app).post(`/api/v1/admin/grievances/${g.id}/acknowledge`).set(auth(ops.token)).send({}).expect(200);
    await request(app).post(`/api/v1/admin/grievances/${g.id}/note`).set(auth(ops.token)).send({ body: 'Checked with finance; UTR pending', toComplainant: false }).expect(200);
    await request(app).post(`/api/v1/admin/grievances/${g.id}/resolve`).set(auth(ops.token)).send({ resolution: 'Refund sent today, UTR 12345678.' }).expect(200);
    const mine = (await request(app).get(`/api/v1/grievances/${g.id}`).set(auth(p.token)).expect(200)).body;
    expect(mine.grievance.status).toBe('resolved');
    expect(mine.events.map(e => e.kind)).toEqual(['created', 'acknowledged', 'resolved']);
    await request(app).post(`/api/v1/grievances/${g.id}/reply`).set(auth(p.token)).send({ body: 'Thanks' }).expect(409);
  });
  it('harassment complaints are visible to the committee and super admin, not to ops', async () => {
    const p = await signUp();
    const g = (await request(app).post('/api/v1/grievances').set(auth(p.token)).send({ category: 'harassment', description: 'The physio made inappropriate comments during the session.' }).expect(201)).body.grievance;
    await request(app).get(`/api/v1/admin/grievances/${g.id}`).set(auth(ops.token)).expect(404);
    expect((await request(app).get('/api/v1/admin/grievances').set(auth(ops.token)).expect(200)).body.grievances.some(x => x.id === g.id)).toBe(false);
    const committee = await withRole('grievance_committee');
    expect((await request(app).get(`/api/v1/admin/grievances/${g.id}`).set(auth(committee.token)).expect(200)).body.grievance.committee).toBe(true);
    await request(app).post(`/api/v1/admin/grievances/${g.id}/assign`).set(auth(superAdmin.token)).send({ userId: committee.id }).expect(200);
  });
  it('overdue complaints show on the dashboard', async () => {
    const p = await signUp();
    const g = (await request(app).post('/api/v1/grievances').set(auth(p.token)).send({ category: 'app', description: 'The app keeps logging me out every few minutes.' }).expect(201)).body.grievance;
    await q(`UPDATE grievances SET ack_due_at = now() - interval '1 hour' WHERE id = :id`, { id: g.id });
    expect((await request(app).get('/api/v1/admin/control/dashboard').set(auth(ops.token)).expect(200)).body.queues.grievances_overdue).toBeGreaterThan(0);
  });
});
