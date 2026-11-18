// Timed blocks end on their own: called whenever a blocked user signs in or makes a request.
import { sequelize } from '../db/index.js';

/** Lifts blocks whose end time has passed. Returns true if the account is active again. */
export async function expireBlocks(userId) {
  const [lifted] = await sequelize.query(`UPDATE blocks SET lifted_at = now(), lift_note = 'Block period ended'
    WHERE user_id = :u AND lifted_at IS NULL AND ends_at IS NOT NULL AND ends_at <= now() RETURNING id`, { replacements: { u: userId } });
  if (!lifted.length) return false;
  const [[still]] = await sequelize.query(`SELECT 1 AS x FROM blocks WHERE user_id = :u AND lifted_at IS NULL`, { replacements: { u: userId } });
  if (still) return false;
  await sequelize.query(`UPDATE users SET status = 'active', updated_at = now() WHERE id = :u AND status = 'blocked'`, { replacements: { u: userId } });
  return true;
}
