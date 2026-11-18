import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { validateBlocks } from '@physioconnect/shared/cms';
import { createApp } from '../src/app.js';
import { lastCodeSentTo } from '../src/services/sms.js';
import { User, sequelize } from '../src/models/index.js';

const app = createApp();
let n = 0;
const phone = () => `93${String(40000000 + ++n).padStart(8, '0')}`;
const q = (sql, r) => sequelize.query(sql, { replacements: r });
const auth = t => ({ authorization: `Bearer ${t}` });
async function signUp(extra = {}) {
  const p = phone();
  await request(app).post('/api/v1/auth/otp/send').send({ phone: p }).expect(200);
  const res = await request(app).post('/api/v1/auth/otp/verify').send({ phone: p, code: lastCodeSentTo(`+91${p}`), ...extra }).expect(201);
  await User.update({ name: `Cms ${n}` }, { where: { id: res.body.user.id } });
  return { id: res.body.user.id, token: res.body.tokens.accessToken };
}
async function withRole(role) { const u = await signUp(); await q(`INSERT INTO user_roles (user_id, role) VALUES (:u, :r)`, { u: u.id, r: role }); return u; }
const slug = () => `test-page-${n}-${Date.now() % 100000}`;

let editor, patient, superAdmin;
beforeAll(async () => { editor = await withRole('content_editor'); superAdmin = await withRole('super_admin'); patient = await signUp(); });
afterAll(async () => { await sequelize.close(); });

describe('block validation', () => {
  it('rejects unknown types, missing required fields and unsafe links', () => {
    expect(validateBlocks([{ id: 'a', type: 'nope' }])).toMatch(/unknown type/);
    expect(validateBlocks([{ id: 'a', type: 'hero' }])).toMatch(/Heading/);
    expect(validateBlocks([{ id: 'a', type: 'cta', heading: 'Go', label: 'Go', href: 'javascript:alert(1)' }])).toMatch(/must start with/);
    expect(validateBlocks([{ id: 'a', type: 'faq', items: [{ q: 'Q?', a: 'A.' }] }, { id: 'b', type: 'pageList', kind: 'service', limit: 6 }])).toBeNull();
  });
});

describe('pages', () => {
  let id, s;
  it('only editors can create pages; reserved app addresses are refused', async () => {
    s = slug();
    const body = { slug: s, kind: 'page', title: 'Knee care', blocks: [{ id: 'h', type: 'hero', heading: 'Knee care at home' }], seo: { description: 'Help for knees' } };
    await request(app).post('/api/v1/admin/cms/pages').set(auth(patient.token)).send(body).expect(403);
    await request(app).post('/api/v1/admin/cms/pages').set(auth(editor.token)).send({ ...body, slug: 'book/thing' }).expect(400);
    await request(app).post('/api/v1/admin/cms/pages').set(auth(editor.token)).send({ ...body, blocks: [{ id: 'x', type: 'hero' }] }).expect(400);
    id = (await request(app).post('/api/v1/admin/cms/pages').set(auth(editor.token)).send(body).expect(201)).body.id;
    await request(app).post('/api/v1/admin/cms/pages').set(auth(editor.token)).send(body).expect(409);
  });
  it('drafts are not public until published; later edits stay hidden until published again', async () => {
    await request(app).get(`/api/v1/public/page?path=/${s}`).expect(404);
    await request(app).post(`/api/v1/admin/cms/pages/${id}/publish`).set(auth(editor.token)).expect(200);
    expect((await request(app).get(`/api/v1/public/page?path=/${s}/`).expect(200)).body.page).toMatchObject({ title: 'Knee care', blocks: [{ heading: 'Knee care at home' }] });
    await request(app).put(`/api/v1/admin/cms/pages/${id}`).set(auth(editor.token)).send({ slug: s, kind: 'page', title: 'Knee care (new)', blocks: [{ id: 'h', type: 'hero', heading: 'Changed' }], seo: {} }).expect(200);
    expect((await request(app).get(`/api/v1/public/page?path=${s}`).expect(200)).body.page.title).toBe('Knee care');
    expect((await request(app).get(`/api/v1/admin/cms/preview?path=${s}`).set(auth(editor.token)).expect(200)).body.page.title).toBe('Knee care (new)');
    await request(app).get(`/api/v1/admin/cms/preview?path=${s}`).set(auth(patient.token)).expect(403);
  });
  it('every save is a version that can be restored', async () => {
    const { revisions } = (await request(app).get(`/api/v1/admin/cms/pages/${id}`).set(auth(editor.token)).expect(200)).body;
    expect(revisions.map(r => r.action)).toEqual(['saved', 'published', 'saved']);
    await request(app).post(`/api/v1/admin/cms/pages/${id}/restore/${revisions[2].id}`).set(auth(editor.token)).expect(200);
    expect((await request(app).get(`/api/v1/admin/cms/pages/${id}`).set(auth(editor.token)).expect(200)).body.page.title).toBe('Knee care');
  });
  it('unpublish takes it offline; only a super admin can archive; the home page stays online', async () => {
    await request(app).post(`/api/v1/admin/cms/pages/${id}/unpublish`).set(auth(editor.token)).expect(200);
    await request(app).get(`/api/v1/public/page?path=${s}`).expect(404);
    await request(app).delete(`/api/v1/admin/cms/pages/${id}`).set(auth(editor.token)).expect(403);
    await request(app).delete(`/api/v1/admin/cms/pages/${id}`).set(auth(superAdmin.token)).expect(204);
    const [[home]] = await q(`INSERT INTO cms_pages (slug, kind, title, status, published_blocks, published_title) VALUES ('', 'page', 'Home', 'published', '[]', 'Home') ON CONFLICT (slug) DO UPDATE SET status = 'published' RETURNING id`);
    await request(app).post(`/api/v1/admin/cms/pages/${home.id}/unpublish`).set(auth(editor.token)).expect(409);
  });
  it('lists published pages of a kind', async () => {
    const sl = `services/test-${n}`;
    const r = await request(app).post('/api/v1/admin/cms/pages').set(auth(editor.token)).send({ slug: sl, kind: 'service', title: 'Test service', summary: 'Short', blocks: [], seo: {} }).expect(201);
    await request(app).post(`/api/v1/admin/cms/pages/${r.body.id}/publish`).set(auth(editor.token)).expect(200);
    expect((await request(app).get('/api/v1/public/pages?kind=service').expect(200)).body.pages.some(p => p.slug === sl && p.summary === 'Short')).toBe(true);
  });
});

describe('site settings, directory and SEO', () => {
  it('site settings have defaults and editors can change them', async () => {
    const site = (await request(app).get('/api/v1/public/site').expect(200)).body.site;
    expect(site.siteName).toMatch(/PhysioCare/);
    await request(app).put('/api/v1/admin/cms/site').set(auth(editor.token)).send({ ...site, email: 'not-an-email' }).expect(400);
    await request(app).put('/api/v1/admin/cms/site').set(auth(editor.token)).send({ ...site, supportPhone: '+91 90000 00000', announcement: { enabled: true, text: 'Now in Danapur', href: '/patna' } }).expect(200);
    expect((await request(app).get('/api/v1/public/site').expect(200)).body.site.announcement.text).toBe('Now in Danapur');
  });
  it('the physio directory lists verified physios without phone numbers or locations', async () => {
    const t = await signUp({ role: 'therapist' });
    await q(`INSERT INTO therapist_profiles (user_id, qualification, years_experience, home_lat, home_lng, verification_status, specialisations) VALUES (:u, 'MPT', 7, 25.6, 85.1, 'verified', '{neuro}')`, { u: t.id });
    const list = (await request(app).get('/api/v1/public/physios?speciality=neuro').expect(200)).body.physios;
    const me = list.find(p => p.id === t.id);
    expect(me).toMatchObject({ qualification: 'MPT', years_experience: 7 });
    expect(me).not.toHaveProperty('phone');
    expect(me).not.toHaveProperty('home_lat');
    await request(app).get(`/api/v1/public/physios/${t.id}`).expect(200);
    await request(app).get(`/api/v1/public/physios/${patient.id}`).expect(404);
  });
  it('sitemap and robots.txt', async () => {
    const sm = await request(app).get('/sitemap.xml').expect(200);
    expect(sm.headers['content-type']).toMatch(/xml/);
    expect(sm.text).toContain('/physios</loc>');
    expect((await request(app).get('/robots.txt').expect(200)).text).toMatch(/Sitemap: .*sitemap\.xml/);
  });
  it('content editors can upload public website images; patients cannot', async () => {
    const png = Buffer.from('89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D49444154789C6360000002000154A24F5D0000000049454E44AE426082', 'hex');
    await request(app).post('/api/v1/files').set(auth(patient.token)).field('purpose', 'website_media').field('visibility', 'public').attach('file', png, 'x.png').expect(403);
    const f = (await request(app).post('/api/v1/files').set(auth(editor.token)).field('purpose', 'website_media').field('visibility', 'public').attach('file', png, 'x.png').expect(201)).body.file;
    await request(app).get(`/api/v1/files/${f.id}/content`).expect(200);
  });
  it('content editors cannot see users', async () => {
    await request(app).get('/api/v1/admin/control/users').set(auth(editor.token)).expect(403);
  });
});
