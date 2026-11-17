// Short-lived JWT access tokens + rotating opaque refresh tokens (stored hashed).
// Reusing an already-rotated refresh token revokes its whole family (stolen-token defence).
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { RefreshToken, sequelize } from '../models/index.js';
import { HttpError, randomToken, sha256 } from '../lib/util.js';

export function signAccessToken(user, roles) {
  return jwt.sign({ sub: user.id, roles }, config.jwtAccessSecret, { expiresIn: config.accessTokenTtl, issuer: 'physioconnect' });
}

export function verifyAccessToken(token) {
  try { return jwt.verify(token, config.jwtAccessSecret, { issuer: 'physioconnect' }); }
  catch { throw new HttpError(401, 'unauthorized', 'Sign in again.'); }
}

async function storeRefresh(userId, familyId, deviceInfo, transaction) {
  const token = randomToken();
  const row = await RefreshToken.create({
    userId, familyId, deviceInfo, tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + config.refreshTokenDays * 24 * 3600 * 1000),
  }, { transaction });
  return { token, row };
}

export async function issueTokens(user, roles, deviceInfo) {
  const { token } = await storeRefresh(user.id, crypto.randomUUID(), deviceInfo);
  return { accessToken: signAccessToken(user, roles), refreshToken: token, tokenType: 'Bearer', expiresIn: 900 };
}

// Returns { userId, refreshToken } for the new token; caller signs a fresh access token.
export async function rotateRefreshToken(presented) {
  const result = await sequelize.transaction(async transaction => {
    const current = await RefreshToken.findOne({ where: { tokenHash: sha256(String(presented || '')) }, transaction, lock: transaction.LOCK.UPDATE });
    if (!current) throw new HttpError(401, 'refresh_invalid', 'Sign in again.');
    // Reuse of a rotated token: report it, and revoke the family after this transaction
    // (throwing here would roll the revocation back).
    if (current.revokedAt) return { reusedFamilyId: current.familyId };
    if (current.expiresAt < new Date()) throw new HttpError(401, 'refresh_expired', 'Sign in again.');
    const { token, row } = await storeRefresh(current.userId, current.familyId, current.deviceInfo, transaction);
    await current.update({ revokedAt: new Date(), replacedBy: row.id }, { transaction });
    return { userId: current.userId, refreshToken: token };
  });
  if (result.reusedFamilyId) {
    await RefreshToken.update({ revokedAt: new Date() }, { where: { familyId: result.reusedFamilyId, revokedAt: null } });
    throw new HttpError(401, 'refresh_reused', 'This session was ended for safety. Sign in again.');
  }
  return result;
}

export async function revokeRefreshToken(presented) {
  const current = await RefreshToken.findOne({ where: { tokenHash: sha256(String(presented || '')) } });
  if (current) await RefreshToken.update({ revokedAt: new Date() }, { where: { familyId: current.familyId, revokedAt: null } });
}

export async function revokeAllForUser(userId) {
  await RefreshToken.update({ revokedAt: new Date() }, { where: { userId, revokedAt: null } });
}
