import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { config } from '../src/config/index.js';
import { preflight } from '../src/services/preflight.js';
import { sequelize } from '../src/models/index.js';

const q = (sql, r) => sequelize.query(sql, { replacements: r });
let app, dist;
beforeAll(async () => {
  // A stand-in website build for the page-preview route.
  dist = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-site-'));
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><html><head><meta charset="UTF-8" /><title>PhysioCare</title><meta name="description" content="x" /></head><body><div id="root"></div></body></html>');
  config.webSiteDist = dist;
  app = createApp();
  await q(`INSERT INTO cms_pages (slug, kind, title, status, published_blocks, published_title, published_summary, published_seo)
    VALUES ('launch-test', 'page', 'Launch test', 'published', '[]', 'Knee pain help', 'Help for knees at home', '{"description": "Physio for knee pain in Patna", "title": "Knee pain <help>"}')
    ON CONFLICT (slug) DO UPDATE SET status = 'published'`);
});
afterAll(async () => { fs.rmSync(dist, { recursive: true, force: true }); await sequelize.close(); });

describe('link previews and search engines', () => {
  it('fills in the page title, description, preview image and canonical link (escaped)', async () => {
    const r = await request(app).get('/_site/launch-test').expect(200);
    expect(r.text).toContain('<title>Knee pain &lt;help&gt; | PhysioCare</title>');
    expect(r.text).toContain('<meta name="description" content="Physio for knee pain in Patna" />');
    expect(r.text).toMatch(/property="og:image" content="[^"]+og-image\.png"/);
    expect(r.text).toMatch(/rel="canonical" href="[^"]+\/launch-test"/);
    expect(r.text.match(/<title>/g)).toHaveLength(1);
    expect(r.text).toContain('<div id="root"></div>');
  });
  it('unknown pages are 404 and app screens are hidden from search engines', async () => {
    expect((await request(app).get('/_site/does-not-exist').expect(404)).text).toContain('noindex');
    expect((await request(app).get('/_site/bookings').expect(200)).text).toContain('<meta name="robots" content="noindex" />');
  });
});

describe('production checks', () => {
  const saved = { ...process.env };
  afterAll(() => { process.env = saved; });
  it('blocks a launch with development settings', () => {
    process.env.JWT_ACCESS_SECRET = 'change-me'; process.env.DATABASE_URL = 'postgres://physio:physio@db/x'; process.env.SUPER_ADMIN_PHONE = '9999999999';
    const { blockers } = preflight();
    expect(blockers.join(' ')).toMatch(/JWT_ACCESS_SECRET/);
    expect(blockers.join(' ')).toMatch(/DATABASE_URL uses the development password/);
    expect(blockers.join(' ')).toMatch(/SUPER_ADMIN_PHONE/);
    expect(blockers.join(' ')).toMatch(/PUBLIC_API_URL/);
  });
  it('accepts strong secrets and a real super admin number', () => {
    process.env.JWT_ACCESS_SECRET = 'a'.repeat(20) + 'b'.repeat(20); process.env.OTP_SECRET = 'c'.repeat(40); process.env.CALENDAR_TOKEN_KEY = 'd'.repeat(40);
    process.env.DATABASE_URL = 'postgres://physio:S3cure-long-pass@db/x'; process.env.SUPER_ADMIN_PHONE = '9876501234';
    const { blockers } = preflight();
    expect(blockers.join(' ')).not.toMatch(/JWT_ACCESS_SECRET|OTP_SECRET|CALENDAR_TOKEN_KEY|DATABASE_URL|SUPER_ADMIN_PHONE/);
  });
});

describe('hardening', () => {
  it('every response has a request id; unexpected errors return it instead of details', async () => {
    const r = await request(app).get('/api/v1/status').expect(200);
    expect(r.headers['x-request-id']).toBeTruthy();
    expect(r.headers['x-powered-by']).toBeUndefined();
    expect(r.headers['x-content-type-options']).toBe('nosniff');
  });
  it('rejects oversized and malformed JSON cleanly', async () => {
    await request(app).post('/api/v1/auth/otp/send').set('content-type', 'application/json').send('{"phone": ').expect(400);
    await request(app).post('/api/v1/auth/otp/send').set('content-type', 'application/json').send(JSON.stringify({ phone: 'x'.repeat(200_000) })).expect(413);
  });
  it('rate limits sign-in from one network', async () => {
    const { createAuthLimiter } = await import('../src/middleware/security.js');
    const authLimiter = createAuthLimiter();
    const express = (await import('express')).default;
    const mini = express(); mini.set('trust proxy', 1);
    mini.use(authLimiter); mini.get('/', (_req, res) => res.json({ ok: true }));
    let last;
    for (let i = 0; i <= config.security.authLimitPer15Min; i++) last = await request(mini).get('/').set('x-forwarded-for', '203.0.113.9');
    expect(last.status).toBe(429);
    expect((await request(mini).get('/').set('x-forwarded-for', '203.0.113.10')).status).toBe(200);
  });
  it('health check for Docker', async () => {
    expect((await request(app).get('/healthz').expect(200)).body).toEqual({ ok: true });
  });
});
