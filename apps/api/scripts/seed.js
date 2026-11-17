// Idempotent seed: cities, Patna zones, and the super admin account.
// The super admin is created ONLY here, from server environment variables. No API can create one.
import { sequelize, User, UserRole } from '../src/models/index.js';
import { normalizeIndianPhone } from '../src/lib/util.js';
import { audit } from '../src/services/audit.js';

const CITIES = [['Patna', 'live'], ['Muzaffarpur', 'recruiting'], ['Hajipur', 'recruiting'], ['Samastipur', 'planned'], ['Darbhanga', 'planned'], ['Gaya', 'planned'], ['Bhagalpur', 'planned'], ['Seemanchal', 'planned']];
const PATNA_ZONES = [['Kankarbagh', 'green'], ['Rajendra Nagar', 'green'], ['Patliputra', 'green'], ['Bailey Road', 'green'], ['Gardanibagh', 'green'], ['Boring Road', 'orange'], ['Danapur', 'yellow'], ['Phulwari Sharif', 'yellow'], ['Anisabad', 'yellow'], ['Kurji', 'blue'], ['Ashok Rajpath', 'blue'], ['Digha', 'red']];

try {
  for (const [name, status] of CITIES) {
    await sequelize.query(`INSERT INTO cities (name, status) VALUES (:name, :status) ON CONFLICT (name) DO NOTHING`, { replacements: { name, status } });
  }
  for (const [name, color] of PATNA_ZONES) {
    await sequelize.query(`INSERT INTO zones (city_id, name, color, reason) SELECT id, :name, :color, 'Initial setup' FROM cities WHERE name = 'Patna' ON CONFLICT (city_id, name) DO NOTHING`, { replacements: { name, color } });
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
