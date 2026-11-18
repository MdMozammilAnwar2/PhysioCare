// Growth: coins (10 coins = ₹1), patient referral, partners and their links, partner rewards.
import crypto from 'node:crypto';
import { sequelize } from '../db/index.js';
import { HttpError } from '../lib/util.js';
import { audit } from './audit.js';
import { User } from '../models/index.js';
import { config } from '../config/index.js';

export const COINS_PER_RUPEE = config.coinsPerRupee;
export const PAISE_PER_COIN = 100 / COINS_PER_RUPEE; // 10 paise
export const PARTNER_TYPES = ['doctor', 'hospital', 'clinic', 'pathology_lab', 'physiotherapist', 'pharmacy', 'gym', 'other'];

const q = async (sql, replacements, transaction) => (await sequelize.query(sql, { replacements, transaction }))[0];
const one = async (sql, replacements, transaction) => (await q(sql, replacements, transaction))[0];
const notify = (u, type, title, body, data, transaction) => q(
  `INSERT INTO notifications (user_id, type, title, body, data) VALUES (:u, :type, :title, :body, :data)`,
  { u, type, title, body: body ?? null, data: JSON.stringify(data ?? {}) }, transaction);

export async function growthRules(transaction) {
  return (await one(`SELECT value FROM app_settings WHERE key = 'growth_rules'`, {}, transaction)).value;
}
export async function saveGrowthRules(admin, rules, ip) {
  return sequelize.transaction(async t => {
    const before = await growthRules(t);
    await q(`UPDATE app_settings SET value = :v, updated_at = now() WHERE key = 'growth_rules'`, { v: JSON.stringify(rules) }, t);
    await audit({ actor: admin, action: 'growth_rules.updated', targetType: 'settings', targetId: null, before, after: rules, ip }, t);
    return rules;
  });
}

// ---------- coins ----------
export async function coinBalance(userId, transaction) {
  return (await one(`SELECT COALESCE(sum(delta), 0)::int AS b FROM coin_entries WHERE user_id = :u`, { u: userId }, transaction)).b;
}
/** Adds (or removes) coins. With a refId, the same reason happens only once for that user. Returns true if recorded. */
export async function addCoins({ userId, delta, reason, refId = null, note = null, createdBy = null }, transaction) {
  if (!delta) return false;
  const rows = await q(`INSERT INTO coin_entries (user_id, delta, reason, ref_id, note, created_by)
    SELECT :u, :d, :r, :ref, :n, :by
    WHERE :ref::uuid IS NULL OR NOT EXISTS (SELECT 1 FROM coin_entries WHERE user_id = :u AND reason = :r AND ref_id = :ref::uuid)
    RETURNING id`, { u: userId, d: delta, r: reason, ref: refId, n: note, by: createdBy }, transaction);
  return rows.length > 0;
}
/** How many coins can pay towards this price (at most maxCoinPct % of it, in whole coins). */
export async function coinsForCheckout(userId, pricePaise, transaction) {
  const [rules, balance] = [await growthRules(transaction), await coinBalance(userId, transaction)];
  const capCoins = Math.floor((pricePaise * rules.maxCoinPct) / 100 / PAISE_PER_COIN);
  const coins = Math.max(0, Math.min(balance, capCoins));
  return { balance, coins, discountPaise: coins * PAISE_PER_COIN, maxPct: rules.maxCoinPct };
}
export async function wallet(userId) {
  const entries = await q(`SELECT id, delta, reason, note, created_at FROM coin_entries WHERE user_id = :u ORDER BY id DESC LIMIT 100`, { u: userId });
  const balance = await coinBalance(userId);
  return { balance, rupeesPaise: balance * PAISE_PER_COIN, coinsPerRupee: COINS_PER_RUPEE, entries: entries.map(e => ({ ...e, id: Number(e.id) })) };
}
/** Give coins back when a booking paid partly with coins is voided. */
export async function returnCoinsForPlan(planId, transaction) {
  const pays = await q(`SELECT id, patient_id, coins_used FROM payments WHERE plan_id = :p AND coins_used > 0`, { p: planId }, transaction);
  for (const p of pays) await addCoins({ userId: p.patient_id, delta: p.coins_used, reason: 'redeem_return', refId: p.id, note: 'Booking cancelled' }, transaction);
}

// ---------- links ----------
function newCode(prefix = '') {
  const clean = String(prefix).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5);
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += alphabet[crypto.randomInt(alphabet.length)];
  return (clean || 'PC') + s;
}
async function createLink(fields, transaction) {
  for (let i = 0; i < 6; i++) {
    const code = newCode(fields.prefix);
    const exists = await one(`SELECT 1 AS x FROM tracked_links WHERE code = :c`, { c: code }, transaction);
    if (exists) continue;
    return one(`INSERT INTO tracked_links (code, type, owner_user_id, owner_partner_id, meta) VALUES (:c, :t, :u, :p, :m) RETURNING id, code, type, meta, active, created_at`,
      { c: code, t: fields.type, u: fields.ownerUserId ?? null, p: fields.ownerPartnerId ?? null, m: JSON.stringify(fields.meta ?? {}) }, transaction);
  }
  throw new HttpError(500, 'code_failed', 'Couldn’t create a link code. Try again.');
}
export async function referralLink(user) {
  return sequelize.transaction(async t => {
    const existing = await one(`SELECT id, code FROM tracked_links WHERE owner_user_id = :u AND type = 'friend_link' AND active ORDER BY created_at LIMIT 1`, { u: user.id }, t);
    return existing ?? createLink({ type: 'friend_link', ownerUserId: user.id, prefix: user.name ?? '' }, t);
  });
}
export async function linkStats(where, replacements) {
  return q(`SELECT l.id, l.code, l.type, l.meta, l.active, l.created_at,
      count(e.*) FILTER (WHERE e.event = 'scan')::int AS scans,
      count(e.*) FILTER (WHERE e.event = 'click')::int AS clicks,
      (SELECT count(*)::int FROM attributions a WHERE a.first_link_id = l.id) AS signups,
      (SELECT count(*)::int FROM attributions a WHERE a.first_link_id = l.id AND a.locked_at IS NOT NULL) AS paid
    FROM tracked_links l LEFT JOIN link_events e ON e.link_id = l.id
    WHERE ${where} GROUP BY l.id ORDER BY l.created_at`, replacements);
}
/** Public /r/:code hit: logs the scan or click and returns the code to carry to sign-up (null if unknown). */
export async function hitLink(code, { scan, ip, utm }) {
  const link = await one(`SELECT id, code FROM tracked_links WHERE code = :c AND active AND (expires_at IS NULL OR expires_at > now())`, { c: code });
  await q(`INSERT INTO link_events (link_id, code, event, ip, utm) VALUES (:l, :c, :e, :ip, :utm)`,
    { l: link?.id ?? null, c: code, e: scan ? 'scan' : 'click', ip: ip ?? null, utm: utm ? JSON.stringify(utm) : null });
  return link?.code ?? null;
}

// ---------- sign-up and first payment ----------
/** New patient who joined through any valid link gets the welcome coins. */
export async function onSignup(user, attribution, transaction) {
  if (!attribution?.firstLinkId || attribution.flagged) return;
  const rules = await growthRules(transaction);
  if (await addCoins({ userId: user.id, delta: rules.welcomeCoins, reason: 'welcome', refId: user.id, note: 'Welcome bonus' }, transaction))
    await notify(user.id, 'coins_welcome', `${rules.welcomeCoins} coins added`, `Worth ₹${rules.welcomeCoins / COINS_PER_RUPEE}. Use them on your first booking.`, {}, transaction);
}
/** First confirmed payment of a patient: reward the friend who referred them, and the partner who sent them. */
export async function onFirstPaid(patientId, paymentId, transaction) {
  const a = await one(`SELECT a.*, l.type AS link_type FROM attributions a LEFT JOIN tracked_links l ON l.id = a.first_link_id WHERE a.user_id = :u`, { u: patientId }, transaction);
  if (!a || a.flagged) return;
  const rules = await growthRules(transaction);
  if (a.link_type === 'friend_link' && a.credited_user_id && a.credited_user_id !== patientId) {
    if (await addCoins({ userId: a.credited_user_id, delta: rules.referrerCoins, reason: 'referral', refId: patientId, note: 'Friend’s first visit' }, transaction))
      await notify(a.credited_user_id, 'coins_referral', `${rules.referrerCoins} coins earned`, 'Your friend booked their first visit. Thank you for spreading the word.', {}, transaction);
  }
  if (a.credited_partner_id) {
    const p = await one(`SELECT id, status, reward_paise FROM partner_orgs WHERE id = :p`, { p: a.credited_partner_id }, transaction);
    if (p?.status === 'approved') {
      await q(`INSERT INTO partner_rewards (partner_id, patient_id, payment_id, link_id, amount_paise) VALUES (:p, :u, :pay, :l, :a) ON CONFLICT (patient_id) DO NOTHING`,
        { p: p.id, u: patientId, pay: paymentId, l: a.first_link_id, a: p.reward_paise ?? rules.partnerRewardPaise }, transaction);
    }
  }
}

// ---------- partners ----------
const partnerCols = `p.id, p.name, p.type, p.status, p.contact_name, p.phone, p.address, p.registration_no, p.payout_to, p.reward_paise, p.decision_note, p.created_at, p.decided_at`;
export async function partnerFor(userId) {
  return one(`SELECT ${partnerCols}, m.access FROM partner_orgs p JOIN partner_members m ON m.partner_id = p.id WHERE m.user_id = :u ORDER BY p.created_at LIMIT 1`, { u: userId });
}
export async function applyPartner(user, b) {
  return sequelize.transaction(async t => {
    const existing = await one(`SELECT partner_id FROM partner_members WHERE user_id = :u`, { u: user.id }, t);
    if (existing) throw new HttpError(409, 'already_partner', 'You already have a partner account.');
    const p = await one(`INSERT INTO partner_orgs (name, type, contact_name, phone, address, registration_no, payout_to, city_id)
      VALUES (:name, :type, :contact, :phone, :address, :reg, :payout, (SELECT id FROM cities WHERE name = 'Patna')) RETURNING id`,
      { name: b.name, type: b.type, contact: b.contactName ?? null, phone: user.phone, address: b.address ?? null, reg: b.registrationNo ?? null, payout: b.payoutTo ?? null }, t);
    await q(`INSERT INTO partner_members (partner_id, user_id, access) VALUES (:p, :u, 'owner')`, { p: p.id, u: user.id }, t);
    await q(`INSERT INTO user_roles (user_id, role) VALUES (:u, 'partner_owner') ON CONFLICT DO NOTHING`, { u: user.id }, t);
    return { partnerId: p.id, status: 'pending' };
  });
}
/** Staff add a partner directly (field visit). The owner signs in later with this phone number. */
export async function createPartnerByAdmin(admin, b, ip) {
  return sequelize.transaction(async t => {
    let u = await one(`SELECT id FROM users WHERE phone = :ph`, { ph: b.phone }, t);
    if (!u) u = await User.create({ phone: b.phone, name: b.contactName ?? null }, { transaction: t });
    const already = await one(`SELECT partner_id FROM partner_members WHERE user_id = :u`, { u: u.id }, t);
    if (already) throw new HttpError(409, 'already_partner', 'This phone number already has a partner account.');
    const p = await one(`INSERT INTO partner_orgs (name, type, contact_name, phone, address, registration_no, payout_to, reward_paise, status, decided_by, decided_at, city_id)
      VALUES (:name, :type, :contact, :phone, :address, :reg, :payout, :reward, 'approved', :a, now(), (SELECT id FROM cities WHERE name = 'Patna')) RETURNING id`,
      { name: b.name, type: b.type, contact: b.contactName ?? null, phone: b.phone, address: b.address ?? null, reg: b.registrationNo ?? null, payout: b.payoutTo ?? null, reward: b.rewardPaise ?? null, a: admin.id }, t);
    await q(`INSERT INTO partner_members (partner_id, user_id, access) VALUES (:p, :u, 'owner')`, { p: p.id, u: u.id }, t);
    await q(`INSERT INTO user_roles (user_id, role) VALUES (:u, 'partner_owner') ON CONFLICT DO NOTHING`, { u: u.id }, t);
    const link = await createLink({ type: 'partner_permanent_qr', ownerPartnerId: p.id, prefix: b.name, meta: { label: 'Main QR' } }, t);
    await audit({ actor: admin, action: 'partner.created', targetType: 'partner', targetId: p.id, after: { name: b.name, type: b.type }, ip }, t);
    return { partnerId: p.id, code: link.code };
  });
}
export async function decidePartner(admin, partnerId, { approve, note, rewardPaise }, ip) {
  return sequelize.transaction(async t => {
    const p = await one(`SELECT id, name, status FROM partner_orgs WHERE id = :id FOR UPDATE`, { id: partnerId }, t);
    if (!p) throw new HttpError(404, 'not_found', 'Partner not found.');
    const status = approve ? 'approved' : p.status === 'pending' ? 'rejected' : 'suspended';
    await q(`UPDATE partner_orgs SET status = :s, decision_note = :n, reward_paise = COALESCE(:r, reward_paise), decided_by = :a, decided_at = now(), updated_at = now() WHERE id = :id`,
      { s: status, n: note ?? null, r: rewardPaise ?? null, a: admin.id, id: p.id }, t);
    await q(`UPDATE tracked_links SET active = :on WHERE owner_partner_id = :id`, { on: approve, id: p.id }, t);
    if (approve) {
      const has = await one(`SELECT 1 AS x FROM tracked_links WHERE owner_partner_id = :id`, { id: p.id }, t);
      if (!has) await createLink({ type: 'partner_permanent_qr', ownerPartnerId: p.id, prefix: p.name, meta: { label: 'Main QR' } }, t);
    }
    const owners = await q(`SELECT user_id FROM partner_members WHERE partner_id = :id`, { id: p.id }, t);
    for (const o of owners) await notify(o.user_id, `partner_${status}`, approve ? 'Your partner account is approved' : 'Update on your partner account', approve ? 'Your QR code is ready to download and print.' : note ?? '', { partnerId: p.id }, t);
    await audit({ actor: admin, action: `partner.${status}`, targetType: 'partner', targetId: p.id, before: { status: p.status }, after: { status, note, rewardPaise }, ip }, t);
    return { status };
  });
}
export async function addPartnerLink(partnerId, label) {
  const p = await one(`SELECT id, name, status FROM partner_orgs WHERE id = :id`, { id: partnerId });
  if (p?.status !== 'approved') throw new HttpError(409, 'partner_not_approved', 'Your account must be approved before you can create QR codes.');
  const n = (await one(`SELECT count(*)::int AS n FROM tracked_links WHERE owner_partner_id = :id`, { id: partnerId })).n;
  if (n >= config.maxPartnerQrCodes) throw new HttpError(409, 'too_many_links', `You can have up to ${config.maxPartnerQrCodes} QR codes.`);
  return createLink({ type: 'partner_permanent_qr', ownerPartnerId: partnerId, prefix: p.name, meta: { label } });
}
export async function partnerRewards(partnerId) {
  const rows = await q(`SELECT r.id, r.amount_paise, r.status, r.reference, r.paid_at, r.created_at, l.code, l.meta->>'label' AS label
    FROM partner_rewards r LEFT JOIN tracked_links l ON l.id = r.link_id WHERE r.partner_id = :p ORDER BY r.created_at DESC LIMIT 200`, { p: partnerId });
  const sum = s => rows.filter(r => r.status === s).reduce((a, r) => a + r.amount_paise, 0);
  return { earnedPaise: sum('earned'), paidPaise: sum('paid'), rewards: rows };
}
export async function payPartnerRewards(admin, partnerId, reference, ip) {
  return sequelize.transaction(async t => {
    const rows = await q(`UPDATE partner_rewards SET status = 'paid', reference = :r, paid_by = :a, paid_at = now() WHERE partner_id = :p AND status = 'earned' RETURNING amount_paise`,
      { r: reference, a: admin.id, p: partnerId }, t);
    if (!rows.length) throw new HttpError(409, 'nothing_to_pay', 'Nothing to pay this partner.');
    const total = rows.reduce((a, r) => a + r.amount_paise, 0);
    const owners = await q(`SELECT user_id FROM partner_members WHERE partner_id = :id`, { id: partnerId }, t);
    for (const o of owners) await notify(o.user_id, 'partner_paid', `₹${total / 100} sent`, `Reference ${reference}. Thank you for referring patients.`, { partnerId }, t);
    await audit({ actor: admin, action: 'partner.rewards_paid', targetType: 'partner', targetId: partnerId, after: { count: rows.length, totalPaise: total, reference }, ip }, t);
    return { count: rows.length, totalPaise: total };
  });
}

// ---------- reports ----------
export async function attributionReport(from, to) {
  const r = { from, to };
  const bySource = await q(`SELECT first_source AS source, count(*)::int AS signups, count(*) FILTER (WHERE locked_at IS NOT NULL)::int AS paid, count(*) FILTER (WHERE flagged)::int AS flagged
    FROM attributions WHERE created_at >= :from::date AND created_at < :to::date + 1 GROUP BY first_source ORDER BY signups DESC`, r);
  const partners = await q(`SELECT p.id, p.name, p.type,
      count(a.*)::int AS signups, count(a.*) FILTER (WHERE a.locked_at IS NOT NULL)::int AS paid,
      (SELECT COALESCE(sum(amount_paise), 0)::int FROM partner_rewards pr WHERE pr.partner_id = p.id AND pr.created_at >= :from::date AND pr.created_at < :to::date + 1) AS reward_paise
    FROM partner_orgs p LEFT JOIN attributions a ON a.credited_partner_id = p.id AND a.created_at >= :from::date AND a.created_at < :to::date + 1
    GROUP BY p.id HAVING count(a.*) > 0 ORDER BY paid DESC, signups DESC LIMIT 50`, r);
  const referrers = await q(`SELECT u.id, u.name, u.phone, count(a.*)::int AS signups, count(a.*) FILTER (WHERE a.locked_at IS NOT NULL)::int AS paid
    FROM attributions a JOIN tracked_links l ON l.id = a.first_link_id AND l.type = 'friend_link' JOIN users u ON u.id = a.credited_user_id
    WHERE a.created_at >= :from::date AND a.created_at < :to::date + 1 GROUP BY u.id ORDER BY paid DESC, signups DESC LIMIT 50`, r);
  const coins = await one(`SELECT COALESCE(sum(delta) FILTER (WHERE delta > 0), 0)::int AS issued, COALESCE(-sum(delta) FILTER (WHERE reason = 'redeem'), 0)::int AS redeemed
    FROM coin_entries WHERE created_at >= :from::date AND created_at < :to::date + 1`, r);
  return { ...r, bySource, partners, referrers, coins };
}
