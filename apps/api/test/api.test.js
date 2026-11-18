import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { lastCodeSentTo } from '../src/services/sms.js';
import { Attribution, Block, TrackedLink, User, UserRole, sequelize } from '../src/models/index.js';

const app = createApp();
let n = 0;
const nextPhone = () => `98${String(70000000 + ++n).padStart(8, '0')}`; // unique valid Indian numbers
const e164 = p => `+91${p}`;

async function signIn(phone, extra = {}) {
  await request(app).post('/api/v1/auth/otp/send').send({ phone }).expect(200);
  const code = lastCodeSentTo(e164(phone));
  return request(app).post('/api/v1/auth/otp/verify').send({ phone, code, ...extra });
}

afterAll(async () => { await sequelize.close(); });

describe('GET /api/v1/status', () => {
  it('is public and reports version, services and maintenance', async () => {
    const res = await request(app).get('/api/v1/status').expect(200);
    expect(res.body).toMatchObject({ status: 'operational', version: '0.9.0', services: { api: 'up', db: 'up' }, maintenance: { enabled: false } });
    expect(res.body.minAppVersion.patient).toBe('0.1.0');
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });
});

describe('OTP sign-in', () => {
  it('rejects an invalid phone number', async () => {
    const res = await request(app).post('/api/v1/auth/otp/send').send({ phone: '12345' }).expect(400);
    expect(res.body.error.code).toBe('invalid_input');
  });

  it('creates a patient on first sign-in and returns tokens', async () => {
    const phone = nextPhone();
    const res = await signIn(phone);
    expect(res.status).toBe(201);
    expect(res.body.isNew).toBe(true);
    expect(res.body.user).toMatchObject({ phone: e164(phone), roles: ['patient'], primaryRole: 'patient' });
    const me = await request(app).get('/api/v1/me').set('authorization', `Bearer ${res.body.tokens.accessToken}`).expect(200);
    expect(me.body.joinedVia.source).toBe('organic');
  });

  it('returns the existing user on later sign-ins', async () => {
    const phone = nextPhone();
    await signIn(phone);
    await new Promise(r => setTimeout(r, 0));
    // second code needs the resend window to pass; simulate by clearing old requests
    await sequelize.query(`UPDATE otp_requests SET created_at = now() - interval '1 minute' WHERE phone = :p`, { replacements: { p: e164(phone) } });
    const res = await signIn(phone);
    expect(res.status).toBe(200);
    expect(res.body.isNew).toBe(false);
  });

  it('blocks resending within 30 seconds', async () => {
    const phone = nextPhone();
    await request(app).post('/api/v1/auth/otp/send').send({ phone }).expect(200);
    const res = await request(app).post('/api/v1/auth/otp/send').send({ phone }).expect(429);
    expect(res.body.error.code).toBe('otp_resend_too_soon');
  });

  it('locks a code after 5 wrong tries', async () => {
    const phone = nextPhone();
    await request(app).post('/api/v1/auth/otp/send').send({ phone }).expect(200);
    const right = lastCodeSentTo(e164(phone));
    const wrong = right === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) await request(app).post('/api/v1/auth/otp/verify').send({ phone, code: wrong }).expect(400);
    const res = await request(app).post('/api/v1/auth/otp/verify').send({ phone, code: right }).expect(429);
    expect(res.body.error.code).toBe('otp_locked');
  });

  it('never lets anyone sign up as super admin or another admin role', async () => {
    const before = await UserRole.count({ where: { role: 'super_admin' } }); // other test files may seed one
    for (const role of ['super_admin', 'ops_admin', 'finance']) {
      const res = await signIn(nextPhone(), { role });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('role_not_allowed');
    }
    expect(await UserRole.count({ where: { role: 'super_admin' } })).toBe(before);
  });

  it('lets a physio sign up with the therapist role', async () => {
    const res = await signIn(nextPhone(), { role: 'therapist' });
    expect(res.status).toBe(201);
    expect(res.body.user.primaryRole).toBe('therapist');
  });
});

describe('refresh tokens', () => {
  it('rotates, and reusing an old token ends the whole session family', async () => {
    const { body } = await signIn(nextPhone());
    const first = body.tokens.refreshToken;
    const r1 = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: first }).expect(200);
    const second = r1.body.tokens.refreshToken;
    expect(second).not.toBe(first);
    const reuse = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: first }).expect(401);
    expect(reuse.body.error.code).toBe('refresh_reused');
    await request(app).post('/api/v1/auth/refresh').send({ refreshToken: second }).expect(401);
  });
});

describe('onboarding attribution', () => {
  it('credits a friend’s invite link and records the source', async () => {
    const friend = (await signIn(nextPhone())).body.user;
    await TrackedLink.create({ code: 'FRIEND01', type: 'friend_link', ownerUserId: friend.id });
    const res = await signIn(nextPhone(), { ref: 'friend01' }); // codes are case-insensitive
    const a = await Attribution.findByPk(res.body.user.id);
    expect(a.firstSource).toBe('friend_link');
    expect(a.creditedUserId).toBe(friend.id);
  });

  it('credits the doctor on a single-use hospital QR, and only once', async () => {
    const doctor = (await signIn(nextPhone(), { role: 'partner_owner' })).body.user;
    await TrackedLink.create({ code: 'K7MP4QXR', type: 'hospital_qr', referredByUserId: doctor.id, singleUse: true });
    const first = await signIn(nextPhone(), { ref: 'K7MP4QXR' });
    expect((await Attribution.findByPk(first.body.user.id)).creditedUserId).toBe(doctor.id);
    const second = await signIn(nextPhone(), { ref: 'K7MP4QXR' });
    const a2 = await Attribution.findByPk(second.body.user.id);
    expect(a2.firstSource).toBe('organic');
    expect(a2.flagReason).toBe('link_already_used');
  });

  it('records campaign sign-ups from UTM tags', async () => {
    const res = await signIn(nextPhone(), { utm: { source: 'instagram', campaign: 'winter-knee' } });
    const a = await Attribution.findByPk(res.body.user.id);
    expect(a.firstSource).toBe('campaign');
    expect(a.firstUtm.campaign).toBe('winter-knee');
  });
});

describe('blocked accounts', () => {
  it('cannot sign in, and existing access tokens stop working', async () => {
    const phone = nextPhone();
    const { body } = await signIn(phone);
    const admin = await User.create({ phone: e164(nextPhone()) });
    await Block.create({ userId: body.user.id, reasonCode: 'harassment', note: 'test', blockedBy: admin.id });
    await User.update({ status: 'blocked' }, { where: { id: body.user.id } });
    await request(app).get('/api/v1/me').set('authorization', `Bearer ${body.tokens.accessToken}`).expect(403);
    await sequelize.query(`UPDATE otp_requests SET created_at = now() - interval '1 minute' WHERE phone = :p`, { replacements: { p: e164(phone) } });
    const res = await signIn(phone);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('account_blocked');
  });
});

describe('scheduling: no double booking', () => {
  it('the database rejects two live visits that overlap for the same physio', async () => {
    const physio = await User.create({ phone: e164(nextPhone()) });
    const p1 = await User.create({ phone: e164(nextPhone()) });
    const p2 = await User.create({ phone: e164(nextPhone()) });
    const insert = (patient, range, status = 'booked') => sequelize.query(
      `INSERT INTO visits (therapist_id, patient_id, mode, status, during) VALUES (:t, :p, 'home', :s, tstzrange(:a, :b))`,
      { replacements: { t: physio.id, p: patient.id, s: status, a: range[0], b: range[1] } });
    await insert(p1, ['2026-11-19T09:00:00+05:30', '2026-11-19T09:45:00+05:30']);
    await expect(insert(p2, ['2026-11-19T09:30:00+05:30', '2026-11-19T10:15:00+05:30']))
      .rejects.toMatchObject({ name: 'SequelizeExclusionConstraintError', original: { constraint: 'visits_no_overlap' } });
    // a cancelled visit does not block the slot
    await insert(p2, ['2026-11-19T09:00:00+05:30', '2026-11-19T09:45:00+05:30'], 'cancelled');
    // back-to-back is fine
    await insert(p2, ['2026-11-19T09:45:00+05:30', '2026-11-19T10:30:00+05:30']);
  });
});
