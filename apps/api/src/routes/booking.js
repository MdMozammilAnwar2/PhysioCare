import { Router } from 'express';
import { z } from 'zod';
import { sequelize } from '../db/index.js';
import { HttpError } from '../lib/util.js';
import { istDate } from '../lib/time.js';
import { zoneForPoint } from '../lib/geo.js';
import { asyncHandler, requireAuth, requireRole, validate } from '../middleware/index.js';
import { matchTherapists } from '../services/matching.js';
import { freeSlots } from '../services/slots.js';
import { confirmPayment, holdBooking } from '../services/booking.js';
import { verifyCheckoutSignature, verifyWebhookSignature } from '../services/payments.js';

const one = async (sql, replacements) => (await sequelize.query(sql, { replacements }))[0][0];
const modeField = z.enum(['home', 'clinic', 'video']);

async function patientContext(userId) {
  const p = await one(`SELECT u.id, u.gender, COALESCE(pp.preferred_gender::text, 'any') AS preferred_gender, pp.condition_category
    FROM users u LEFT JOIN patient_profiles pp ON pp.user_id = u.id WHERE u.id = :u`, { u: userId });
  return { id: p.id, gender: p.gender, preferredGender: p.preferred_gender, conditionCategory: p.condition_category };
}
async function addressWithZone(userId, addressId) {
  const a = await one(`SELECT id, lat, lng FROM addresses WHERE id = :id AND user_id = :u`, { id: addressId, u: userId });
  if (!a) throw new HttpError(400, 'address_required', 'Add the address for the home visit.');
  return { address: a, zone: await zoneForPoint(a.lat, a.lng) };
}

// ---------- therapists: match, profile, slots ----------
export const therapistsRouter = Router();
therapistsRouter.use(requireAuth);

therapistsRouter.post('/match', requireRole('patient'), validate(z.object({
  mode: modeField, addressId: z.string().uuid().optional(), specialisation: z.string().max(40).optional(), familyPresent: z.boolean().default(false),
})), asyncHandler(async (req, res) => {
  const patient = await patientContext(req.user.id);
  const { address, zone } = req.body.mode === 'home' ? await addressWithZone(req.user.id, req.body.addressId) : { address: null, zone: null };
  const matches = await matchTherapists({ patient, address, zone, mode: req.body.mode, specialisation: req.body.specialisation ?? patient.conditionCategory, familyPresent: req.body.familyPresent });
  res.json({ zone, matches });
}));

therapistsRouter.get('/:id', asyncHandler(async (req, res) => {
  const t = await one(`SELECT u.id, u.name, u.gender, tp.qualification, tp.years_experience, tp.bio, tp.specialisations, tp.languages, tp.rating, tp.tier
    FROM users u JOIN therapist_profiles tp ON tp.user_id = u.id WHERE u.id = :id AND tp.verification_status = 'verified' AND u.status = 'active'`, { id: req.params.id });
  if (!t) throw new HttpError(404, 'not_found', 'Physio not found.');
  const [prices] = await sequelize.query(`SELECT mode, price_paise FROM therapist_prices WHERE therapist_id = :id`, { replacements: { id: t.id } });
  const [packages] = await sequelize.query(`SELECT id, name, mode, sessions, price_paise, validity_days FROM packages WHERE therapist_id = :id AND active`, { replacements: { id: t.id } });
  res.json({ therapist: { ...t, rating: t.rating ? Number(t.rating) : null, prices, packages } });
}));

therapistsRouter.get('/:id/slots', requireRole('patient'), asyncHandler(async (req, res) => {
  const mode = modeField.parse(req.query.mode);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from)) ? String(req.query.from) : istDate(new Date());
  const days = Math.min(14, Math.max(1, Number(req.query.days) || 7));
  const { address, zone } = mode === 'home' ? await addressWithZone(req.user.id, String(req.query.addressId)) : { address: null, zone: null };
  res.json({ slots: await freeSlots({ therapistId: req.params.id, mode, fromDate: from, days, address, zone }) });
}));

// ---------- bookings ----------
export const bookingsRouter = Router();
bookingsRouter.use(requireAuth, requireRole('patient'));

bookingsRouter.post('/hold', validate(z.object({
  therapistId: z.string().uuid(), start: z.string().datetime({ offset: true }), mode: modeField,
  addressId: z.string().uuid().optional(), packageId: z.string().uuid().optional(),
  familyMember: z.object({ name: z.string().trim().min(2).max(80), relation: z.string().trim().min(2).max(40) }).optional(),
})), asyncHandler(async (req, res) => {
  const patient = await patientContext(req.user.id);
  res.status(201).json(await holdBooking({ patient, ...req.body, ip: req.ip }));
}));

bookingsRouter.get('/', asyncHandler(async (req, res) => {
  const [rows] = await sequelize.query(`SELECT v.id, v.mode, v.status, lower(v.during) AS starts_at, upper(v.during) AS ends_at, u.name AS therapist_name,
      p.sessions_total, p.status AS plan_status, z.name AS zone_name, z.color AS zone_color
    FROM visits v JOIN users u ON u.id = v.therapist_id LEFT JOIN plans p ON p.id = v.plan_id LEFT JOIN zones z ON z.id = v.zone_id
    WHERE v.patient_id = :u AND v.status NOT IN ('held', 'cancelled') ORDER BY lower(v.during)`, { replacements: { u: req.user.id } });
  res.json({ bookings: rows });
}));

// ---------- payments ----------
export const paymentsRouter = Router();

// Called by the app after Razorpay Checkout succeeds.
paymentsRouter.post('/razorpay/verify', requireAuth, validate(z.object({
  orderId: z.string().min(6).max(64), paymentId: z.string().min(6).max(64), signature: z.string().max(128),
})), asyncHandler(async (req, res) => {
  const { orderId, paymentId, signature } = req.body;
  const owner = await one(`SELECT patient_id FROM payments WHERE provider_order_id = :o`, { o: orderId });
  if (!owner || owner.patient_id !== req.user.id) throw new HttpError(404, 'order_not_found', 'Payment not found.');
  if (!verifyCheckoutSignature(orderId, paymentId, signature)) throw new HttpError(400, 'signature_invalid', 'We couldn’t verify this payment. If money was taken, it will be refunded.');
  res.json(await confirmPayment({ orderId, paymentId }));
}));

// Razorpay → server. Body is raw (see app.js) so the signature can be checked byte-for-byte.
paymentsRouter.post('/razorpay/webhook', asyncHandler(async (req, res) => {
  const raw = req.body instanceof Buffer ? req.body.toString('utf8') : '';
  if (!verifyWebhookSignature(raw, req.get('x-razorpay-signature'))) throw new HttpError(400, 'signature_invalid', 'Bad signature.');
  const event = JSON.parse(raw);
  if (event.event === 'payment.captured' || event.event === 'order.paid') {
    const p = event.payload?.payment?.entity;
    if (p?.order_id) await confirmPayment({ orderId: p.order_id, paymentId: p.id, raw: event });
  }
  res.json({ ok: true });
}));

// ---------- notifications ----------
export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);
notificationsRouter.get('/', asyncHandler(async (req, res) => {
  const [rows] = await sequelize.query(`SELECT id, type, title, body, data, read_at, created_at FROM notifications WHERE user_id = :u ORDER BY created_at DESC LIMIT 50`, { replacements: { u: req.user.id } });
  res.json({ notifications: rows });
}));
