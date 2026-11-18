// Website pages with their title, description and preview image filled in on the server, so Google, WhatsApp and
// Facebook show the right card without running JavaScript. The page itself is still the normal website app.
// Production: Caddy sends every website page request (not files) here: GET /_site/<path>.
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { config } from '../config/index.js';
import { sequelize } from '../db/index.js';
import { asyncHandler } from '../middleware/index.js';

const one = async (sql, replacements) => (await sequelize.query(sql, { replacements }))[0][0];
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const base = () => config.siteUrl.replace(/\/$/, '');
const fileUrl = id => `${config.publicApiUrl}/api/v1/files/${id}/content`;
// App screens: shown to people, never indexed.
const PRIVATE = /^\/(book|signin|about-you|payments|bookings|plans|visits|chat|rewards|notifications|preview|grievance\/)/;

let shell = { html: null, mtime: 0 };
function indexHtml() {
  const file = path.join(config.webSiteDist, 'index.html');
  const st = fs.statSync(file);
  if (st.mtimeMs !== shell.mtime) shell = { html: fs.readFileSync(file, 'utf8'), mtime: st.mtimeMs };
  return shell.html;
}

async function metaFor(p) {
  const site = (await one(`SELECT value FROM app_settings WHERE key = 'site'`))?.value ?? config.defaults.site;
  const fallback = { title: `${site.siteName} · ${site.tagline}`, description: 'Verified, police-checked physiotherapists at home in Patna. Female physios available. Pay by cash or UPI.', image: `${base()}/og-image.png`, status: 200, noindex: false, jsonLd: null };
  if (PRIVATE.test(p)) return { ...fallback, noindex: true };
  const physio = p.match(/^\/physios\/([0-9a-f-]{36})$/i);
  if (physio) {
    const t = await one(`SELECT u.name, tp.qualification, tp.years_experience, tp.bio, tp.rating::float AS rating, (SELECT count(*)::int FROM ratings r WHERE r.therapist_id = u.id) AS reviews
      FROM users u JOIN therapist_profiles tp ON tp.user_id = u.id WHERE u.id = :id AND tp.verification_status = 'verified' AND u.status = 'active'`, { id: physio[1] });
    if (!t) return { ...fallback, title: 'Page not found | PhysioCare', status: 404, noindex: true };
    return { ...fallback, title: `${t.name}, ${t.qualification ?? 'Physiotherapist'} in Patna | PhysioCare`, description: (t.bio || `${t.qualification ?? 'Physiotherapist'}${t.years_experience ? ` with ${t.years_experience} years’ experience` : ''}. Home visits in Patna, booked on PhysioCare.`).slice(0, 160),
      jsonLd: { '@context': 'https://schema.org', '@type': 'Physician', name: t.name, medicalSpecialty: 'PhysicalTherapy', address: { '@type': 'PostalAddress', addressLocality: 'Patna', addressRegion: 'Bihar', addressCountry: 'IN' },
        ...(t.rating && t.reviews ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: t.rating, reviewCount: t.reviews } } : {}) } };
  }
  if (p === '/physios') return { ...fallback, title: 'Verified physiotherapists in Patna | PhysioCare' };
  if (p === '/partner') return { ...fallback, title: 'For doctors, hospitals and labs | PhysioCare', description: 'Refer patients to verified home physiotherapy with your own QR code, and earn for every new patient.' };
  if (p === '/grievance') return { ...fallback, title: 'Complaints and Grievance Officer | PhysioCare' };
  const page = await one(`SELECT kind, published_title AS title, published_summary AS summary, published_seo AS seo, cover_file_id FROM cms_pages WHERE slug = :s AND status = 'published'`, { s: p.replace(/^\/+|\/+$/g, '') });
  if (!page) return { ...fallback, title: 'Page not found | PhysioCare', status: 404, noindex: true };
  const seo = page.seo ?? {};
  const t = seo.title || page.title;
  const isHome = p === '/' || p === '';
  return {
    title: isHome ? (seo.title || fallback.title) : t.includes('PhysioCare') ? t : `${t} | PhysioCare`,
    description: seo.description || page.summary || fallback.description,
    image: seo.imageFileId ? fileUrl(seo.imageFileId) : page.cover_file_id ? fileUrl(page.cover_file_id) : fallback.image,
    status: 200, noindex: Boolean(seo.noindex),
    jsonLd: isHome ? { '@context': 'https://schema.org', '@type': 'MedicalBusiness', name: site.siteName, url: base(), telephone: site.supportPhone || undefined, areaServed: 'Patna',
      address: { '@type': 'PostalAddress', addressLocality: 'Patna', addressRegion: 'Bihar', addressCountry: 'IN' }, medicalSpecialty: 'PhysicalTherapy' } : null,
  };
}

export const siteHtmlRouter = Router();
siteHtmlRouter.get(/^\/_site(\/.*)?$/, asyncHandler(async (req, res) => {
  const p = (req.params[0] || '/').split('?')[0].replace(/\/{2,}/g, '/') || '/';
  let html;
  try { html = indexHtml(); } catch { return res.status(503).send('Website build not found. Run `npm run build` and set WEB_SITE_DIST.'); }
  const m = await metaFor(p);
  const url = `${base()}${p === '/' ? '/' : p}`;
  const tags = [
    `<title>${esc(m.title)}</title>`,
    `<meta name="description" content="${esc(m.description)}" />`,
    `<link rel="canonical" href="${esc(url)}" />`,
    m.noindex ? '<meta name="robots" content="noindex" />' : '',
    `<meta property="og:type" content="website" />`, `<meta property="og:site_name" content="PhysioCare" />`,
    `<meta property="og:title" content="${esc(m.title)}" />`, `<meta property="og:description" content="${esc(m.description)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`, `<meta property="og:image" content="${esc(m.image)}" />`, `<meta property="og:locale" content="en_IN" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    m.jsonLd ? `<script type="application/ld+json">${JSON.stringify(m.jsonLd).replace(/</g, '\\u003c')}</script>` : '',
  ].filter(Boolean).join('\n    ');
  const out = html.replace(/<title>[\s\S]*?<\/title>/, '').replace(/<meta name="description"[^>]*>/, '').replace('</head>', `    ${tags}\n  </head>`);
  res.status(m.status).set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60' }).send(out);
}));
