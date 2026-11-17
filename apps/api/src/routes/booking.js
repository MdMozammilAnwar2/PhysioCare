import { Router } from 'express';
import { z } from 'zod';
import { sequelize } from '../db/index.js';
import { HttpError } from '../lib/util.js';
import { istDate } from '../lib/time.js';
import { zoneForPoint } from '../lib/geo.js';
import { asyncHandler, requireAuth, requireRole, validate } from '../middleware/index.js';
import { matchTherapists } from '../services/matching.js';
import { freeSlots } from '../services/slots.js';
import QRCode from 'qrcode';
import { ADMIN_ROLES } from '@physioconnect/shared';
import { checkinCode } from '../services/visits.js';
import { confirmBooking, holdBooking, markCashReceived, reviewPayment, submitUpiProof, upiSettings, upiUri } from '../services/booking.js';

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
  const [rows] = await sequelize.query(`SELECT v.id, v.plan_id, v.mode, v.status, lower(v.during) AS starts_at, upper(v.during) AS ends_at, u.name AS therapist_name,
      EXISTS (SELECT 1 FROM ratings r WHERE r.visit_id = v.id) AS rated,
      p.sessions_total, p.status AS plan_status, z.name AS zone_name, z.color AS zone_color,
      pay.id AS payment_id, pay.method AS payment_method, pay.status AS payment_status, pay.reference AS payment_reference, pay.amount_paise
    FROM visits v JOIN users u ON u.id = v.therapist_id LEFT JOIN plans p ON p.id = v.plan_id LEFT JOIN zones z ON z.id = v.zone_id LEFT JOIN payments pay ON pay.plan_id = v.plan_id
    WHERE v.patient_id = :u AND v.status NOT IN ('held', 'cancelled') ORDER BY lower(v.during)`, { replacements: { u: req.user.id } });
  res.json({ bookings: rows });
}));

// Patient picks Cash or UPI for a held slot; the booking is confirmed at once.
bookingsRouter.post('/:visitId/confirm', validate(z.object({ method: z.enum(['cash', 'upi']) })), asyncHandler(async (req, res) => {
  res.json(await confirmBooking({ patientId: req.user.id, visitId: req.params.visitId, method: req.body.method }));
}));

// ---------- payments (Cash, UPI-QR) ----------
export const paymentsRouter = Router();
paymentsRouter.use(requireAuth);
const isAdmin = u => u.roles.some(r => ADMIN_ROLES.includes(r));

async function paymentFor(req) {
  const p = await one(`SELECT pay.*, pl.therapist_id FROM payments pay JOIN plans pl ON pl.id = pay.plan_id WHERE pay.id = :id`, { id: req.params.id });
  if (!p || (p.patient_id !== req.user.id && p.therapist_id !== req.user.id && !isAdmin(req.user))) throw new HttpError(404, 'not_found', 'Payment not found.');
  return p;
}

paymentsRouter.get('/:id', asyncHandler(async (req, res) => {
  const p = await paymentFor(req);
  const upi = p.method === 'upi' ? await upiSettings() : null;
  res.json({ payment: {
    id: p.id, method: p.method, status: p.status, reference: p.reference, amountPaise: p.amount_paise, utr: p.utr,
    proofFileId: p.proof_file_id, invoiceNo: p.invoice_no, reviewNote: p.review_note,
    ...(upi?.upiId ? { upiId: upi.upiId, payeeName: upi.payeeName, upiUri: upiUri(upi, p.amount_paise, p.reference), qrUrl: `/api/v1/payments/${p.id}/qr.png` } : {}),
  } });
}));

// QR code for the exact amount and reference; any UPI app can scan it.
paymentsRouter.get('/:id/qr.png', asyncHandler(async (req, res) => {
  const p = await paymentFor(req);
  const upi = await upiSettings();
  if (p.method !== 'upi' || !upi.upiId) throw new HttpError(404, 'not_found', 'No UPI QR for this payment.');
  const png = await QRCode.toBuffer(upiUri(upi, p.amount_paise, p.reference), { width: 480, margin: 2, color: { dark: '#0A1F44', light: '#FFFFFF' } });
  res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store' }).send(png);
}));

paymentsRouter.post('/:id/upi-proof', validate(z.object({
  utr: z.string().trim().regex(/^[A-Za-z0-9]{6,32}$/, 'Enter the UPI reference number from your payment app.').optional(),
  fileId: z.string().uuid().optional(),
}).refine(b => b.utr || b.fileId, 'Add the UPI reference number or a screenshot.')), asyncHandler(async (req, res) => {
  res.json(await submitUpiProof({ patientId: req.user.id, paymentId: req.params.id, ...req.body }));
}));

paymentsRouter.post('/:id/cash-received', requireRole('therapist'), asyncHandler(async (req, res) => {
  res.json(await markCashReceived({ therapistId: req.user.id, paymentId: req.params.id }));
}));

// ---------- admin: payment verification ----------
export const adminPaymentsRouter = Router();
adminPaymentsRouter.use(requireAuth, requireRole('ops_admin', 'finance', 'super_admin'));

adminPaymentsRouter.get('/', asyncHandler(async (req, res) => {
  const status = ['pending', 'submitted', 'paid', 'rejected'].includes(String(req.query.status)) ? String(req.query.status) : 'submitted';
  const [rows] = await sequelize.query(`SELECT pay.id, pay.method, pay.status, pay.reference, pay.amount_paise, pay.utr, pay.proof_file_id, pay.submitted_at,
      pu.name AS patient_name, tu.name AS therapist_name
    FROM payments pay JOIN plans pl ON pl.id = pay.plan_id JOIN users pu ON pu.id = pay.patient_id JOIN users tu ON tu.id = pl.therapist_id
    WHERE pay.status = :s ORDER BY pay.submitted_at NULLS LAST, pay.created_at LIMIT 200`, { replacements: { s: status } });
  res.json({ payments: rows });
}));

adminPaymentsRouter.post('/:id/review', validate(z.object({ approve: z.boolean(), note: z.string().trim().max(300).optional() })), asyncHandler(async (req, res) => {
  res.json(await reviewPayment({ admin: req.user, paymentId: req.params.id, approve: req.body.approve, note: req.body.note, ip: req.ip }));
}));

// ---------- notifications ----------
export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);
notificationsRouter.get('/', asyncHandler(async (req, res) => {
  const [rows] = await sequelize.query(`SELECT id, type, title, body, data, read_at, created_at FROM notifications WHERE user_id = :u ORDER BY created_at DESC LIMIT 50`, { replacements: { u: req.user.id } });
  res.json({ notifications: rows });
}));

// ---------- patient: visit day ----------
// The 4-digit code is shown only on the day of the visit, for visits that are booked or on the way.
bookingsRouter.get('/:visitId/checkin-code', asyncHandler(async (req, res) => {
  const v = await one(`SELECT id, status, lower(during) AS starts_at FROM visits WHERE id = :id AND patient_id = :u`, { id: req.params.visitId, u: req.user.id });
  if (!v) throw new HttpError(404, 'not_found', 'Visit not found.');
  if (!['booked', 'on_the_way'].includes(v.status)) throw new HttpError(409, 'no_code', 'There’s no check-in code for this visit.');
  if (istDate(new Date(v.starts_at)) !== istDate(new Date())) throw new HttpError(409, 'not_today', 'Your code appears on the day of the visit.');
  res.json({ code: checkinCode(v.id), note: 'Share it only when your physio is at your door.' });
}));

bookingsRouter.get('/:visitId/notes', asyncHandler(async (req, res) => {
  const n = await one(`SELECT n.pain_score, n.measurements, n.exercises, n.notes, n.home_plan, n.created_at FROM session_notes n JOIN visits v ON v.id = n.visit_id
    WHERE v.id = :id AND v.patient_id = :u`, { id: req.params.visitId, u: req.user.id });
  if (!n) throw new HttpError(404, 'not_found', 'No notes for this visit yet.');
  res.json({ notes: n });
}));
