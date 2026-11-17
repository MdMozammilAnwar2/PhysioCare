import crypto from 'node:crypto';

export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
export const hmac = (secret, value) => crypto.createHmac('sha256', secret).update(value).digest('hex');
export const randomToken = (bytes = 48) => crypto.randomBytes(bytes).toString('base64url');
export const randomDigits = length => String(crypto.randomInt(0, 10 ** length)).padStart(length, '0');
export function safeEqualHex(a, b) {
  const x = Buffer.from(a, 'hex'), y = Buffer.from(b, 'hex');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Indian mobile numbers only for now. Accepts "9876543210", "+91 98765 43210", "09876543210".
export function normalizeIndianPhone(input) {
  const digits = String(input || '').replace(/\D/g, '');
  const local = digits.length === 12 && digits.startsWith('91') ? digits.slice(2)
    : digits.length === 11 && digits.startsWith('0') ? digits.slice(1)
      : digits;
  if (!/^[6-9]\d{9}$/.test(local)) return null;
  return `+91${local}`;
}

export const maskPhone = phone => phone.replace(/^(\+91\d{2})\d{6}(\d{2})$/, '$1••••••$2');
