import { AuditLog } from '../models/index.js';

export async function audit({ actor, action, targetType, targetId, before, after, ip }, transaction) {
  await AuditLog.create({
    actorUserId: actor?.id ?? null,
    actorRole: actor?.primaryRole ?? (actor ? null : 'system'),
    action, targetType, targetId: targetId ? String(targetId) : null, before, after, ip,
  }, { transaction });
}
