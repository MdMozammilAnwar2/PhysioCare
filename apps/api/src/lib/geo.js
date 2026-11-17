import { sequelize } from '../db/index.js';

export function distanceKm(aLat, aLng, bLat, bLng) {
  const R = 6371, rad = x => (x * Math.PI) / 180;
  const dLat = rad(bLat - aLat), dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Drive-time estimate until the Google Maps distance matrix is wired in: 3 min per km in city traffic.
export const travelMinutes = km => Math.ceil(km * 3);

// Nearest zone whose centre-radius contains the point. Returns { id, name, color } or null (= outside service).
export async function zoneForPoint(lat, lng) {
  const [zones] = await sequelize.query(`SELECT id, name, color, center_lat, center_lng, radius_km FROM zones WHERE center_lat IS NOT NULL`);
  let best = null;
  for (const z of zones) {
    const d = distanceKm(lat, lng, z.center_lat, z.center_lng);
    if (d <= Number(z.radius_km) && (!best || d < best.d)) best = { d, id: z.id, name: z.name, color: z.color };
  }
  return best ? { id: best.id, name: best.name, color: best.color } : null;
}
