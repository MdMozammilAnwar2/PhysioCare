import { sequelize } from '../db/index.js';
import { config } from '../config/index.js';

export async function schedulingRules() {
  const [[row]] = await sequelize.query(`SELECT rules FROM scheduling_rules WHERE effective_from <= now() ORDER BY version DESC LIMIT 1`);
  return row.rules;
}

// What each zone colour allows. Hours are IST minutes since midnight.
// Hours come from ZONE_HOURS_<COLOUR> in .env.
const ZONE_RULES = {
  green: { newBookings: Boolean(config.zoneHours.green), home: config.zoneHours.green },
  blue: { newBookings: Boolean(config.zoneHours.blue), home: config.zoneHours.blue },
  yellow: { newBookings: Boolean(config.zoneHours.yellow), home: config.zoneHours.yellow },
  orange: { newBookings: Boolean(config.zoneHours.orange), home: config.zoneHours.orange, familyPresentForFemalePhysio: true },
  red: { newBookings: Boolean(config.zoneHours.red), home: config.zoneHours.red },
};
// An address outside every zone is treated as Red until a zone is added.
export const zoneRules = color => ZONE_RULES[color] ?? ZONE_RULES.red;
