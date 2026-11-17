import { Router } from 'express';
import { z } from 'zod';
import { sequelize } from '../db/index.js';
import { asyncHandler, requireAuth, requireRole, validate } from '../middleware/index.js';
import { zoneForPoint } from '../lib/geo.js';

export const patientRouter = Router();
patientRouter.use(requireAuth, requireRole('patient'));

const q = async (sql, replacements) => (await sequelize.query(sql, { replacements }))[0];

patientRouter.get('/profile', asyncHandler(async (req, res) => {
  const [profile] = await q(`SELECT condition_category, procedure, surgery_date, preferred_gender, best_times FROM patient_profiles WHERE user_id = :u`, { u: req.user.id });
  res.json({ profile: profile ?? null });
}));

patientRouter.put('/profile', validate(z.object({
  conditionCategory: z.enum(['after_surgery', 'back_neck', 'sports', 'neuro', 'elderly', 'child']).optional(),
  procedure: z.string().trim().max(120).optional(),
  surgeryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  preferredGender: z.enum(['female', 'male', 'any']).default('any'),
  bestTimes: z.array(z.enum(['morning', 'afternoon', 'evening'])).default([]),
})), asyncHandler(async (req, res) => {
  const b = req.body;
  await q(`INSERT INTO patient_profiles (user_id, condition_category, procedure, surgery_date, preferred_gender, best_times)
    VALUES (:u, :c, :p, :s, :g, :t)
    ON CONFLICT (user_id) DO UPDATE SET condition_category = EXCLUDED.condition_category, procedure = EXCLUDED.procedure,
      surgery_date = EXCLUDED.surgery_date, preferred_gender = EXCLUDED.preferred_gender, best_times = EXCLUDED.best_times, updated_at = now()`,
  { u: req.user.id, c: b.conditionCategory ?? null, p: b.procedure ?? null, s: b.surgeryDate ?? null, g: b.preferredGender, t: `{${b.bestTimes.join(',')}}` });
  res.json({ saved: true });
}));

patientRouter.get('/addresses', asyncHandler(async (req, res) => {
  const rows = await q(`SELECT a.id, a.label, a.line1, a.landmark, a.pin_code, a.lat, a.lng, a.is_default, z.name AS zone_name, z.color AS zone_color
    FROM addresses a LEFT JOIN zones z ON z.id = a.zone_id WHERE a.user_id = :u ORDER BY a.is_default DESC, a.created_at`, { u: req.user.id });
  res.json({ addresses: rows });
}));

patientRouter.post('/addresses', validate(z.object({
  label: z.string().trim().max(40).default('Home'),
  line1: z.string().trim().min(5).max(200),
  landmark: z.string().trim().max(120).optional(),
  pinCode: z.string().regex(/^\d{6}$/).optional(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  isDefault: z.boolean().default(false),
})), asyncHandler(async (req, res) => {
  const b = req.body;
  const zone = await zoneForPoint(b.lat, b.lng);
  const [[{ n }]] = await sequelize.query(`SELECT count(*)::int AS n FROM addresses WHERE user_id = :u`, { replacements: { u: req.user.id } });
  const isDefault = b.isDefault || n === 0;
  if (isDefault) await q(`UPDATE addresses SET is_default = false WHERE user_id = :u`, { u: req.user.id });
  const [row] = await q(`INSERT INTO addresses (user_id, label, line1, landmark, pin_code, lat, lng, zone_id, is_default)
    VALUES (:u, :label, :line1, :lm, :pin, :lat, :lng, :z, :d) RETURNING id`,
  { u: req.user.id, label: b.label, line1: b.line1, lm: b.landmark ?? null, pin: b.pinCode ?? null, lat: b.lat, lng: b.lng, z: zone?.id ?? null, d: isDefault });
  // The zone decides visit rules, so the app shows it straight away.
  res.status(201).json({ id: row.id, zone: zone ?? { name: null, color: 'red', outsideService: true } });
}));

patientRouter.post('/consents', validate(z.object({
  consents: z.array(z.object({
    document: z.enum(['terms', 'privacy', 'code_of_conduct', 'location_sharing', 'surgeon_sharing']),
    version: z.string().max(16),
    accepted: z.boolean(),
  })).min(1),
})), asyncHandler(async (req, res) => {
  for (const c of req.body.consents) {
    await q(`INSERT INTO consents (user_id, document, version, accepted, method, ip) VALUES (:u, :d, :v, :a, 'checkbox', :ip)`,
      { u: req.user.id, d: c.document, v: c.version, a: c.accepted, ip: req.ip });
  }
  res.status(201).json({ recorded: req.body.consents.length });
}));
