// Booking: hold a slot → confirm with a payment method (Cash or UPI-QR) → proof / cash received → ops verifies.
import crypto from 'node:crypto';
import { sequelize } from '../db/index.js';
import { HttpError } from '../lib/util.js';
import { addMin, istDate } from '../lib/time.js';
import { zoneForPoint } from '../lib/geo.js';
import { freeSlots } from './slots.js';
import { genderRule } from './matching.js';
import { schedulingRules } from './rules.js';
import { audit } from './audit.js';
import { accrueForPlan } from './money.js';

const one = async (sql, replacements, transaction) => (await sequelize.query(sql, { replacements, transaction }))[0][0];
const notify = (userId, type, title, body, data, transaction) => sequelize.query(
  `INSERT INTO notifications (user_id, type, title, body, data) VALUES (:u, :type, :title, :body, :data)`,
  { replacements: { u: userId, type, title, body, data: JSON.stringify(data ?? {}) }, transaction });
// Short, unambiguous reference the patient writes in the UPI note, e.g. PC-7K3M9Q.
const newReference = () => `PC-${Array.from(crypto.randomBytes(6), b => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[b % 31]).join('')}`;

export async function holdBooking({ patient, therapistId, start, mode, addressId, packageId, familyMember, ip }) {
  const rules = await schedulingRules();
  const startAt = new Date(start);
  if (Number.isNaN(startAt.getTime())) throw new HttpError(400, 'invalid_start', 'Pick a valid time.');

  const physio = await one(`SELECT u.id, u.gender, u.status, tp.verification_status, tp.accepting FROM users u JOIN therapist_profiles tp ON tp.user_id = u.id WHERE u.id = :id`, { id: therapistId });
  if (!physio || physio.status !== 'active' || physio.verification_status !== 'verified' || !physio.accepting) throw new HttpError(404, 'therapist_unavailable', 'This physio isn’t taking bookings right now.');

  const rule = genderRule(patient.gender, physio.gender, Boolean(familyMember));
  if (rule === 'not_allowed') throw new HttpError(409, 'gender_rule', 'A male physio can visit only when an adult family member is at home. Add who will be present, or choose a female physio.');

  let address = null, zone = null;
  if (mode === 'home') {
    address = await one(`SELECT id, lat, lng FROM addresses WHERE id = :id AND user_id = :u`, { id: addressId, u: patient.id });
    if (!address) throw new HttpError(400, 'address_required', 'Add the address for the home visit.');
    zone = await zoneForPoint(address.lat, address.lng);
  }
  const slots = await freeSlots({ therapistId, mode, fromDate: istDate(startAt), days: 1, address, zone });
  if (!slots.includes(startAt.toISOString())) throw new HttpError(409, 'slot_taken', 'That time was just taken. Pick another.');

  let pkg = null, price;
  if (packageId) {
    pkg = await one(`SELECT id, sessions, price_paise, validity_days, mode FROM packages WHERE id = :id AND therapist_id = :t AND active`, { id: packageId, t: therapistId });
    if (!pkg || pkg.mode !== mode) throw new HttpError(400, 'package_invalid', 'This plan isn’t available.');
  } else {
    price = await one(`SELECT price_paise FROM therapist_prices WHERE therapist_id = :t AND mode = :m`, { t: therapistId, m: mode });
    if (!price) throw new HttpError(400, 'price_missing', 'This physio hasn’t set a price for this visit type.');
  }
  const amount = pkg ? pkg.price_paise : price.price_paise;
  const end = addMin(startAt, rules.visitMinutes[mode]);

  return sequelize.transaction(async transaction => {
    await sequelize.query(`UPDATE visits SET status = 'cancelled', updated_at = now() WHERE therapist_id = :t AND status = 'held' AND hold_expires_at < now()`, { replacements: { t: therapistId }, transaction });
    const plan = await one(`INSERT INTO plans (patient_id, therapist_id, package_id, mode, sessions_total, price_paise, valid_until)
      VALUES (:p, :t, :pkg, :m, :n, :amt, CASE WHEN :days::int IS NULL THEN NULL ELSE now() + make_interval(days => :days::int) END) RETURNING id`,
    { p: patient.id, t: therapistId, pkg: pkg?.id ?? null, m: mode, n: pkg ? pkg.sessions : 1, amt: amount, days: pkg?.validity_days ?? null }, transaction);
    let visit;
    try {
      visit = await one(`INSERT INTO visits (therapist_id, patient_id, zone_id, mode, status, during, hold_expires_at, plan_id, address_id, family_member, physio_consent)
        VALUES (:t, :p, :z, :m, 'held', tstzrange(:s, :e), now() + make_interval(mins => :hold), :plan, :addr, :fm, :pc) RETURNING id, hold_expires_at`,
      { t: therapistId, p: patient.id, z: zone?.id ?? null, m: mode, s: startAt.toISOString(), e: end.toISOString(), hold: rules.paymentHoldMinutes, plan: plan.id, addr: address?.id ?? null, fm: familyMember ? JSON.stringify(familyMember) : null, pc: rule === 'needs_family_and_consent' ? 'pending' : 'not_needed' }, transaction);
    } catch (e) {
      if (e.name === 'SequelizeExclusionConstraintError') throw new HttpError(409, 'slot_taken', 'That time was just taken. Pick another.');
      throw e;
    }
    if (rule === 'needs_family_and_consent') {
      await sequelize.query(`INSERT INTO consents (user_id, document, version, accepted, method, subject_id, meta, ip) VALUES (:p, 'gender_safety', '1.0', true, 'app_otp', :t, :meta, :ip)`,
        { replacements: { p: patient.id, t: therapistId, meta: JSON.stringify({ familyMember, visitId: visit.id }), ip: ip ?? null }, transaction });
    }
    return { visitId: visit.id, planId: plan.id, holdExpiresAt: visit.hold_expires_at, amountPaise: amount, currency: 'INR', needsPhysioConsent: rule === 'needs_family_and_consent' };
  });
}

export async function upiSettings() {
  const row = await one(`SELECT value FROM app_settings WHERE key = 'payment_upi'`, {});
  return row?.value ?? { upiId: null, payeeName: 'PhysioConnect' };
}
export const upiUri = ({ upiId, payeeName }, amountPaise, reference) =>
  `upi://pay?${new URLSearchParams({ pa: upiId, pn: payeeName, am: (amountPaise / 100).toFixed(2), cu: 'INR', tn: reference })}`;

// Patient picks Cash or UPI: the booking is confirmed now; the payment stays pending until verified.
export async function confirmBooking({ patientId, visitId, method }) {
  const upi = await upiSettings();
  if (method === 'upi' && !upi.upiId) throw new HttpError(409, 'upi_not_configured', 'UPI payment isn’t set up yet. Choose cash.');
  return sequelize.transaction(async transaction => {
    const v = await one(`SELECT v.id, v.status, v.hold_expires_at, v.plan_id, v.therapist_id, p.price_paise FROM visits v JOIN plans p ON p.id = v.plan_id
      WHERE v.id = :id AND v.patient_id = :u FOR UPDATE OF v`, { id: visitId, u: patientId }, transaction);
    if (!v) throw new HttpError(404, 'not_found', 'Booking not found.');
    if (v.status !== 'held' || new Date(v.hold_expires_at) < new Date()) throw new HttpError(409, 'hold_expired', 'This slot is no longer held. Pick a time again.');
    const reference = newReference();
    await sequelize.query(`UPDATE visits SET status = 'booked', hold_expires_at = NULL, updated_at = now() WHERE id = :id`, { replacements: { id: v.id }, transaction });
    await sequelize.query(`UPDATE plans SET status = 'active', updated_at = now() WHERE id = :id`, { replacements: { id: v.plan_id }, transaction });
    const pay = await one(`INSERT INTO payments (patient_id, plan_id, amount_paise, provider, method, reference, status) VALUES (:u, :plan, :amt, 'offline', :m, :ref, 'pending') RETURNING id`,
      { u: patientId, plan: v.plan_id, amt: v.price_paise, m: method, ref: reference }, transaction);
    await notify(patientId, 'booking_confirmed', 'You’re booked', method === 'upi' ? `Pay by UPI with reference ${reference}, then upload the screenshot.` : 'Pay your physio in cash at the visit and ask for a receipt in the app.', { visitId: v.id, paymentId: pay.id }, transaction);
    await notify(v.therapist_id, 'new_booking', 'New booking', method === 'cash' ? 'Collect cash at the visit and mark it received in the app.' : 'Patient is paying by UPI.', { visitId: v.id }, transaction);
    return {
      visitId: v.id, planId: v.plan_id,
      payment: { id: pay.id, method, reference, amountPaise: v.price_paise, status: 'pending', ...(method === 'upi' ? { upiId: upi.upiId, payeeName: upi.payeeName, upiUri: upiUri(upi, v.price_paise, reference), qrUrl: `/api/v1/payments/${pay.id}/qr.png` } : {}) },
    };
  });
}

// Patient: UTR and/or screenshot after paying by UPI.
export async function submitUpiProof({ patientId, paymentId, utr, fileId }) {
  return sequelize.transaction(async transaction => {
    const p = await one(`SELECT id, status, method FROM payments WHERE id = :id AND patient_id = :u FOR UPDATE`, { id: paymentId, u: patientId }, transaction);
    if (!p) throw new HttpError(404, 'not_found', 'Payment not found.');
    if (p.method !== 'upi') throw new HttpError(409, 'wrong_method', 'This booking is paid in cash.');
    if (!['pending', 'rejected'].includes(p.status)) throw new HttpError(409, 'already_submitted', 'We already have your payment details.');
    if (fileId) {
      const f = await one(`SELECT id FROM files WHERE id = :f AND owner_user_id = :u AND hidden_at IS NULL`, { f: fileId, u: patientId }, transaction);
      if (!f) throw new HttpError(400, 'file_invalid', 'Upload the screenshot first.');
      await sequelize.query(`UPDATE files SET linked_type = 'payment', linked_id = :p WHERE id = :f`, { replacements: { p: paymentId, f: fileId }, transaction });
    }
    try {
      await sequelize.query(`UPDATE payments SET status = 'submitted', utr = :utr, proof_file_id = :f, submitted_by = :u, submitted_at = now(), updated_at = now() WHERE id = :id`,
        { replacements: { utr: utr ?? null, f: fileId ?? null, u: patientId, id: paymentId }, transaction });
    } catch (e) {
      if (e.name === 'SequelizeUniqueConstraintError') throw new HttpError(409, 'utr_used', 'This UPI reference has already been used.');
      throw e;
    }
    return { status: 'submitted' };
  });
}

// Physio: cash collected at the visit.
export async function markCashReceived({ therapistId, paymentId }) {
  const p = await one(`SELECT pay.id, pay.status, pay.method FROM payments pay JOIN plans pl ON pl.id = pay.plan_id WHERE pay.id = :id AND pl.therapist_id = :t`, { id: paymentId, t: therapistId });
  if (!p) throw new HttpError(404, 'not_found', 'Payment not found.');
  if (p.method !== 'cash') throw new HttpError(409, 'wrong_method', 'This booking is paid by UPI.');
  if (p.status !== 'pending') throw new HttpError(409, 'already_submitted', 'Already recorded.');
  await sequelize.query(`UPDATE payments SET status = 'submitted', submitted_by = :t, submitted_at = now(), updated_at = now() WHERE id = :id`, { replacements: { t: therapistId, id: paymentId } });
  return { status: 'submitted' };
}

// Ops / finance: approve or reject. Approval issues the invoice and locks referral credit.
export async function reviewPayment({ admin, paymentId, approve, note, ip }) {
  return sequelize.transaction(async transaction => {
    const p = await one(`SELECT * FROM payments WHERE id = :id FOR UPDATE`, { id: paymentId }, transaction);
    if (!p) throw new HttpError(404, 'not_found', 'Payment not found.');
    if (p.status !== 'submitted') throw new HttpError(409, 'not_submitted', 'Nothing to review yet.');
    let invoiceNo = null;
    if (approve) {
      invoiceNo = (await one(`SELECT 'INV-' || to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYY') || '-' || lpad(nextval('invoice_seq')::text, 6, '0') AS no`, {}, transaction)).no;
      await sequelize.query(`UPDATE payments SET status = 'paid', invoice_no = :inv, verified_by = :a, verified_at = now(), review_note = :n, updated_at = now() WHERE id = :id`, { replacements: { inv: invoiceNo, a: admin.id, n: note ?? null, id: p.id }, transaction });
      await sequelize.query(`UPDATE attributions SET locked_at = COALESCE(locked_at, now()), updated_at = now() WHERE user_id = :u`, { replacements: { u: p.patient_id }, transaction });
      await accrueForPlan(p.plan_id, transaction); // visits already completed now earn
      await notify(p.patient_id, 'payment_verified', 'Payment received', `Thank you. Invoice ${invoiceNo} is ready.`, { paymentId: p.id }, transaction);
    } else {
      await sequelize.query(`UPDATE payments SET status = 'rejected', verified_by = :a, verified_at = now(), review_note = :n, updated_at = now() WHERE id = :id`, { replacements: { a: admin.id, n: note ?? null, id: p.id }, transaction });
      await notify(p.patient_id, 'payment_rejected', 'We couldn’t confirm your payment', note ?? 'Please check the UPI reference and upload the screenshot again.', { paymentId: p.id }, transaction);
    }
    await audit({ actor: admin, action: approve ? 'payment.verified' : 'payment.rejected', targetType: 'payment', targetId: p.id, before: { status: p.status }, after: { status: approve ? 'paid' : 'rejected', invoiceNo, note }, ip }, transaction);
    return { status: approve ? 'paid' : 'rejected', invoiceNo };
  });
}
