// Hold a slot → create a payment order → confirm on verified payment. All-or-nothing in one transaction each.
import { sequelize } from '../db/index.js';
import { HttpError } from '../lib/util.js';
import { addMin, istDate } from '../lib/time.js';
import { zoneForPoint } from '../lib/geo.js';
import { freeSlots } from './slots.js';
import { genderRule } from './matching.js';
import { schedulingRules } from './rules.js';
import { paymentProvider } from './payments.js';
import { audit } from './audit.js';

const one = async (sql, replacements, transaction) => (await sequelize.query(sql, { replacements, transaction }))[0][0];

export async function holdBooking({ patient, therapistId, start, mode, addressId, packageId, familyMember, ip }) {
  const rules = await schedulingRules();
  const startAt = new Date(start);
  if (Number.isNaN(startAt.getTime())) throw new HttpError(400, 'invalid_start', 'Pick a valid time.');

  const physio = await one(`SELECT u.id, u.gender, u.status, tp.verification_status, tp.accepting FROM users u JOIN therapist_profiles tp ON tp.user_id = u.id WHERE u.id = :id`, { id: therapistId });
  if (!physio || physio.status !== 'active' || physio.verification_status !== 'verified' || !physio.accepting) throw new HttpError(404, 'therapist_unavailable', 'This physio isn’t taking bookings right now.');

  // Gender safety rule (hard rule, enforced on the server).
  const rule = genderRule(patient.gender, physio.gender, Boolean(familyMember));
  if (rule === 'not_allowed') throw new HttpError(409, 'gender_rule', 'A male physio can visit only when an adult family member is at home. Add who will be present, or choose a female physio.');

  let address = null, zone = null;
  if (mode === 'home') {
    address = await one(`SELECT id, lat, lng FROM addresses WHERE id = :id AND user_id = :u`, { id: addressId, u: patient.id });
    if (!address) throw new HttpError(400, 'address_required', 'Add the address for the home visit.');
    zone = await zoneForPoint(address.lat, address.lng);
  }

  // Slot must be free right now according to the engine (zone hours, travel, notice, availability).
  const slots = await freeSlots({ therapistId, mode, fromDate: istDate(startAt), days: 1, address, zone });
  if (!slots.includes(startAt.toISOString())) throw new HttpError(409, 'slot_taken', 'That time was just taken. Pick another.');

  // Price: package or single session.
  let pkg = null, price;
  if (packageId) {
    pkg = await one(`SELECT id, sessions, price_paise, validity_days, mode FROM packages WHERE id = :id AND therapist_id = :t AND active`, { id: packageId, t: therapistId });
    if (!pkg || pkg.mode !== mode) throw new HttpError(400, 'package_invalid', 'This plan isn’t available.');
  } else {
    price = await one(`SELECT price_paise FROM therapist_prices WHERE therapist_id = :t AND mode = :m`, { t: therapistId, m: mode });
    if (!price) throw new HttpError(400, 'price_missing', 'This physio hasn’t set a price for this visit type.');
  }
  const amount = pkg ? pkg.price_paise : price.price_paise;
  const sessions = pkg ? pkg.sessions : 1;

  const end = addMin(startAt, rules.visitMinutes[mode]);
  return sequelize.transaction(async transaction => {
    // Release expired holds so the no-overlap constraint only sees live ones.
    await sequelize.query(`UPDATE visits SET status = 'cancelled', updated_at = now() WHERE therapist_id = :t AND status = 'held' AND hold_expires_at < now()`, { replacements: { t: therapistId }, transaction });
    const plan = await one(`INSERT INTO plans (patient_id, therapist_id, package_id, mode, sessions_total, price_paise, valid_until)
      VALUES (:p, :t, :pkg, :m, :n, :amt, CASE WHEN :days::int IS NULL THEN NULL ELSE now() + make_interval(days => :days::int) END) RETURNING id`,
      { p: patient.id, t: therapistId, pkg: pkg?.id ?? null, m: mode, n: sessions, amt: amount, days: pkg?.validity_days ?? null }, transaction);
    let visit;
    try {
      visit = await one(`INSERT INTO visits (therapist_id, patient_id, zone_id, mode, status, during, hold_expires_at, plan_id, address_id, family_member)
        VALUES (:t, :p, :z, :m, 'held', tstzrange(:s, :e), now() + make_interval(mins => :hold), :plan, :addr, :fm) RETURNING id, hold_expires_at`,
        { t: therapistId, p: patient.id, z: zone?.id ?? null, m: mode, s: startAt.toISOString(), e: end.toISOString(), hold: rules.paymentHoldMinutes, plan: plan.id, addr: address?.id ?? null, fm: familyMember ? JSON.stringify(familyMember) : null }, transaction);
    } catch (e) {
      if (e.name === 'SequelizeExclusionConstraintError') throw new HttpError(409, 'slot_taken', 'That time was just taken. Pick another.');
      throw e;
    }
    const provider = paymentProvider();
    const order = await provider.createOrder({ amountPaise: amount, receipt: plan.id, notes: { planId: plan.id, visitId: visit.id } });
    await sequelize.query(`INSERT INTO payments (patient_id, plan_id, amount_paise, provider, provider_order_id, raw) VALUES (:p, :plan, :amt, :prov, :o, :raw)`,
      { replacements: { p: patient.id, plan: plan.id, amt: amount, prov: provider.name, o: order.orderId, raw: order.raw ? JSON.stringify(order.raw) : null }, transaction });
    if (rule === 'needs_family_and_consent') {
      await sequelize.query(`INSERT INTO consents (user_id, document, version, accepted, method, subject_id, meta, ip) VALUES (:p, 'gender_safety', '1.0', true, 'app_otp', :t, :meta, :ip)`,
        { replacements: { p: patient.id, t: therapistId, meta: JSON.stringify({ familyMember, visitId: visit.id }), ip: ip ?? null }, transaction });
    }
    return {
      visitId: visit.id, planId: plan.id, holdExpiresAt: visit.hold_expires_at, amountPaise: amount, currency: 'INR',
      payment: { provider: provider.name, keyId: provider.keyId(), orderId: order.orderId },
      needsPhysioConsent: rule === 'needs_family_and_consent',
    };
  });
}

// Idempotent: safe to call from both the app's checkout callback and the Razorpay webhook.
export async function confirmPayment({ orderId, paymentId, raw }) {
  return sequelize.transaction(async transaction => {
    const pay = await one(`SELECT * FROM payments WHERE provider_order_id = :o FOR UPDATE`, { o: orderId }, transaction);
    if (!pay) throw new HttpError(404, 'order_not_found', 'Payment not found.');
    if (pay.status === 'paid') return { alreadyConfirmed: true, planId: pay.plan_id, invoiceNo: pay.invoice_no };
    const visit = await one(`SELECT id, status, hold_expires_at, patient_id, therapist_id FROM visits WHERE plan_id = :plan ORDER BY created_at LIMIT 1 FOR UPDATE`, { plan: pay.plan_id }, transaction);
    const invoice = await one(`SELECT 'INV-' || to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYY') || '-' || lpad(nextval('invoice_seq')::text, 6, '0') AS no`, {}, transaction);
    await sequelize.query(`UPDATE payments SET status = 'paid', provider_payment_id = :pid, invoice_no = :inv, raw = COALESCE(:raw, raw), updated_at = now() WHERE id = :id`,
      { replacements: { pid: paymentId, inv: invoice.no, raw: raw ? JSON.stringify(raw) : null, id: pay.id }, transaction });
    await sequelize.query(`UPDATE plans SET status = 'active', updated_at = now() WHERE id = :id`, { replacements: { id: pay.plan_id }, transaction });

    // Paid after the hold expired (slow UPI): keep the booking only if the slot is still free; else needs a new time.
    let needsNewTime = false;
    if (visit.status === 'held') {
      try {
        await sequelize.query(`SAVEPOINT book`, { transaction });
        await sequelize.query(`UPDATE visits SET status = 'booked', hold_expires_at = NULL, updated_at = now() WHERE id = :id`, { replacements: { id: visit.id }, transaction });
      } catch (e) {
        await sequelize.query(`ROLLBACK TO SAVEPOINT book`, { transaction });
        if (e.name !== 'SequelizeExclusionConstraintError') throw e;
        needsNewTime = true;
      }
    } else if (visit.status === 'cancelled') {
      needsNewTime = true; // expired hold was released and possibly re-used; the plan stays active for rebooking
    }
    // Link first paid session to attribution: credit is locked from now on.
    await sequelize.query(`UPDATE attributions SET locked_at = COALESCE(locked_at, now()), updated_at = now() WHERE user_id = :u`, { replacements: { u: visit.patient_id }, transaction });
    await sequelize.query(`INSERT INTO notifications (user_id, type, title, body, data) VALUES (:u, 'booking_confirmed', :title, :body, :data)`, {
      replacements: {
        u: visit.patient_id,
        title: needsNewTime ? 'Payment received · pick a new time' : 'You’re booked',
        body: needsNewTime ? 'Your payment arrived after the slot was released. Choose another time; nothing extra to pay.' : `Invoice ${invoice.no} has been emailed to you.`,
        data: JSON.stringify({ planId: pay.plan_id, visitId: visit.id }),
      }, transaction,
    });
    await audit({ actor: null, action: 'payment.confirmed', targetType: 'payment', targetId: pay.id, after: { orderId, paymentId, invoice: invoice.no, needsNewTime } }, transaction);
    return { alreadyConfirmed: false, planId: pay.plan_id, visitId: visit.id, invoiceNo: invoice.no, needsNewTime };
  });
}
