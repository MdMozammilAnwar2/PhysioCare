// Finds the top 3 physios for a patient. Hard rules first (never broken), then ranking.
import { sequelize } from '../db/index.js';
import { HttpError } from '../lib/util.js';
import { distanceKm } from '../lib/geo.js';
import { zoneRules } from './rules.js';

/**
 * Gender safety rule: a woman patient is matched with a male physio only when an adult family
 * member will be present AND both consent (the physio consents per patient before accepting).
 * Returns 'allowed' | 'needs_family_and_consent' | 'not_allowed'.
 */
export function genderRule(patientGender, physioGender, familyPresent) {
  if (patientGender !== 'female' || physioGender !== 'male') return 'allowed';
  return familyPresent ? 'needs_family_and_consent' : 'not_allowed';
}

export async function matchTherapists({ patient, address, zone, mode, specialisation, familyPresent = false, limit = 3 }) {
  if (mode === 'home') {
    const rules = zoneRules(zone?.color);
    if (!rules.newBookings || !rules.home) throw new HttpError(409, 'zone_closed', 'Home visits are paused in this area. Try a video session.', { zone });
  }
  const [rows] = await sequelize.query(`
    SELECT u.id, u.name, u.gender, tp.qualification, tp.years_experience, tp.specialisations, tp.languages,
           tp.home_lat, tp.home_lng, tp.service_radius_km, tp.rating, tp.tier, tp.female_patients_only, pr.price_paise
    FROM therapist_profiles tp
    JOIN users u ON u.id = tp.user_id AND u.status = 'active'
    JOIN therapist_prices pr ON pr.therapist_id = tp.user_id AND pr.mode = :mode
    WHERE tp.verification_status = 'verified' AND tp.accepting
      AND NOT EXISTS (SELECT 1 FROM personal_blocks b WHERE (b.blocker_id = u.id AND b.blocked_id = :pid) OR (b.blocker_id = :pid AND b.blocked_id = u.id))
  `, { replacements: { mode, pid: patient.id } });

  const pref = patient.preferredGender ?? 'any';
  const out = [];
  for (const t of rows) {
    if (pref !== 'any' && t.gender !== pref) continue;                       // patient's choice is never broken
    if (t.female_patients_only && patient.gender !== 'female') continue;      // physio's own safety setting
    const rule = genderRule(patient.gender, t.gender, familyPresent);
    if (rule === 'not_allowed') continue;
    let km = null;
    if (mode === 'home') {
      km = distanceKm(address.lat, address.lng, t.home_lat, t.home_lng);
      if (km > Number(t.service_radius_km)) continue;
    }
    const specialityFit = specialisation && t.specialisations.includes(specialisation) ? 1 : 0;
    const score = specialityFit * 3 + Number(t.rating ?? 4) - (km ?? 0) * 0.15 + (t.tier === 'platinum' ? 0.5 : t.tier === 'gold' ? 0.25 : 0);
    out.push({
      id: t.id, name: t.name, gender: t.gender, qualification: t.qualification, yearsExperience: t.years_experience,
      specialisations: t.specialisations, languages: t.languages, rating: t.rating ? Number(t.rating) : null, tier: t.tier,
      distanceKm: km === null ? null : Math.round(km * 10) / 10, pricePaise: t.price_paise,
      requiresFamilyAndConsent: rule === 'needs_family_and_consent', score,
    });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit).map(({ score, ...t }) => t);
}
