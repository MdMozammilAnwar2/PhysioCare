// Delivery of in-app notifications to phones: push (Expo), SMS and WhatsApp (MSG91).
// Code anywhere just inserts a row into `notifications`; the dispatcher (every NOTIFY_DISPATCH_SECONDS) decides
// the channels, honours each person's preferences and quiet hours, retries failures and logs every attempt.
import { config } from '../config/index.js';
import { sequelize } from '../db/index.js';
import { maskPhone } from '../lib/util.js';

const q = async (sql, replacements, transaction) => (await sequelize.query(sql, { replacements, transaction }))[0];
const M = config.messaging;

// Which messages also go by SMS / WhatsApp (push is used for every notification).
const TEXT = new Set(['booking_confirmed', 'new_booking', 'physio_on_the_way', 'video_started', 'visit_reminder', 'visit_moved', 'physio_declined',
  'payment_verified', 'payment_rejected', 'refund_approved', 'refund_paid', 'payout_paid', 'partner_paid', 'partner_approved',
  'grievance_received', 'grievance_acknowledged', 'grievance_resolved', 'grievance_rejected', 'account_unblocked', 'sos_alert']);
const WHATSAPP_ALSO = new Set(['booking_confirmed', 'payment_verified', 'visit_reminder', 'refund_paid', 'grievance_resolved']);
// Safety and time-critical messages ignore quiet hours.
const URGENT = new Set(['sos_alert', 'physio_on_the_way', 'video_started', 'visit_reminder']);

export function channelsFor(type) {
  const ch = ['push'];
  if (TEXT.has(type)) ch.push('sms');
  if (WHATSAPP_ALSO.has(type)) ch.push('whatsapp');
  return ch;
}

/** Next time outside quiet hours (IST), or null if now is fine. */
export function afterQuietHours(now = new Date()) {
  const qh = M.quietHours;
  if (!qh) return null;
  const ist = new Date(now.getTime() + 330 * 60000);
  const m = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const [start, end] = qh;
  const inQuiet = start > end ? m >= start || m < end : m >= start && m < end;
  if (!inQuiet) return null;
  const minsToEnd = (end - m + 1440) % 1440;
  return new Date(now.getTime() + minsToEnd * 60000);
}

// ---------- providers ----------
export const sentInMemory = []; // tests
const record = (channel, to, n) => { sentInMemory.push({ channel, to, type: n.type, title: n.title, body: n.body }); return { ref: `mem-${sentInMemory.length}` }; };
const log = (channel, to, n) => { console.log(`[${channel}:console] to ${to} · ${n.type} · ${n.title}${n.body ? ` — ${n.body}` : ''}`); return { ref: 'console' }; };

export const channels = {
  push: {
    memory: async (tokens, n) => ({ ...record('push', tokens.join(','), n), invalid: [] }),
    console: async (tokens, n) => ({ ...log('push', `${tokens.length} device(s)`, n), invalid: [] }),
    async expo(tokens, n) {
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', ...(M.expoAccessToken ? { authorization: `Bearer ${M.expoAccessToken}` } : {}) },
        body: JSON.stringify(tokens.map(to => ({ to, title: n.title, body: n.body ?? undefined, data: { ...(n.data ?? {}), type: n.type, notificationId: n.id }, sound: 'default', priority: URGENT.has(n.type) ? 'high' : 'default', channelId: URGENT.has(n.type) ? 'urgent' : 'default' }))),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`Expo push failed (${res.status})`);
      const tickets = body.data ?? [];
      const invalid = tokens.filter((_, i) => tickets[i]?.details?.error === 'DeviceNotRegistered');
      const ok = tickets.filter(t => t.status === 'ok');
      if (!ok.length && tokens.length > invalid.length) throw new Error(tickets[0]?.message ?? 'Expo rejected the message');
      return { ref: ok.map(t => t.id).join(',').slice(0, 200), invalid };
    },
  },
  sms: {
    memory: async (phone, n) => record('sms', phone, n),
    console: async (phone, n) => log('sms', maskPhone(phone), n),
    // MSG91 Flow API with a DLT-approved template per message type (MSG91_FLOW_<TYPE>).
    async msg91(phone, n, user) {
      const flow = M.msg91Flows[n.type];
      if (!flow) return { skipped: `No MSG91_FLOW_${n.type.toUpperCase()} template set` };
      const res = await fetch('https://control.msg91.com/api/v5/flow', {
        method: 'POST', headers: { authkey: config.sms.msg91AuthKey, 'content-type': 'application/json' },
        body: JSON.stringify({ template_id: flow, short_url: '0', recipients: [{ mobiles: phone.replace('+', ''), name: (user.name ?? '').split(' ')[0] || 'there', title: n.title, body: (n.body ?? '').slice(0, 120) }] }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.type === 'error') throw new Error(body.message ?? `MSG91 SMS failed (${res.status})`);
      return { ref: String(body.message ?? 'sent').slice(0, 200) };
    },
  },
  whatsapp: {
    memory: async (phone, n) => record('whatsapp', phone, n),
    console: async (phone, n) => log('whatsapp', maskPhone(phone), n),
    // MSG91 WhatsApp: template named like the message type (e.g. booking_confirmed), body variables {{1}} name, {{2}} title, {{3}} body.
    async msg91(phone, n, user) {
      if (!M.whatsappNumber) return { skipped: 'MSG91_WHATSAPP_NUMBER not set' };
      const res = await fetch('https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/', {
        method: 'POST', headers: { authkey: config.sms.msg91AuthKey, 'content-type': 'application/json' },
        body: JSON.stringify({ integrated_number: M.whatsappNumber, content_type: 'template', payload: {
          messaging_product: 'whatsapp', type: 'template',
          template: { name: n.type, language: { code: M.whatsappLanguage, policy: 'deterministic' }, namespace: M.whatsappNamespace || undefined,
            to_and_components: [{ to: [phone.replace('+', '')], components: {
              body_1: { type: 'text', value: (user.name ?? '').split(' ')[0] || 'there' }, body_2: { type: 'text', value: n.title }, body_3: { type: 'text', value: (n.body ?? '').slice(0, 300) || '—' } } }] },
        } }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.status === 'fail') throw new Error(body.errors ?? body.message ?? `MSG91 WhatsApp failed (${res.status})`);
      return { ref: String(body.request_id ?? 'sent').slice(0, 200) };
    },
  },
};
const providerName = ch => ({ push: M.pushProvider, sms: M.smsProvider, whatsapp: M.whatsappProvider }[ch]);

// ---------- dispatcher ----------
/** Turns new notifications into deliveries (one per channel the person allows). */
export async function expand() {
  return sequelize.transaction(async t => {
    const rows = await q(`SELECT n.id, n.user_id, n.type, COALESCE(p.push, true) AS push, COALESCE(p.sms, true) AS sms, COALESCE(p.whatsapp, true) AS whatsapp
      FROM notifications n LEFT JOIN notification_prefs p ON p.user_id = n.user_id
      WHERE n.dispatched_at IS NULL ORDER BY n.created_at LIMIT 500 FOR UPDATE OF n SKIP LOCKED`, {}, t);
    const quietUntil = afterQuietHours();
    for (const n of rows) {
      for (const ch of channelsFor(n.type)) {
        const name = providerName(ch);
        // SOS alerts always go out; otherwise respect the person's choice.
        const allowed = n.type === 'sos_alert' || n[ch];
        const status = name === 'none' || !allowed ? 'skipped' : 'pending';
        const when = ch !== 'push' && quietUntil && !URGENT.has(n.type) ? quietUntil : new Date();
        await q(`INSERT INTO notification_deliveries (notification_id, user_id, channel, status, next_attempt_at, provider, error) VALUES (:n, :u, :c, :s, :w, :p, :e) ON CONFLICT DO NOTHING`,
          { n: n.id, u: n.user_id, c: ch, s: status, w: when, p: name, e: status === 'skipped' ? (allowed ? 'channel off' : 'turned off by the person') : null }, t);
      }
      await q(`UPDATE notifications SET dispatched_at = now() WHERE id = :id`, { id: n.id }, t);
    }
    return rows.length;
  });
}

/** Sends due deliveries; failures retry with backoff (1, 2, 4, 8 … minutes) up to NOTIFY_MAX_ATTEMPTS. */
export async function deliverDue(limit = 100) {
  const due = await q(`UPDATE notification_deliveries SET next_attempt_at = now() + interval '5 minutes'
    WHERE id IN (SELECT id FROM notification_deliveries WHERE status = 'pending' AND next_attempt_at <= now() ORDER BY next_attempt_at LIMIT :l FOR UPDATE SKIP LOCKED)
    RETURNING id, notification_id, user_id, channel, attempts, provider`, { l: limit });
  let sent = 0;
  for (const d of due) {
    const [n] = await q(`SELECT n.id, n.type, n.title, n.body, n.data, u.phone, u.name, u.status FROM notifications n JOIN users u ON u.id = n.user_id WHERE n.id = :id`, { id: d.notification_id });
    const done = (status, extra = {}) => q(`UPDATE notification_deliveries SET status = :s, attempts = attempts + 1, sent_at = CASE WHEN :s = 'sent' THEN now() ELSE sent_at END, provider_ref = :ref, error = :err WHERE id = :id`,
      { s: status, ref: extra.ref ?? null, err: extra.error ?? null, id: d.id });
    if (!n || n.status === 'deleted') { await done('skipped', { error: 'account gone' }); continue; }
    try {
      const fn = channels[d.channel][d.provider];
      if (!fn) throw new Error(`Unknown ${d.channel} provider ${d.provider}`);
      let r;
      if (d.channel === 'push') {
        const devices = await q(`SELECT push_token FROM devices WHERE user_id = :u AND push_token IS NOT NULL AND disabled_at IS NULL`, { u: d.user_id });
        if (!devices.length) { await done('skipped', { error: 'no device with notifications on' }); continue; }
        r = await fn(devices.map(x => x.push_token), n, n);
        if (r.invalid?.length) await q(`UPDATE devices SET disabled_at = now() WHERE push_token IN (:t)`, { t: r.invalid });
      } else {
        r = await fn(n.phone, n, n);
      }
      if (r.skipped) await done('skipped', { error: r.skipped });
      else { await done('sent', { ref: r.ref }); sent++; }
    } catch (e) {
      const attempts = d.attempts + 1;
      if (attempts >= M.maxAttempts) await done('failed', { error: String(e.message).slice(0, 500) });
      else await q(`UPDATE notification_deliveries SET attempts = :a, error = :e, next_attempt_at = now() + make_interval(mins => :m) WHERE id = :id`, { a: attempts, e: String(e.message).slice(0, 500), m: 2 ** (attempts - 1), id: d.id });
    }
  }
  return sent;
}

/** "Your visit is in 2 hours" for the patient and the physio, once per visit. */
export async function queueReminders() {
  const visits = await q(`UPDATE visits SET reminder_sent_at = now()
    WHERE status = 'booked' AND reminder_sent_at IS NULL AND lower(during) BETWEEN now() + interval '1 hour 45 minutes' AND now() + interval '2 hours 15 minutes'
    RETURNING id, patient_id, therapist_id, mode, lower(during) AS starts_at`);
  for (const v of visits) {
    const at = new Date(v.starts_at).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' });
    const video = v.mode === 'video';
    await q(`INSERT INTO notifications (user_id, type, title, body, data) VALUES (:p, 'visit_reminder', :t, :b, :d), (:th, 'visit_reminder', :t2, :b2, :d)`, {
      p: v.patient_id, th: v.therapist_id, d: JSON.stringify({ visitId: v.id }),
      t: `Your physiotherapy session is at ${at}`, b: video ? 'Join the video call from My bookings 10 minutes before.' : 'Keep your check-in code ready. Share it only when your physio is at the door.',
      t2: `Visit at ${at}`, b2: video ? 'Start the video session from the app.' : 'Open the app for the address and directions.',
    });
  }
  return visits.length;
}

/** One full pass: reminders → expand → deliver. */
export async function dispatchOnce() {
  await queueReminders();
  await expand();
  return deliverDue();
}

/** Staff on duty get SOS alerts by push and SMS, whatever their settings. */
export async function alertSafetyTeam(sos) {
  await q(`INSERT INTO notifications (user_id, type, title, body, data)
    SELECT DISTINCT u.id, 'sos_alert', 'SOS from a physiotherapist', :b, CAST(:d AS jsonb) FROM users u JOIN user_roles r ON r.user_id = u.id
    WHERE r.role IN ('ops_admin', 'super_admin') AND u.status = 'active'`, { b: sos.text, d: JSON.stringify({ sosId: sos.id, visitId: sos.visitId ?? null }) });
}
