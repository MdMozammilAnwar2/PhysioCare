import { ZodError } from 'zod';
import { User, UserRole } from '../models/index.js';
import { HttpError } from '../lib/util.js';
import { verifyAccessToken } from '../services/tokens.js';
import { expireBlocks } from '../services/blocks.js';

const ROLE_ORDER = ['super_admin', 'ops_admin', 'finance', 'city_coordinator', 'grievance_committee', 'content_editor', 'therapist', 'partner_owner', 'partner_staff', 'partner_wallet', 'patient'];
export const primaryRole = roles => ROLE_ORDER.find(r => roles.includes(r)) ?? roles[0];

export const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export const validate = schema => (req, _res, next) => {
  try { req.body = schema.parse(req.body ?? {}); next(); } catch (e) { next(e); }
};

export const requireAuth = asyncHandler(async (req, _res, next) => {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new HttpError(401, 'unauthorized', 'Sign in first.');
  const claims = verifyAccessToken(token);
  const user = await User.findByPk(claims.sub);
  if (!user || user.status === 'deleted') throw new HttpError(401, 'unauthorized', 'Sign in again.');
  if (user.status === 'blocked' && await expireBlocks(user.id)) await user.reload();
  if (user.status === 'blocked') throw new HttpError(403, 'account_blocked', 'This account is blocked. Open the app to see why and how to appeal.');
  const roles = (await UserRole.findAll({ where: { userId: user.id } })).map(r => r.role);
  req.user = { id: user.id, roles, primaryRole: primaryRole(roles), model: user };
  next();
});

export const requireRole = (...allowed) => (req, _res, next) => {
  if (!req.user?.roles.some(r => allowed.includes(r))) return next(new HttpError(403, 'forbidden', 'You don’t have access to this.'));
  next();
};

export function notFound(_req, _res, next) { next(new HttpError(404, 'not_found', 'Not found.')); }

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  if (err instanceof ZodError) return res.status(400).json({ error: { code: 'invalid_input', message: 'Check the highlighted fields.', details: err.flatten().fieldErrors } });
  if (err instanceof HttpError) return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  console.error(err);
  res.status(500).json({ error: { code: 'server_error', message: 'Something went wrong. Please try again.' } });
}
