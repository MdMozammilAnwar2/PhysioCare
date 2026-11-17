// Records how a new user arrived. The first valid source is credited; it is locked at the first paid session.
import { Op } from 'sequelize';
import { ATTRIBUTION_SOURCES } from '@physioconnect/shared';
import { Attribution, LinkEvent, TrackedLink } from '../models/index.js';

const SAME_DEVICE_SIGNUP_LIMIT = 3; // more sign-ups than this from one device in 24 h is flagged

export async function recordSignupAttribution(user, { ref, utm, deviceId, ip, selfReported } = {}, transaction) {
  let link = null;
  let flagReason = null;

  if (ref) {
    link = await TrackedLink.findOne({ where: { code: String(ref).trim(), active: true }, transaction });
    if (link) {
      if (link.expiresAt && link.expiresAt < new Date()) { flagReason = 'link_expired'; link = null; }
      else if (link.singleUse && link.usedAt) { flagReason = 'link_already_used'; link = null; }
      else if (link.ownerUserId && link.ownerUserId === user.id) { flagReason = 'self_referral'; link = null; }
    }
  }

  let flagged = false;
  if (deviceId) {
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const count = await LinkEvent.count({ where: { deviceId, event: 'signup', createdAt: { [Op.gte]: since } }, transaction });
    if (count >= SAME_DEVICE_SIGNUP_LIMIT) { flagged = true; flagReason = 'many_signups_same_device'; }
  }

  const source = link ? link.type : utm?.source ? ATTRIBUTION_SOURCES.CAMPAIGN : selfReported ? ATTRIBUTION_SOURCES.SELF_REPORTED : ATTRIBUTION_SOURCES.ORGANIC;

  const attribution = await Attribution.create({
    userId: user.id,
    firstSource: source,
    firstLinkId: link?.id ?? null,
    firstUtm: utm ?? null,
    creditedUserId: link ? (link.referredByUserId || link.ownerUserId) : null,
    creditedPartnerId: link?.ownerPartnerId ?? null,
    lastSource: source,
    lastLinkId: link?.id ?? null,
    lastTouchAt: new Date(),
    selfReported: selfReported ?? null,
    flagged,
    flagReason,
  }, { transaction });

  await LinkEvent.create({ linkId: link?.id ?? null, code: ref ?? null, event: 'signup', userId: user.id, deviceId, ip, utm }, { transaction });
  if (link?.singleUse) await link.update({ usedAt: new Date() }, { transaction });
  return attribution;
}
