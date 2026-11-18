// Launch checks. In production the API refuses to start while any BLOCKER is present.
// `npm run api:check` prints the same list for any .env (use it before every release).
import { config } from '../config/index.js';

const env = process.env;
const weak = v => !v || v === 'change-me' || v.length < 32 || /^dev-only/.test(v);
const local = u => /localhost|127\.0\.0\.1|10\.0\.2\.2/.test(u ?? '');

export function preflight() {
  const blockers = [], warnings = [];
  const B = (ok, msg) => { if (!ok) blockers.push(msg); };
  const W = (ok, msg) => { if (!ok) warnings.push(msg); };

  // ---- security ----
  B(!weak(env.JWT_ACCESS_SECRET), 'JWT_ACCESS_SECRET must be a random string of 32+ characters.');
  B(!weak(env.OTP_SECRET), 'OTP_SECRET must be a random string of 32+ characters.');
  B(!weak(env.CALENDAR_TOKEN_KEY), 'CALENDAR_TOKEN_KEY must be a random string of 32+ characters (never change it after launch).');
  B(env.JWT_ACCESS_SECRET !== env.OTP_SECRET, 'JWT_ACCESS_SECRET and OTP_SECRET must be different.');
  B(!/physio:physio@/.test(env.DATABASE_URL ?? ''), 'DATABASE_URL uses the development password. Set a strong database password.');
  B(Boolean(env.DATABASE_URL), 'DATABASE_URL is not set.');

  // ---- sign-in must really send SMS ----
  B(config.sms.provider === 'msg91', 'SMS_PROVIDER must be msg91 (codes are only printed in the log otherwise).');
  B(config.sms.provider !== 'msg91' || (config.sms.msg91AuthKey && config.sms.msg91TemplateId), 'MSG91_AUTH_KEY and MSG91_OTP_TEMPLATE_ID are required for sign-in SMS.');

  // ---- addresses ----
  for (const [k, v] of [['PUBLIC_API_URL', config.publicApiUrl], ['SITE_URL', config.siteUrl]]) {
    B(/^https:\/\//.test(v) && !local(v), `${k} must be your real https address (it is printed on QR codes and in links).`);
  }
  B(config.corsOrigins.every(o => /^https:\/\//.test(o) && !local(o)), 'CORS_ORIGINS must list only your https website and console addresses.');

  // ---- accounts ----
  const sa = (env.SUPER_ADMIN_PHONE ?? '').replace(/\D/g, '').slice(-10);
  B(/^[6-9]\d{9}$/.test(sa) && !/^(\d)\1{9}$/.test(sa), 'SUPER_ADMIN_PHONE must be your real mobile number.');

  // ---- business settings (launch can continue, but fix these) ----
  W(Boolean(env.PAYMENT_UPI_ID), 'PAYMENT_UPI_ID is empty: patients can only pay cash.');
  W(Boolean(config.grievance.officerEmail), 'GRIEVANCE_OFFICER_EMAIL is empty: the law requires public contact details for the Grievance Officer.');
  W(Boolean(env.SITE_SUPPORT_PHONE || env.SUPPORT_PHONE), 'SITE_SUPPORT_PHONE is empty: no support number on the website.');
  W(config.messaging.pushProvider === 'expo', 'PUSH_PROVIDER is not expo: app notifications are off.');
  W(config.messaging.smsProvider === 'msg91', 'NOTIFY_SMS_PROVIDER is not msg91: booking/reminder SMS are off.');
  W(config.messaging.smsProvider !== 'msg91' || Object.keys(config.messaging.msg91Flows).length > 0, 'No MSG91_FLOW_* templates: no notification SMS will be sent.');
  W(config.messaging.whatsappProvider !== 'console', 'WHATSAPP_PROVIDER is console: set msg91 or none.');
  W(config.calls.provider !== 'console', 'CALL_PROVIDER is console: masked calling won’t connect real calls (set exotel or none).');
  W(config.maps.provider === 'google' && config.maps.googleKey, 'MAPS_PROVIDER is not google: no address search; drive times are estimated.');
  W(Boolean(config.calendar.googleClientId), 'GOOGLE_CLIENT_ID is empty: physios can’t connect Google Calendar.');
  W(config.defaults.money_rules.platformFeePct > 0, 'PLATFORM_FEE_PCT is 0 (check Fees, TDS & holds in the console after launch).');
  W(config.defaults.money_rules.tdsPct > 0, 'TDS_PCT is 0: confirm the TDS rate with your CA.');
  W(config.storage.driver === 'local' && Boolean(env.STORAGE_DIR), 'STORAGE_DIR is empty: uploaded files go inside the app folder. Use the persistent volume (/data/storage).');
  return { blockers, warnings };
}
