// Request ids, access logs and rate limits.
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { config } from '../config/index.js';

// ---------- logs ----------
export function log(level, msg, fields = {}) {
  if (config.isTest && level !== 'error') return;
  if (config.logs.format === 'json') {
    process.stdout.write(`${JSON.stringify({ t: new Date().toISOString(), level, msg, ...fields })}\n`);
  } else {
    const extra = Object.entries(fields).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' ');
    (level === 'error' ? console.error : console.log)(`[${level}] ${msg}${extra ? ` ${extra}` : ''}`);
  }
}

/** Gives every request an id (returned as X-Request-Id) and logs method, path, status, time and who. */
export function requestLog(req, res, next) {
  req.id = String(req.get('x-request-id') || crypto.randomUUID()).slice(0, 64);
  res.set('X-Request-Id', req.id);
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    if (!config.logs.requests) return;
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    if (req.path === '/api/v1/status' && res.statusCode < 400) return; // monitors poll this constantly
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 || ms > config.logs.slowMs ? 'warn' : 'info';
    // Never log bodies, tokens, codes or full phone numbers.
    log(level, 'request', { id: req.id, method: req.method, path: req.originalUrl.split('?')[0], status: res.statusCode, ms: Math.round(ms), user: req.user?.id ?? null, ip: req.ip });
  });
  next();
}

// ---------- rate limits ----------
const tooMany = message => (_req, res) => res.status(429).json({ error: { code: 'rate_limited', message } });
const off = (_req, _res, next) => next();
const make = opts => (config.security.rateLimits ? rateLimit({ standardHeaders: 'draft-7', legacyHeaders: false, ...opts }) : off);

/** Everyone, per IP: stops scraping and accidental loops. */
export const apiLimiter = make({ windowMs: 60_000, limit: config.security.rateLimitPerMinute, handler: tooMany('Too many requests. Please wait a minute.') });
/** Sign-in, per IP (each phone number is also limited by the OTP rules). */
export const createAuthLimiter = () => rateLimit({ standardHeaders: 'draft-7', legacyHeaders: false, windowMs: 15 * 60_000, limit: config.security.authLimitPer15Min, handler: tooMany('Too many sign-in attempts from this network. Try again in 15 minutes.') });
export const authLimiter = config.security.rateLimits ? createAuthLimiter() : off;
/** Uploads, per signed-in person (falls back to IP). */
export const uploadLimiter = make({ windowMs: 60 * 60_000, limit: config.security.uploadLimitPerHour, keyGenerator: req => req.get('authorization')?.slice(-24) || req.ip, handler: tooMany('Too many uploads. Try again later.') });
