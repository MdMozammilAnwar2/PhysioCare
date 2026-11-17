import { Op } from 'sequelize';
import { config } from '../config/index.js';
import { OtpRequest } from '../models/index.js';
import { HttpError, hmac, randomDigits, safeEqualHex } from '../lib/util.js';
import { smsProvider } from './sms.js';

const hashCode = (phone, code) => hmac(config.otpSecret, `${phone}:${code}`);

export async function sendOtp(phone, { ip, purpose = 'login' } = {}) {
  const since = new Date(Date.now() - 15 * 60 * 1000);
  const recent = await OtpRequest.findAll({ where: { phone, createdAt: { [Op.gte]: since } }, order: [['createdAt', 'DESC']] });
  if (recent.length >= config.otp.maxSendsPer15Min) throw new HttpError(429, 'otp_rate_limited', 'Too many codes requested. Try again in 15 minutes.');
  if (recent[0] && Date.now() - recent[0].createdAt.getTime() < config.otp.resendAfterSeconds * 1000) {
    throw new HttpError(429, 'otp_resend_too_soon', `Wait ${config.otp.resendAfterSeconds} seconds before asking for a new code.`);
  }
  const code = randomDigits(config.otp.length);
  await OtpRequest.create({ phone, codeHash: hashCode(phone, code), purpose, ip, expiresAt: new Date(Date.now() + config.otp.ttlMinutes * 60 * 1000) });
  await smsProvider().sendOtp(phone, code);
  return { expiresInSeconds: config.otp.ttlMinutes * 60, resendAfterSeconds: config.otp.resendAfterSeconds };
}

export async function verifyOtp(phone, code) {
  const otp = await OtpRequest.findOne({
    where: { phone, consumedAt: null, expiresAt: { [Op.gt]: new Date() } },
    order: [['createdAt', 'DESC']],
  });
  if (!otp) throw new HttpError(400, 'otp_invalid', 'The code is wrong or has expired. Ask for a new one.');
  if (otp.attempts >= config.otp.maxAttempts) throw new HttpError(429, 'otp_locked', 'Too many wrong tries. Ask for a new code.');
  if (!safeEqualHex(otp.codeHash, hashCode(phone, String(code)))) {
    await otp.increment('attempts');
    throw new HttpError(400, 'otp_invalid', 'The code is wrong or has expired. Ask for a new one.');
  }
  await otp.update({ consumedAt: new Date() });
  return true;
}
