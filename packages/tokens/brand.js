// PhysioCare logo: "Care Cross in Motion" — a health cross that is also a person raising an arm in a stretch.
// The mark is drawn on a 100 × 100 grid; strokes are round-capped pills.
// Versions (from the brand guide): full colour (on white), reversed (on indigo), on dark (ink), one colour.

export const BRAND = {
  name: 'PhysioCare',
  endorsement: 'by Healthtropic',
  full: 'PhysioCare by Healthtropic',
  colors: { indigo: '#5146D9', lavender: '#8B7FF0', ink: '#1F1A4D', mist: '#EFEDFD', lavenderLight: '#C9C3F7', lavenderOnDark: '#A99FF5', white: '#FFFFFF' },
  font: 'Plus Jakarta Sans',
};

const C = BRAND.colors;
export const MARK_VARIANTS = {
  full: { body: C.indigo, arm: C.lavender },          // white and light backgrounds
  reversed: { body: C.white, arm: C.lavenderLight },  // on brand indigo
  dark: { body: C.lavenderOnDark, arm: C.white },     // dark mode, night screens, partner app
  mono: { body: C.ink, arm: C.ink },                  // print, stamps
  monoWhite: { body: C.white, arm: C.white },         // Android monochrome icon
};

/** The mark's shapes, for embedding. `thick` thickens strokes for favicons (16–32 px). */
export function markShapes({ body, arm }, { thick = false } = {}) {
  const w = thick ? 25 : 21;
  return [
    `<circle cx="47" cy="13" r="${thick ? 14 : 13}" fill="${body}"/>`,
    `<path d="M47 43V88" stroke="${body}" stroke-width="${w}" stroke-linecap="round" fill="none"/>`,
    `<path d="M13 61H47" stroke="${body}" stroke-width="${w}" stroke-linecap="round" fill="none"/>`,
    `<path d="M54 62L87 38" stroke="${arm}" stroke-width="${w}" stroke-linecap="round" fill="none"/>`,
  ].join('');
}

/** Mark alone, transparent background. */
export function markSvg(variant = 'full', opts = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 104 104">${markShapes(MARK_VARIANTS[variant], opts)}</svg>`;
}

/**
 * App icon: square tile with the mark centred.
 * shape: 'square' (full bleed, iOS / store), 'rounded' (favicon tile), 'none' (transparent, Android adaptive foreground).
 * scale: share of the tile the mark fills (Android adaptive keeps it inside the 66% safe zone).
 */
export function iconSvg({ size = 1024, bg = C.indigo, variant = 'reversed', shape = 'square', scale = 0.56, thick = false } = {}) {
  const s = size, m = s * scale, off = (s - m) / 2, k = m / 100;
  const tile = shape === 'none' ? '' : `<rect width="${s}" height="${s}" rx="${shape === 'rounded' ? s * 0.22 : 0}" fill="${bg}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">${tile}<g transform="translate(${off + 1.5 * k} ${off}) scale(${k})">${markShapes(MARK_VARIANTS[variant], { thick })}</g></svg>`;
}

export default BRAND;
