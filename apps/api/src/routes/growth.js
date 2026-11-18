// Phase 4 routes: public link redirect, patient coins and referral, partner portal, admin growth.
import { Router } from 'express';
import QRCode from 'qrcode';
import { z } from 'zod';
import { config } from '../config/index.js';
import { sequelize } from '../db/index.js';
import { HttpError, normalizeIndianPhone } from '../lib/util.js';
import { asyncHandler, requireAuth, requireRole, validate } from '../middleware/index.js';
import { audit } from '../services/audit.js';
import {
  addCoins, addPartnerLink, applyPartner, attributionReport, coinsForCheckout, COINS_PER_RUPEE, createPartnerByAdmin, decidePartner,
  growthRules, hitLink, linkStats, partnerFor, partnerRewards, PARTNER_TYPES, payPartnerRewards, referralLink, saveGrowthRules, wallet,
} from '../services/growth.js';

const q = async (sql, replacements) => (await sequelize.query(sql, { replacements }))[0];
const one = async (sql, replacements) => (await q(sql, replacements))[0];
const linkUrl = code => `${config.publicApiUrl}/r/${encodeURIComponent(code)}`;
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const phoneField = z.string().transform((v, ctx) => normalizeIndianPhone(v) ?? (ctx.addIssue({ code: 'custom', message: 'Enter a valid Indian mobile number.' }), z.NEVER));

async function sendQr(res, code, label) {
  const png = await QRCode.toBuffer(`${linkUrl(code)}?src=qr`, { width: 720, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#0A1F44', light: '#FFFFFF' } });
  res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=300', 'Content-Disposition': `inline; filename="PhysioConnect-${label ?? code}.png"` }).send(png);
}

// ---------- public: /r/:code (QR scan or shared link) → website with ?ref ----------
export const linkRouter = Router();
linkRouter.get('/:code', asyncHandler(async (req, res) => {
  const code = String(req.params.code).slice(0, 40);
  const utm = Object.fromEntries(['utm_source', 'utm_medium', 'utm_campaign'].filter(k => req.query[k]).map(k => [k.slice(4), String(req.query[k]).slice(0, 80)]));
  const valid = await hitLink(code, { scan: req.query.src === 'qr', ip: req.ip, utm: Object.keys(utm).length ? utm : null });
  const target = new URL(config.siteUrl);
  if (valid) target.searchParams.set('ref', valid);
  for (const [k, v] of Object.entries(utm)) target.searchParams.set(`utm_${k}`, v);
  res.redirect(302, target.toString());
}));

// ---------- patient: coins and referral ----------
export const growthRouter = Router();
growthRouter.use(requireAuth);
growthRouter.get('/coins', asyncHandler(async (req, res) => res.json(await wallet(req.user.id))));
growthRouter.get('/coins/checkout', asyncHandler(async (req, res) => {
  const amount = Number(req.query.amountPaise);
  if (!Number.isInteger(amount) || amount <= 0) throw new HttpError(400, 'bad_amount', 'amountPaise is required.');
  res.json(await coinsForCheckout(req.user.id, amount));
}));
growthRouter.get('/referral', asyncHandler(async (req, res) => {
  const link = await referralLink({ id: req.user.id, name: req.user.model?.name });
  const [stats] = await linkStats('l.id = :id', { id: link.id });
  const rules = await growthRules();
  res.json({
    code: link.code, url: linkUrl(link.code), shareText: `I use PhysioConnect for physiotherapy at home in Patna. Join with my link and get ${rules.welcomeCoins} coins (₹${rules.welcomeCoins / COINS_PER_RUPEE}) off: ${linkUrl(link.code)}`,
    joined: stats?.signups ?? 0, booked: stats?.paid ?? 0, referrerCoins: rules.referrerCoins, welcomeCoins: rules.welcomeCoins, coinsPerRupee: COINS_PER_RUPEE,
  });
}));

// ---------- partner portal ----------
export const partnerRouter = Router();
partnerRouter.use(requireAuth);
const partnerBody = z.object({
  name: z.string().trim().min(2).max(160),
  type: z.enum(PARTNER_TYPES),
  contactName: z.string().trim().max(120).optional(),
  address: z.string().trim().max(500).optional(),
  registrationNo: z.string().trim().max(64).optional(),
  payoutTo: z.string().trim().max(200).optional(),
});
partnerRouter.post('/apply', validate(partnerBody), asyncHandler(async (req, res) => res.status(201).json(await applyPartner({ id: req.user.id, phone: req.user.model?.phone }, req.body))));
async function myPartner(req) {
  const p = await partnerFor(req.user.id);
  if (!p) throw new HttpError(404, 'not_partner', 'No partner account yet.');
  return p;
}
partnerRouter.get('/me', asyncHandler(async (req, res) => {
  const p = await partnerFor(req.user.id);
  if (!p) return res.json({ partner: null, types: PARTNER_TYPES });
  const links = (await linkStats('l.owner_partner_id = :p', { p: p.id })).map(l => ({ ...l, url: linkUrl(l.code), qrUrl: `/api/v1/partner/links/${l.id}/qr.png` }));
  res.json({ partner: p, types: PARTNER_TYPES, links, ...(await partnerRewards(p.id)), rewardPaise: p.reward_paise ?? (await growthRules()).partnerRewardPaise });
}));
partnerRouter.patch('/me', validate(z.object({ payoutTo: z.string().trim().min(5).max(200).optional(), address: z.string().trim().max(500).optional(), contactName: z.string().trim().max(120).optional() })),
  asyncHandler(async (req, res) => {
    const p = await myPartner(req);
    if (p.access !== 'owner') throw new HttpError(403, 'forbidden', 'Only the owner can change these details.');
    await q(`UPDATE partner_orgs SET payout_to = COALESCE(:payout, payout_to), address = COALESCE(:addr, address), contact_name = COALESCE(:c, contact_name), updated_at = now() WHERE id = :id`,
      { payout: req.body.payoutTo ?? null, addr: req.body.address ?? null, c: req.body.contactName ?? null, id: p.id });
    res.json({ ok: true });
  }));
partnerRouter.post('/links', validate(z.object({ label: z.string().trim().min(2).max(60) })), asyncHandler(async (req, res) => {
  const p = await myPartner(req);
  const l = await addPartnerLink(p.id, req.body.label);
  res.status(201).json({ link: { ...l, url: linkUrl(l.code), qrUrl: `/api/v1/partner/links/${l.id}/qr.png` } });
}));
partnerRouter.get('/links/:id/qr.png', asyncHandler(async (req, res) => {
  const p = await myPartner(req);
  const l = await one(`SELECT code, meta->>'label' AS label FROM tracked_links WHERE id = :id AND owner_partner_id = :p`, { id: req.params.id, p: p.id });
  if (!l) throw new HttpError(404, 'not_found', 'QR not found.');
  await sendQr(res, l.code, l.label);
}));

// ---------- admin ----------
export const adminGrowthRouter = Router();
adminGrowthRouter.use(requireAuth);
const staff = requireRole('ops_admin', 'city_coordinator', 'super_admin');
const finance = requireRole('finance', 'super_admin');
const growthView = requireRole('ops_admin', 'city_coordinator', 'finance', 'super_admin');

adminGrowthRouter.get('/partners', growthView, asyncHandler(async (req, res) => {
  const status = ['pending', 'approved', 'rejected', 'suspended'].includes(String(req.query.status)) ? String(req.query.status) : 'pending';
  res.json({ partners: await q(`SELECT p.id, p.name, p.type, p.status, p.contact_name, p.phone, p.registration_no, p.created_at,
      (SELECT count(*)::int FROM attributions a WHERE a.credited_partner_id = p.id) AS signups,
      (SELECT count(*)::int FROM attributions a WHERE a.credited_partner_id = p.id AND a.locked_at IS NOT NULL) AS paid,
      (SELECT COALESCE(sum(amount_paise), 0)::int FROM partner_rewards r WHERE r.partner_id = p.id AND r.status = 'earned') AS due_paise
    FROM partner_orgs p WHERE p.status = :s ORDER BY p.created_at DESC LIMIT 200`, { s: status }) });
}));
adminGrowthRouter.post('/partners', staff, validate(partnerBody.extend({ phone: phoneField, rewardPaise: z.number().int().min(0).max(1_000_000).optional() })),
  asyncHandler(async (req, res) => res.status(201).json(await createPartnerByAdmin(req.user, req.body, req.ip))));
adminGrowthRouter.get('/partners/:id', growthView, asyncHandler(async (req, res) => {
  const p = await one(`SELECT * FROM partner_orgs WHERE id = :id`, { id: req.params.id });
  if (!p) throw new HttpError(404, 'not_found', 'Partner not found.');
  const links = await linkStats('l.owner_partner_id = :p', { p: p.id });
  res.json({ partner: p, links: links.map(l => ({ ...l, url: linkUrl(l.code), qrUrl: `/api/v1/admin/growth/links/${l.id}/qr.png` })), ...(await partnerRewards(p.id)), defaultRewardPaise: (await growthRules()).partnerRewardPaise });
}));
adminGrowthRouter.post('/partners/:id/decide', staff, validate(z.object({ approve: z.boolean(), note: z.string().trim().max(500).optional(), rewardPaise: z.number().int().min(0).max(1_000_000).optional() })),
  asyncHandler(async (req, res) => {
    if (!req.body.approve && !req.body.note) throw new HttpError(400, 'note_required', 'Give a reason.');
    res.json(await decidePartner(req.user, req.params.id, req.body, req.ip));
  }));
adminGrowthRouter.post('/partners/:id/rewards/paid', finance, validate(z.object({ reference: z.string().trim().min(4).max(64) })),
  asyncHandler(async (req, res) => res.json(await payPartnerRewards(req.user, req.params.id, req.body.reference, req.ip))));
adminGrowthRouter.get('/links/:id/qr.png', growthView, asyncHandler(async (req, res) => {
  const l = await one(`SELECT code, meta->>'label' AS label FROM tracked_links WHERE id = :id`, { id: req.params.id });
  if (!l) throw new HttpError(404, 'not_found', 'QR not found.');
  await sendQr(res, l.code, l.label);
}));
adminGrowthRouter.get('/attribution', growthView, asyncHandler(async (req, res) => {
  const to = ymd.safeParse(req.query.to).success ? String(req.query.to) : new Date().toISOString().slice(0, 10);
  const from = ymd.safeParse(req.query.from).success ? String(req.query.from) : new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  res.json(await attributionReport(from, to));
}));
const rulesBody = z.object({
  welcomeCoins: z.number().int().min(0).max(100_000),
  referrerCoins: z.number().int().min(0).max(100_000),
  maxCoinPct: z.number().int().min(0).max(100),
  partnerRewardPaise: z.number().int().min(0).max(1_000_000),
});
adminGrowthRouter.get('/rules', growthView, asyncHandler(async (_req, res) => res.json({ rules: await growthRules(), coinsPerRupee: COINS_PER_RUPEE })));
adminGrowthRouter.put('/rules', requireRole('super_admin'), validate(rulesBody), asyncHandler(async (req, res) => res.json({ rules: await saveGrowthRules(req.user, req.body, req.ip) })));
// Super admin: manual coin adjustment (goodwill or correction), always with a reason.
adminGrowthRouter.post('/coins/adjust', requireRole('super_admin'), validate(z.object({ phone: phoneField, delta: z.number().int().min(-100_000).max(100_000).refine(v => v !== 0), note: z.string().trim().min(3).max(300) })),
  asyncHandler(async (req, res) => {
    const u = await one(`SELECT id FROM users WHERE phone = :p`, { p: req.body.phone });
    if (!u) throw new HttpError(404, 'not_found', 'No account with this number.');
    await sequelize.transaction(async t => {
      await addCoins({ userId: u.id, delta: req.body.delta, reason: 'adjust', note: req.body.note, createdBy: req.user.id }, t);
      await audit({ actor: req.user, action: 'coins.adjusted', targetType: 'user', targetId: u.id, after: { delta: req.body.delta, note: req.body.note }, ip: req.ip }, t);
    });
    res.json({ ok: true });
  }));
