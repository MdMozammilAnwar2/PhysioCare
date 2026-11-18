// All server configuration and business constants. Every value can be changed in apps/api/.env
// (see .env.example for the full list); the defaults below are used when a variable is not set.
// Tests always use the defaults so they stay predictable whatever is in your .env.
import { APP_VERSION } from '@physioconnect/shared';

const env = process.env;
const isTest = env.NODE_ENV === 'test';
const raw = name => (isTest ? undefined : env[name]);

function required(name, fallbackForDevAndTest) {
  const v = env[name];
  if (v && v !== 'change-me') return v;
  if (env.NODE_ENV === 'production') throw new Error(`Missing required environment variable ${name}`);
  return fallbackForDevAndTest;
}
const str = (name, def) => { const v = raw(name); return v === undefined || v === '' ? def : v; };
const num = (name, def) => {
  const v = raw(name);
  if (v === undefined || v === '') return def;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number (got "${v}")`);
  return n;
};
const bool = (name, def) => { const v = raw(name); return v === undefined || v === '' ? def : /^(1|true|yes|on)$/i.test(v); };
const list = (name, def) => str(name, def).split(',').map(s => s.trim()).filter(Boolean);
// "07:00-20:00" → [420, 1200] (IST minutes since midnight); "closed" → null.
function hours(name, def) {
  const v = str(name, def).trim().toLowerCase();
  if (v === 'closed' || v === 'none') return null;
  const m = v.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
  if (!m) throw new Error(`${name} must look like 07:00-20:00 or "closed" (got "${v}")`);
  return [Number(m[1]) * 60 + Number(m[2]), Number(m[3]) * 60 + Number(m[4])];
}
const localPath = rel => new URL(rel, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

export const config = {
  env: env.NODE_ENV || 'development',
  isTest,
  isProd: env.NODE_ENV === 'production',
  version: APP_VERSION,
  port: Number(env.PORT || 4000),
  databaseUrl: isTest
    ? env.TEST_DATABASE_URL || 'postgres://physio:physio@localhost:5434/physioconnect_test'
    : env.DATABASE_URL || 'postgres://physio:physio@localhost:5434/physioconnect',

  // ---------- security and sign-in ----------
  jwtAccessSecret: required('JWT_ACCESS_SECRET', 'dev-only-access-secret'),
  otpSecret: required('OTP_SECRET', 'dev-only-otp-secret'),
  accessTokenTtl: str('ACCESS_TOKEN_TTL', '15m'),
  refreshTokenDays: num('REFRESH_TOKEN_DAYS', 30),
  otp: {
    length: num('OTP_LENGTH', 6),
    ttlMinutes: num('OTP_TTL_MINUTES', 10),
    maxAttempts: num('OTP_MAX_ATTEMPTS', 5),
    maxSendsPer15Min: num('OTP_MAX_SENDS_PER_15_MIN', 5),
    resendAfterSeconds: num('OTP_RESEND_AFTER_SECONDS', 30),
    // Development only (NODE_ENV=development and SMS_PROVIDER=console): show the code on the sign-in screen.
    devShowCode: bool('OTP_DEV_SHOW_CODE', true),
  },
  sms: {
    provider: isTest ? 'memory' : env.SMS_PROVIDER || 'console',
    msg91AuthKey: env.MSG91_AUTH_KEY,
    msg91TemplateId: env.MSG91_OTP_TEMPLATE_ID,
  },

  // ---------- files ----------
  storage: {
    driver: str('STORAGE_DRIVER', 'local'),
    dir: isTest ? localPath('../../storage-test') : str('STORAGE_DIR', localPath('../../storage')),
  },

  // ---------- URLs ----------
  // QR codes and share links point at the API's /r/:code, which redirects to the website.
  publicApiUrl: str('PUBLIC_API_URL', 'http://localhost:4000').replace(/\/$/, ''),
  siteUrl: str('SITE_URL', 'http://localhost:5173/'),
  corsOrigins: list('CORS_ORIGINS', 'http://localhost:5173,http://localhost:5174'),

  // ---------- visits and safety ----------
  visit: {
    checkinMaxAttempts: num('CHECKIN_MAX_ATTEMPTS', 5),
    slotStepMinutes: num('SLOT_STEP_MINUTES', 15),
    travelMinutesPerKm: num('TRAVEL_MINUTES_PER_KM', 3),
    locationEverySeconds: num('LOCATION_EVERY_SECONDS', 60),
  },
  // Home-visit hours per zone colour (IST). "closed" = no new bookings.
  zoneHours: {
    green: hours('ZONE_HOURS_GREEN', '07:00-20:00'),
    blue: hours('ZONE_HOURS_BLUE', '08:00-19:00'),
    yellow: hours('ZONE_HOURS_YELLOW', '07:00-20:00'),
    orange: hours('ZONE_HOURS_ORANGE', '08:00-18:00'),
    red: hours('ZONE_HOURS_RED', 'closed'),
  },

  // ---------- calendars ----------
  calendar: {
    // Google Calendar (OAuth). Create credentials at console.cloud.google.com → APIs & Services → Credentials
    // (OAuth client ID, type "Web application", redirect URI = PUBLIC_API_URL + /api/v1/calendar/google/callback).
    googleClientId: str('GOOGLE_CLIENT_ID', ''),
    googleClientSecret: str('GOOGLE_CLIENT_SECRET', ''),
    // Key that encrypts stored calendar tokens (32+ random characters). Falls back to a dev-only key.
    tokenKey: required('CALENDAR_TOKEN_KEY', 'dev-only-calendar-token-key-change-me'),
    syncMinutes: num('CALENDAR_SYNC_MINUTES', 10),
    syncDaysAhead: num('CALENDAR_SYNC_DAYS_AHEAD', 60),
    feedDaysBack: num('CALENDAR_FEED_DAYS_BACK', 30),
    feedDaysAhead: num('CALENDAR_FEED_DAYS_AHEAD', 90),
    calendlyApiUrl: str('CALENDLY_API_URL', 'https://api.calendly.com'),
  },

  // ---------- video visits ----------
  video: {
    provider: str('VIDEO_PROVIDER', 'jitsi'), // jitsi (free, no accounts) — rooms are private, unguessable per visit
    baseUrl: str('VIDEO_BASE_URL', 'https://meet.jit.si').replace(/\/$/, ''),
    roomPrefix: str('VIDEO_ROOM_PREFIX', 'PhysioCare'),
    joinEarlyMinutes: num('VIDEO_JOIN_EARLY_MINUTES', 10),
    joinLateMinutes: num('VIDEO_JOIN_LATE_MINUTES', 30),
  },

  // ---------- growth ----------
  coinsPerRupee: num('COINS_PER_RUPEE', 10),
  maxPartnerQrCodes: num('MAX_PARTNER_QR_CODES', 50),
  sameDeviceSignupLimit: num('SAME_DEVICE_SIGNUP_LIMIT', 3),

  // ---------- grievance (IT Rules 2021 / Consumer Protection (E-Commerce) Rules 2020) ----------
  grievance: {
    officerName: str('GRIEVANCE_OFFICER_NAME', 'Dr Gunjan'),
    officerDesignation: str('GRIEVANCE_OFFICER_DESIGNATION', 'Grievance Officer'),
    officerEmail: str('GRIEVANCE_OFFICER_EMAIL', ''),
    officerPhone: str('GRIEVANCE_OFFICER_PHONE', ''),
    address: str('GRIEVANCE_ADDRESS', 'PhysioCare by Healthtropic, Patna, Bihar'),
    workingHours: str('GRIEVANCE_HOURS', 'Mon–Sat, 10 AM–6 PM'),
    ackHours: num('GRIEVANCE_ACK_HOURS', 24),
    resolveDays: num('GRIEVANCE_RESOLVE_DAYS', 15),
  },

  // ---------- defaults for settings that are also editable in the console ----------
  // Written to the database by `npm run api:seed` when missing (or always, with SETTINGS_FROM_ENV=overwrite).
  settingsFromEnv: str('SETTINGS_FROM_ENV', 'missing'), // missing | overwrite
  defaults: {
    money_rules: {
      platformFeePct: num('PLATFORM_FEE_PCT', 0),
      tdsPct: num('TDS_PCT', 0),
      holdDays: num('EARNING_HOLD_DAYS', 7),
      minPayoutPaise: Math.round(num('MIN_PAYOUT_RUPEES', 500) * 100),
      reportWindowDays: num('REPORT_WINDOW_DAYS', 7),
    },
    growth_rules: {
      welcomeCoins: num('WELCOME_COINS', 500),
      referrerCoins: num('REFERRER_COINS', 1000),
      maxCoinPct: num('MAX_COIN_PCT', 20),
      partnerRewardPaise: Math.round(num('PARTNER_REWARD_RUPEES', 100) * 100),
    },
    // Website contact details and links; edited later in the console under Website › Site settings.
    site: {
      siteName: str('SITE_NAME', 'PhysioCare by Healthtropic'),
      tagline: str('SITE_TAGLINE', 'Verified physiotherapy at home in Patna'),
      supportPhone: str('SITE_SUPPORT_PHONE', ''),
      whatsapp: str('SITE_WHATSAPP', ''),
      email: str('SITE_EMAIL', ''),
      address: str('SITE_ADDRESS', 'Patna, Bihar'),
      hours: str('SITE_HOURS', 'Every day, 7 AM–9 PM'),
      announcement: { enabled: false, text: '', href: '' },
      nav: [
        { label: 'Services', href: '/services' }, { label: 'Conditions', href: '/conditions' }, { label: 'Physiotherapists', href: '/physios' },
        { label: 'How it works', href: '/how-it-works' }, { label: 'FAQ', href: '/faq' },
      ],
      footer: [
        { heading: 'PhysioCare', links: [{ label: 'About us', href: '/about' }, { label: 'How it works', href: '/how-it-works' }, { label: 'Blog', href: '/blog' }, { label: 'Patna', href: '/patna' }] },
        { heading: 'For partners', links: [{ label: 'Doctors & hospitals', href: '/partner' }, { label: 'Join as a physiotherapist', href: '/join-as-physio' }] },
        { heading: 'Help', links: [{ label: 'FAQ', href: '/faq' }, { label: 'Complaints & Grievance Officer', href: '/grievance' }, { label: 'Refunds & cancellation', href: '/legal/refunds' }] },
        { heading: 'Legal', links: [{ label: 'Terms of use', href: '/legal/terms' }, { label: 'Privacy policy', href: '/legal/privacy' }, { label: 'Patient consent', href: '/legal/patient-consent' }] },
      ],
      social: { facebook: str('SITE_FACEBOOK', ''), instagram: str('SITE_INSTAGRAM', ''), youtube: str('SITE_YOUTUBE', ''), linkedin: str('SITE_LINKEDIN', '') },
    },
    maintenance: { enabled: bool('MAINTENANCE_ENABLED', false), message: str('MAINTENANCE_MESSAGE', '') || null },
    min_app_version: {
      patient: str('MIN_APP_VERSION_PATIENT', '0.1.0'),
      therapist: str('MIN_APP_VERSION_THERAPIST', '0.1.0'),
      partner: str('MIN_APP_VERSION_PARTNER', '0.1.0'),
      super_admin: str('MIN_APP_VERSION_SUPER_ADMIN', '0.1.0'),
    },
    scheduling: {
      visitMinutes: { home: num('VISIT_MINUTES_HOME', 45), video: num('VISIT_MINUTES_VIDEO', 30), clinic: num('VISIT_MINUTES_CLINIC', 40) },
      travelBufferMinutes: num('TRAVEL_BUFFER_MINUTES', 10),
      bookingWindowDays: num('BOOKING_WINDOW_DAYS', 60),
      minNoticeHours: num('MIN_NOTICE_HOURS', 3),
      paymentHoldMinutes: num('PAYMENT_HOLD_MINUTES', 10),
      offerHoldMinutes: num('OFFER_HOLD_MINUTES', 24),
      minDaysBetweenSessions: num('MIN_DAYS_BETWEEN_SESSIONS', 1),
      maxVisitsPerDay: num('MAX_VISITS_PER_DAY', 8),
      freeRescheduleHours: num('FREE_RESCHEDULE_HOURS', 3),
    },
  },
};
