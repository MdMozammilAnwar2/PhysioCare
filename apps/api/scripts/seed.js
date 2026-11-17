// Idempotent seed: cities, Patna zones, and the super admin account.
// The super admin is created ONLY here, from server environment variables. No API can create one.
import { sequelize, User, UserRole } from '../src/models/index.js';
import { normalizeIndianPhone } from '../src/lib/util.js';
import { audit } from '../src/services/audit.js';

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
