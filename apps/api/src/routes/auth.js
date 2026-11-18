import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { SELF_SERVE_ROLES } from '@physioconnect/shared';
import { config } from '../config/index.js';
import { Block, User, UserRole, sequelize } from '../models/index.js';
import { HttpError, normalizeIndianPhone } from '../lib/util.js';
import { asyncHandler, primaryRole, validate } from '../middleware/index.js';
import { sendOtp, verifyOtp } from '../services/otp.js';
import { issueTokens, revokeAllForUser, revokeRefreshToken, rotateRefreshToken, signAccessToken } from '../services/tokens.js';
import { recordSignupAttribution } from '../services/attribution.js';
import { onSignup } from '../services/growth.js';
import { expireBlocks } from '../services/blocks.js';
import { audit } from '../services/audit.js';

export const authRouter = Router();

const limiter = rateLimit({ windowMs: 60 * 1000, limit: config.isTest ? 1000 : 20, standardHeaders: 'draft-7', legacyHeaders: false });
authRouter.use(limiter);

const phoneField = z.string().transform((v, ctx) => {
  const p = normalizeIndianPhone(v);
  if (!p) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid 10-digit Indian mobile number.' }); return z.NEVER; }
  return p;
});

authRouter.post('/otp/send', validate(z.object({ phone: phoneField })), asyncHandler(async (req, res) => {
  const result = await sendOtp(req.body.phone, { ip: req.ip });
  res.json({ sent: true, ...result });
}));

const verifySchema = z.object({
  phone: phoneField,
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code.'),
  role: z.string().optional(),
  ref: z.string().trim().max(64).optional(),
  utm: z.object({ source: z.string().max(64).optional(), medium: z.string().max(64).optional(), campaign: z.string().max(128).optional(), content: z.string().max(128).optional() }).optional(),
  deviceId: z.string().max(128).optional(),
  selfReported: z.string().max(200).optional(),
});

authRouter.post('/otp/verify', validate(verifySchema), asyncHandler(async (req, res) => {
  const { phone, code, ref, utm, deviceId, selfReported } = req.body;
  const requestedRole = req.body.role;
  // Admin roles, including super admin, can never be self-assigned.
  if (requestedRole && !SELF_SERVE_ROLES.includes(requestedRole)) throw new HttpError(403, 'role_not_allowed', 'This account type can’t be created here.');
  await verifyOtp(phone, code);

  const { user, isNew } = await sequelize.transaction(async transaction => {
    let u = await User.findOne({ where: { phone }, transaction });
    let created = false;
    if (!u) {
      u = await User.create({ phone }, { transaction });
      created = true;
      const attribution = await recordSignupAttribution(u, { ref, utm, deviceId, ip: req.ip, selfReported }, transaction);
      await onSignup(u, attribution, transaction);
      await audit({ actor: null, action: 'user.signup', targetType: 'user', targetId: u.id, after: { role: requestedRole ?? 'patient' }, ip: req.ip }, transaction);
    }
    // New accounts default to patient. Existing accounts only gain a role when the app asks for one
    // (e.g. a patient joining as a physio); signing in to the admin console never adds a role.
    const role = created ? requestedRole ?? 'patient' : requestedRole;
    if (role) await UserRole.findOrCreate({ where: { userId: u.id, role }, transaction });
    return { user: u, isNew: created };
  });

  if (user.status === 'blocked' && await expireBlocks(user.id)) await user.reload();
  if (user.status === 'blocked') {
    const block = await Block.findOne({ where: { userId: user.id, liftedAt: null }, order: [['createdAt', 'DESC']] });
    throw new HttpError(403, 'account_blocked', 'This account is blocked.', { endsAt: block?.endsAt ?? null, canAppeal: true });
  }
  await user.update({ lastLoginAt: new Date() });
  const roles = (await UserRole.findAll({ where: { userId: user.id } })).map(r => r.role);
  const tokens = await issueTokens(user, roles, { ua: req.get('user-agent') ?? null, deviceId: deviceId ?? null });
  res.status(isNew ? 201 : 200).json({ isNew, user: publicUser(user, roles), tokens });
}));

authRouter.post('/refresh', validate(z.object({ refreshToken: z.string().min(20) })), asyncHandler(async (req, res) => {
  const { userId, refreshToken } = await rotateRefreshToken(req.body.refreshToken);
  const user = await User.findByPk(userId);
  if (!user || user.status !== 'active') {
    await revokeAllForUser(userId);
    throw new HttpError(403, 'account_blocked', 'This account can’t sign in.');
  }
  const roles = (await UserRole.findAll({ where: { userId } })).map(r => r.role);
  res.json({ tokens: { accessToken: signAccessToken(user, roles), refreshToken, tokenType: 'Bearer', expiresIn: 900 } });
}));

authRouter.post('/logout', validate(z.object({ refreshToken: z.string() })), asyncHandler(async (req, res) => {
  await revokeRefreshToken(req.body.refreshToken);
  res.status(204).end();
}));

export const publicUser = (u, roles) => ({ id: u.id, phone: u.phone, name: u.name, language: u.preferredLanguage, status: u.status, roles, primaryRole: primaryRole(roles) });
