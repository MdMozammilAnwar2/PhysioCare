import { APP_VERSION } from '@physioconnect/shared';

const env = process.env;
const isTest = env.NODE_ENV === 'test';

function required(name, fallbackForDevAndTest) {
  const v = env[name];
  if (v && v !== 'change-me') return v;
  if (env.NODE_ENV === 'production') throw new Error(`Missing required environment variable ${name}`);
  return fallbackForDevAndTest;
}

export const config = {
  env: env.NODE_ENV || 'development',
  isTest,
  isProd: env.NODE_ENV === 'production',
  version: APP_VERSION,
  port: Number(env.PORT || 4000),
  databaseUrl: isTest
    ? env.TEST_DATABASE_URL || 'postgres://physio:physio@localhost:5434/physioconnect_test'
    : env.DATABASE_URL || 'postgres://physio:physio@localhost:5434/physioconnect',
  jwtAccessSecret: required('JWT_ACCESS_SECRET', 'dev-only-access-secret'),
  otpSecret: required('OTP_SECRET', 'dev-only-otp-secret'),
  accessTokenTtl: '15m',
  refreshTokenDays: 30,
  otp: { length: 6, ttlMinutes: 10, maxAttempts: 5, maxSendsPer15Min: 5, resendAfterSeconds: 30 },
  sms: {
    provider: isTest ? 'memory' : env.SMS_PROVIDER || 'console',
    msg91AuthKey: env.MSG91_AUTH_KEY,
    msg91TemplateId: env.MSG91_OTP_TEMPLATE_ID,
  },
  corsOrigins: (env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:5174').split(',').map(s => s.trim()),
};
