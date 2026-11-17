// Development only: three verified demo physios in Patna with hours, prices and a recovery plan.
import { sequelize } from '../src/models/index.js';

if (process.env.NODE_ENV === 'production') { console.error('seed-demo is for development only.'); process.exit(1); }

const DEMO = [
  ['+919000000001', 'Dr. Priya Sinha', 'female', 'MPT', 8, 25.596, 85.150, 4.9, 'platinum', '{after_surgery,sports}', '{hi,en}', 80000],
  ['+919000000002', 'Dr. Neha Raj', 'female', 'MPT', 6, 25.600, 85.120, 4.8, 'gold', '{neuro,elderly}', '{hi,mai,en}', 70000],
  ['+919000000003', 'Dr. Arjun Kumar', 'male', 'BPT', 5, 25.615, 85.105, 4.7, 'silver', '{back_neck,after_surgery}', '{hi,bho}', 60000],
];

try {
  for (const [phone, name, gender, qual, yrs, lat, lng, rating, tier, specs, langs, price] of DEMO) {
    const [[u]] = await sequelize.query(`INSERT INTO users (phone, name, gender) VALUES (:phone, :name, :gender)
      ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name RETURNING id`, { replacements: { phone, name, gender } });
    await sequelize.query(`INSERT INTO user_roles (user_id, role) VALUES (:u, 'therapist') ON CONFLICT DO NOTHING`, { replacements: { u: u.id } });
    await sequelize.query(`INSERT INTO therapist_profiles (user_id, qualification, years_experience, home_lat, home_lng, service_radius_km, verification_status, rating, tier, specialisations, languages, bio)
      VALUES (:u, :q, :y, :lat, :lng, 8, 'verified', :r, :tier, :specs, :langs, 'Demo physiotherapist for local development.')
      ON CONFLICT (user_id) DO NOTHING`, { replacements: { u: u.id, q: qual, y: yrs, lat, lng, r: rating, tier, specs, langs } });
    await sequelize.query(`INSERT INTO therapist_prices (therapist_id, mode, price_paise) VALUES (:u, 'home', :p), (:u, 'video', :v) ON CONFLICT DO NOTHING`, { replacements: { u: u.id, p: price, v: Math.round(price * 0.6) } });
    const [[{ c }]] = await sequelize.query(`SELECT count(*)::int AS c FROM availability_rules WHERE therapist_id = :u`, { replacements: { u: u.id } });
    if (!c) for (let wd = 1; wd <= 6; wd++) {
      await sequelize.query(`INSERT INTO availability_rules (therapist_id, weekday, start_time, end_time, modes) VALUES (:u, :wd, '07:00', '13:00', '{home,video}'), (:u, :wd, '16:00', '19:00', '{home,video}')`, { replacements: { u: u.id, wd } });
    }
    const [[{ k }]] = await sequelize.query(`SELECT count(*)::int AS k FROM packages WHERE therapist_id = :u`, { replacements: { u: u.id } });
    if (!k) await sequelize.query(`INSERT INTO packages (therapist_id, name, mode, sessions, price_paise) VALUES (:u, '10-session recovery plan', 'home', 10, :p)`, { replacements: { u: u.id, p: price * 8 } });
  }
  console.log(`Seeded ${DEMO.length} demo physios.`);
} finally {
  await sequelize.close();
}
