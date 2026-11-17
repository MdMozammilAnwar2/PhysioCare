import { sequelize } from '../db/index.js';

export async function schedulingRules() {
  const [[row]] = await sequelize.query(`SELECT rules FROM scheduling_rules WHERE effective_from <= now() ORDER BY version DESC LIMIT 1`);
  return row.rules;
}

// What each zone colour allows. Hours are IST minutes since midnight.
const ZONE_RULES = {
  green: { newBookings: true, home: [7 * 60, 20 * 60] },
  blue: { newBookings: true, home: [8 * 60, 19 * 60] },
  yellow: { newBookings: true, home: [7 * 60, 20 * 60] },
  orange: { newBookings: true, home: [8 * 60, 18 * 60], familyPresentForFemalePhysio: true },
  red: { newBookings: false, home: null },
};
// An address outside every zone is treated as Red until a zone is added.
export const zoneRules = color => ZONE_RULES[color] ?? ZONE_RULES.red;
