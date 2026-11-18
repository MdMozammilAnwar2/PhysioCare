// Idempotent seed: cities, Patna zones, and the super admin account.
// The super admin is created ONLY here, from server environment variables. No API can create one.
import { sequelize, User, UserRole } from '../src/models/index.js';
import { normalizeIndianPhone } from '../src/lib/util.js';
import { audit } from '../src/services/audit.js';
import { config } from '../src/config/index.js';

const CITIES = [['Patna', 'live'], ['Muzaffarpur', 'recruiting'], ['Hajipur', 'recruiting'], ['Samastipur', 'planned'], ['Darbhanga', 'planned'], ['Gaya', 'planned'], ['Bhagalpur', 'planned'], ['Seemanchal', 'planned']];
// [name, colour, approx centre lat, lng, radius km] — placeholders until zones are drawn in the console.
const PATNA_ZONES = [
  ['Kankarbagh', 'green', 25.5940, 85.1580, 2.5], ['Rajendra Nagar', 'green', 25.6060, 85.1650, 1.5], ['Patliputra', 'green', 25.6200, 85.1000, 2],
  ['Bailey Road', 'green', 25.6050, 85.0950, 2], ['Gardanibagh', 'green', 25.5880, 85.1180, 1.5], ['Boring Road', 'orange', 25.6160, 85.1150, 1.5],
  ['Danapur', 'yellow', 25.6300, 85.0450, 3], ['Phulwari Sharif', 'yellow', 25.5700, 85.0800, 2.5], ['Anisabad', 'yellow', 25.5850, 85.1000, 1.5],
  ['Kurji', 'blue', 25.6380, 85.1050, 1.2], ['Ashok Rajpath', 'blue', 25.6200, 85.1700, 1.5], ['Digha', 'red', 25.6430, 85.0980, 1.5],
];

try {
  for (const [name, status] of CITIES) {
    await sequelize.query(`INSERT INTO cities (name, status) VALUES (:name, :status) ON CONFLICT (name) DO NOTHING`, { replacements: { name, status } });
  }
  for (const [name, color, lat, lng, r] of PATNA_ZONES) {
    await sequelize.query(`INSERT INTO zones (city_id, name, color, reason, center_lat, center_lng, radius_km)
      SELECT id, :name, :color, 'Initial setup', :lat, :lng, :r FROM cities WHERE name = 'Patna'
      ON CONFLICT (city_id, name) DO UPDATE SET center_lat = COALESCE(zones.center_lat, EXCLUDED.center_lat),
        center_lng = COALESCE(zones.center_lng, EXCLUDED.center_lng), radius_km = COALESCE(zones.radius_km, EXCLUDED.radius_km)`,
    { replacements: { name, color, lat, lng, r } });
  }
  console.log(`Seeded ${CITIES.length} cities and ${PATNA_ZONES.length} Patna zones.`);

  // Console-editable settings start from .env. SETTINGS_FROM_ENV=overwrite replaces what is in the database.
  const overwrite = config.settingsFromEnv === 'overwrite';
  for (const key of ['money_rules', 'growth_rules', 'maintenance', 'min_app_version']) {
    const [rows] = await sequelize.query(`INSERT INTO app_settings (key, value) VALUES (:k, :v)
      ON CONFLICT (key) DO ${overwrite ? 'UPDATE SET value = EXCLUDED.value, updated_at = now()' : 'NOTHING'} RETURNING key`,
    { replacements: { k: key, v: JSON.stringify(config.defaults[key]) } });
    if (rows.length) console.log(`Setting ${key} ${overwrite ? 'set' : 'added'} from .env.`);
  }
  if (overwrite) {
    await sequelize.query(`INSERT INTO scheduling_rules (rules) VALUES (:r)`, { replacements: { r: JSON.stringify(config.defaults.scheduling) } });
    console.log('Scheduling rules set from .env (new version).');
  }

  const upiId = (process.env.PAYMENT_UPI_ID || '').trim();
  if (/^[\w.-]{2,256}@[a-zA-Z]{2,64}$/.test(upiId)) {
    await sequelize.query(`UPDATE app_settings SET value = :v, updated_at = now() WHERE key = 'payment_upi'`,
      { replacements: { v: JSON.stringify({ upiId, payeeName: process.env.PAYMENT_UPI_NAME || 'PhysioConnect' }) } });
    console.log(`UPI for payments set to ${upiId}.`);
  } else console.log('PAYMENT_UPI_ID not set: UPI payments stay off (cash only) until it is.');

  const phone = normalizeIndianPhone(process.env.SUPER_ADMIN_PHONE);
  if (!phone) {
    console.log('SUPER_ADMIN_PHONE not set or invalid: no super admin created.');
  } else {
    const [user] = await User.findOrCreate({ where: { phone }, defaults: { name: process.env.SUPER_ADMIN_NAME || 'Super admin' } });
    const [, created] = await UserRole.findOrCreate({ where: { userId: user.id, role: 'super_admin' } });
    if (created) await audit({ actor: null, action: 'super_admin.provisioned', targetType: 'user', targetId: user.id, after: { via: 'server seed' } });
    console.log(created ? `Super admin provisioned for ${phone}.` : `Super admin already exists for ${phone}.`);
  }
} finally {
  await sequelize.close();
}
