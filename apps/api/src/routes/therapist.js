import { Router } from 'express';
import { z } from 'zod';
import { sequelize } from '../db/index.js';
import { HttpError } from '../lib/util.js';
import { asyncHandler, requireAuth, requireRole, validate } from '../middleware/index.js';
import { checkIn, completeVisit, nobodyPresent, onTheWay, raiseSos, recordLocation, respondConsent } from '../services/visits.js';
import { markCashReceived } from '../services/booking.js';

export const therapistRouter = Router();
therapistRouter.use(requireAuth, requireRole('therapist'));
const q = async (sql, replacements) => (await sequelize.query(sql, { replacements }))[0];
const one = async (sql, replacements) => (await q(sql, replacements))[0];

export const REQUIRED_DOCS = ['aadhaar_pan', 'selfie', 'degree', 'council_registration', 'police_verification', 'bank_proof'];
export const AGREEMENT_VERSION = '2.1';

// ---------- onboarding ----------
therapistRouter.get('/profile', asyncHandler(async (req, res) => {
  const profile = await one(`SELECT qualification, years_experience, bio, specialisations, languages, home_lat, home_lng, service_radius_km,
    verification_status, accepting, tier, rating, female_patients_only, submitted_at, verified_at, review_note FROM therapist_profiles WHERE user_id = :u`, { u: req.user.id });
  const docs = await q(`SELECT DISTINCT ON (type) id, type, status, review_note, file_id, created_at FROM therapist_documents WHERE therapist_id = :u ORDER BY type, created_at DESC`, { u: req.user.id });
  const agreement = await one(`SELECT version, created_at FROM consents WHERE user_id = :u AND document = 'partner_agreement' AND accepted ORDER BY created_at DESC LIMIT 1`, { u: req.user.id });
  res.json({
    profile: profile ?? null, documents: docs,
    missingDocuments: REQUIRED_DOCS.filter(t => !docs.some(d => d.type === t && d.status !== 'rejected')),
    agreement: agreement ? { version: agreement.version, signedAt: agreement.created_at, current: agreement.version === AGREEMENT_VERSION } : null,
  });
}));

therapistRouter.put('/profile', validate(z.object({
  qualification: z.enum(['BPT', 'MPT', 'PhD']),
  yearsExperience: z.number().int().min(0).max(60),
  bio: z.string().trim().max(1000).optional(),
  specialisations: z.array(z.enum(['after_surgery', 'back_neck', 'sports', 'neuro', 'elderly', 'child'])).min(1),
  languages: z.array(z.string().max(8)).min(1),
  homeLat: z.number().min(-90).max(90),
  homeLng: z.number().min(-180).max(180),
  serviceRadiusKm: z.number().min(1).max(25),
  femalePatientsOnly: z.boolean().default(false),
})), asyncHandler(async (req, res) => {
  const b = req.body;
  await q(`INSERT INTO therapist_profiles (user_id, qualification, years_experience, bio, specialisations, languages, home_lat, home_lng, service_radius_km, female_patients_only)
    VALUES (:u, :q, :y, :bio, :s, :l, :lat, :lng, :r, :f)
    ON CONFLICT (user_id) DO UPDATE SET qualification = EXCLUDED.qualification, years_experience = EXCLUDED.years_experience, bio = EXCLUDED.bio,
      specialisations = EXCLUDED.specialisations, languages = EXCLUDED.languages, home_lat = EXCLUDED.home_lat, home_lng = EXCLUDED.home_lng,
      service_radius_km = EXCLUDED.service_radius_km, female_patients_only = EXCLUDED.female_patients_only, updated_at = now()`,
  { u: req.user.id, q: b.qualification, y: b.yearsExperience, bio: b.bio ?? null, s: `{${b.specialisations.join(',')}}`, l: `{${b.languages.join(',')}}`, lat: b.homeLat, lng: b.homeLng, r: b.serviceRadiusKm, f: b.femalePatientsOnly });
  res.json({ saved: true });
}));

therapistRouter.post('/documents', validate(z.object({
  type: z.enum(REQUIRED_DOCS), fileId: z.string().uuid(), expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})), asyncHandler(async (req, res) => {
  const f = await one(`SELECT id FROM files WHERE id = :f AND owner_user_id = :u AND hidden_at IS NULL`, { f: req.body.fileId, u: req.user.id });
  if (!f) throw new HttpError(400, 'file_invalid', 'Upload the document first.');
  const [doc] = await q(`INSERT INTO therapist_documents (therapist_id, type, file_id, expires_on) VALUES (:u, :t, :f, :e) RETURNING id, type, status`,
    { u: req.user.id, t: req.body.type, f: f.id, e: req.body.expiresOn ?? null });
  await q(`UPDATE files SET linked_type = 'therapist_document', linked_id = :d WHERE id = :f`, { d: doc.id, f: f.id });
  res.status(201).json({ document: doc });
}));

therapistRouter.post('/agreement', validate(z.object({ version: z.literal(AGREEMENT_VERSION), accepted: z.literal(true), signedName: z.string().trim().min(2).max(120) })), asyncHandler(async (req, res) => {
  await q(`INSERT INTO consents (user_id, document, version, accepted, method, meta, ip) VALUES (:u, 'partner_agreement', :v, true, 'app_otp', :m, :ip)`,
    { u: req.user.id, v: req.body.version, m: JSON.stringify({ signedName: req.body.signedName, includes: ['service_agreement', 'code_of_conduct', 'gender_safety_rule', 'strikes_policy'] }), ip: req.ip });
  res.status(201).json({ signed: true, version: req.body.version });
}));

therapistRouter.post('/submit', asyncHandler(async (req, res) => {
  const profile = await one(`SELECT verification_status, home_lat FROM therapist_profiles WHERE user_id = :u`, { u: req.user.id });
  if (!profile?.home_lat) throw new HttpError(409, 'profile_incomplete', 'Complete your profile and service area first.');
  if (profile.verification_status === 'verified') throw new HttpError(409, 'already_verified', 'You’re already verified.');
  const docs = await q(`SELECT DISTINCT ON (type) type, status FROM therapist_documents WHERE therapist_id = :u ORDER BY type, created_at DESC`, { u: req.user.id });
  const missing = REQUIRED_DOCS.filter(t => !docs.some(d => d.type === t && d.status !== 'rejected'));
  if (missing.length) throw new HttpError(409, 'documents_missing', 'Upload all required documents.', { missing });
  const agreement = await one(`SELECT 1 FROM consents WHERE user_id = :u AND document = 'partner_agreement' AND version = :v AND accepted`, { u: req.user.id, v: AGREEMENT_VERSION });
  if (!agreement) throw new HttpError(409, 'agreement_missing', 'Sign the partner agreement first.');
  await q(`UPDATE therapist_profiles SET verification_status = 'under_review', submitted_at = now(), updated_at = now() WHERE user_id = :u`, { u: req.user.id });
  res.json({ status: 'under_review' });
}));

// ---------- practice: hours and prices ----------
therapistRouter.put('/availability', validate(z.object({
  rules: z.array(z.object({
    weekday: z.number().int().min(0).max(6), start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/),
    modes: z.array(z.enum(['home', 'clinic', 'video'])).min(1),
  }).refine(r => r.end > r.start, 'End time must be after start time.')).max(42),
})), asyncHandler(async (req, res) => {
  await sequelize.transaction(async t => {
    await sequelize.query(`DELETE FROM availability_rules WHERE therapist_id = :u`, { replacements: { u: req.user.id }, transaction: t });
    for (const r of req.body.rules) {
      await sequelize.query(`INSERT INTO availability_rules (therapist_id, weekday, start_time, end_time, modes) VALUES (:u, :w, :s, :e, :m)`,
        { replacements: { u: req.user.id, w: r.weekday, s: r.start, e: r.end, m: `{${r.modes.join(',')}}` }, transaction: t });
    }
  });
  res.json({ saved: req.body.rules.length });
}));
therapistRouter.get('/availability', asyncHandler(async (req, res) => {
  res.json({ rules: await q(`SELECT weekday, to_char(start_time, 'HH24:MI') AS start, to_char(end_time, 'HH24:MI') AS end, modes FROM availability_rules WHERE therapist_id = :u ORDER BY weekday, start_time`, { u: req.user.id }) });
}));

therapistRouter.put('/prices', validate(z.object({
  prices: z.array(z.object({ mode: z.enum(['home', 'clinic', 'video']), pricePaise: z.number().int().min(10000).max(1000000) })).min(1),
})), asyncHandler(async (req, res) => {
  for (const p of req.body.prices) {
    await q(`INSERT INTO therapist_prices (therapist_id, mode, price_paise) VALUES (:u, :m, :p) ON CONFLICT (therapist_id, mode) DO UPDATE SET price_paise = EXCLUDED.price_paise`, { u: req.user.id, m: p.mode, p: p.pricePaise });
  }
  res.json({ saved: req.body.prices.length });
}));

// ---------- schedule and visits ----------
therapistRouter.get('/visits', asyncHandler(async (req, res) => {
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from)) ? String(req.query.from) : null;
  const rows = await q(`SELECT v.id, v.patient_id, v.mode, v.status, v.physio_consent, lower(v.during) AS starts_at, upper(v.during) AS ends_at, v.family_member,
      u.name AS patient_name, u.gender AS patient_gender, a.line1, a.landmark, a.lat, a.lng, z.name AS zone_name, z.color AS zone_color,
      p.sessions_total, pay.id AS payment_id, pay.method AS payment_method, pay.status AS payment_status, pay.amount_paise
    FROM visits v JOIN users u ON u.id = v.patient_id LEFT JOIN addresses a ON a.id = v.address_id LEFT JOIN zones z ON z.id = v.zone_id
      LEFT JOIN plans p ON p.id = v.plan_id LEFT JOIN payments pay ON pay.plan_id = v.plan_id
    WHERE v.therapist_id = :u AND v.status NOT IN ('held')
      AND lower(v.during) >= COALESCE(:from::date, (now() AT TIME ZONE 'Asia/Kolkata')::date) AT TIME ZONE 'Asia/Kolkata'
    ORDER BY lower(v.during) LIMIT 100`, { u: req.user.id, from });
  // Full address and name only for visits the physio can act on (not pending consent).
  res.json({ visits: rows.map(v => v.physio_consent === 'pending' ? { ...v, patient_name: null, line1: null, landmark: null, lat: null, lng: null } : v) });
}));

const id = z.object({});
therapistRouter.post('/visits/:id/consent', validate(z.object({ accept: z.boolean() })), asyncHandler(async (req, res) => res.json(await respondConsent({ therapistId: req.user.id, visitId: req.params.id, accept: req.body.accept, ip: req.ip }))));
therapistRouter.post('/visits/:id/on-the-way', validate(id), asyncHandler(async (req, res) => res.json(await onTheWay({ therapistId: req.user.id, visitId: req.params.id }))));
therapistRouter.post('/visits/:id/check-in', validate(z.object({ code: z.string().regex(/^\d{4}$/, 'Enter the 4-digit code.'), familyPresent: z.boolean().optional() })),
  asyncHandler(async (req, res) => res.json(await checkIn({ therapistId: req.user.id, visitId: req.params.id, ...req.body, ip: req.ip }))));
therapistRouter.post('/visits/:id/nobody-present', validate(id), asyncHandler(async (req, res) => res.json(await nobodyPresent({ therapistId: req.user.id, visitId: req.params.id }))));
therapistRouter.post('/visits/:id/location', validate(z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })),
  asyncHandler(async (req, res) => res.json(await recordLocation({ therapistId: req.user.id, visitId: req.params.id, ...req.body }))));
therapistRouter.post('/visits/:id/complete', validate(z.object({
  painScore: z.number().int().min(0).max(10).optional(),
  measurements: z.record(z.string().max(40), z.number()).optional(),
  exercises: z.array(z.object({ name: z.string().max(80), dose: z.string().max(40).optional() })).max(30).optional(),
  notes: z.string().max(2000).optional(), homePlan: z.string().max(2000).optional(),
})), asyncHandler(async (req, res) => res.json(await completeVisit({ therapistId: req.user.id, visitId: req.params.id, ...req.body }))));
therapistRouter.post('/sos', validate(z.object({ visitId: z.string().uuid().optional(), lat: z.number().optional(), lng: z.number().optional() })),
  asyncHandler(async (req, res) => res.status(201).json(await raiseSos({ userId: req.user.id, ...req.body, ip: req.ip }))));
therapistRouter.post('/payments/:id/cash-received', asyncHandler(async (req, res) => res.json(await markCashReceived({ therapistId: req.user.id, paymentId: req.params.id }))));
