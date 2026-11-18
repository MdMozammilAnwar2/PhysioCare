// Maps: address search and exact location (Google Places + Geocoding), and real drive times (Distance Matrix).
// With MAPS_PROVIDER=none, or if Google fails, drive time falls back to the straight-line estimate.
import { config } from '../config/index.js';
import { sequelize } from '../db/index.js';
import { HttpError } from '../lib/util.js';
import { distanceKm, travelMinutes as estimate } from '../lib/geo.js';

const C = config.maps;
const q = async (sql, replacements) => (await sequelize.query(sql, { replacements }))[0];
const key = (lat, lng) => `${Number(lat).toFixed(3)},${Number(lng).toFixed(3)}`; // ≈100 m cells
export const mapsEnabled = () => C.provider === 'google' && Boolean(C.googleKey);

// Swappable for tests.
export const google = {
  async autocomplete(input, sessionToken) {
    const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST', headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': C.googleKey },
      body: JSON.stringify({ input, sessionToken, includedRegionCodes: [C.region], languageCode: 'en',
        locationBias: { circle: { center: { latitude: C.biasLat, longitude: C.biasLng }, radius: C.biasRadiusM } } }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error?.message ?? `Places ${res.status}`);
    return (body.suggestions ?? []).filter(s => s.placePrediction).map(s => ({ placeId: s.placePrediction.placeId, text: s.placePrediction.text?.text, main: s.placePrediction.structuredFormat?.mainText?.text, secondary: s.placePrediction.structuredFormat?.secondaryText?.text }));
  },
  async place(placeId, sessionToken) {
    const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}${sessionToken ? `?sessionToken=${encodeURIComponent(sessionToken)}` : ''}`, {
      headers: { 'X-Goog-Api-Key': C.googleKey, 'X-Goog-FieldMask': 'id,formattedAddress,location' },
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error?.message ?? `Places ${res.status}`);
    return { placeId: body.id, formatted: body.formattedAddress, lat: body.location.latitude, lng: body.location.longitude };
  },
  async reverse(lat, lng) {
    const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&region=${C.region}&key=${C.googleKey}`);
    const body = await res.json();
    if (body.status !== 'OK') throw new Error(body.error_message ?? body.status);
    return { formatted: body.results[0]?.formatted_address ?? null, placeId: body.results[0]?.place_id ?? null };
  },
  async matrix(origins, dest) {
    const res = await fetch(`https://maps.googleapis.com/maps/api/distancematrix/json?${new URLSearchParams({
      origins: origins.map(o => `${o.lat},${o.lng}`).join('|'), destinations: `${dest.lat},${dest.lng}`, mode: 'driving', departure_time: 'now', region: C.region, key: C.googleKey })}`);
    const body = await res.json();
    if (body.status !== 'OK') throw new Error(body.error_message ?? body.status);
    return body.rows.map(r => r.elements[0]?.status === 'OK' ? { minutes: Math.ceil((r.elements[0].duration_in_traffic ?? r.elements[0].duration).value / 60), meters: r.elements[0].distance.value } : null);
  },
};

export async function searchAddress(input, sessionToken) {
  if (!mapsEnabled()) throw new HttpError(503, 'maps_off', 'Address search isn’t switched on. Drop a pin or type the address.');
  if (String(input).trim().length < 3) return [];
  return google.autocomplete(String(input).trim().slice(0, 120), sessionToken);
}
export async function placeDetails(placeId, sessionToken) {
  if (!mapsEnabled()) throw new HttpError(503, 'maps_off', 'Address search isn’t switched on.');
  return google.place(placeId, sessionToken);
}
export async function reverseGeocode(lat, lng) {
  if (!mapsEnabled()) return { formatted: null, placeId: null };
  return google.reverse(lat, lng).catch(() => ({ formatted: null, placeId: null }));
}

/**
 * Drive minutes from each origin to one destination. Cached by ~100 m cells for MAPS_TRAVEL_CACHE_DAYS.
 * Anything Google can't answer uses the straight-line estimate, so booking never fails because of maps.
 */
export async function travelMinutesMany(origins, dest) {
  const fallback = o => estimate(distanceKm(o.lat, o.lng, dest.lat, dest.lng));
  if (!origins.length) return [];
  if (!mapsEnabled()) return origins.map(fallback);
  const to = key(dest.lat, dest.lng);
  const froms = origins.map(o => key(o.lat, o.lng));
  const cached = await q(`SELECT from_key, minutes FROM travel_cache WHERE to_key = :to AND from_key IN (:f) AND created_at > now() - make_interval(days => :d)`, { to, f: froms, d: C.travelCacheDays });
  const hit = new Map(cached.map(c => [c.from_key, c.minutes]));
  const missing = origins.filter((_, i) => !hit.has(froms[i]));
  if (missing.length) {
    try {
      for (let i = 0; i < missing.length; i += 25) {
        const chunk = missing.slice(i, i + 25);
        const r = await google.matrix(chunk, dest);
        for (const [j, o] of chunk.entries()) {
          if (!r[j]) continue;
          hit.set(key(o.lat, o.lng), r[j].minutes);
          await q(`INSERT INTO travel_cache (from_key, to_key, minutes, meters) VALUES (:f, :t, :m, :x) ON CONFLICT (from_key, to_key) DO UPDATE SET minutes = EXCLUDED.minutes, meters = EXCLUDED.meters, created_at = now()`,
            { f: key(o.lat, o.lng), t: to, m: r[j].minutes, x: r[j].meters });
        }
      }
    } catch (e) { console.warn('[maps] drive time lookup failed, using estimate:', e.message); }
  }
  return origins.map((o, i) => hit.get(froms[i]) ?? fallback(o));
}
