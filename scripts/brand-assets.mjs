// Generates every logo and icon file from packages/tokens/brand.js. Run: npm run brand
// Website/console favicons, patient and physio app icons (iOS, Android adaptive + monochrome), splash and web icons.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { BRAND, iconSvg, markSvg } from '../packages/tokens/brand.js';

const C = BRAND.colors;
const out = (path, data) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, data); console.log('  ', path); };
const png = (svg, width) => new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng();

// Shared SVG marks (used by docs, print and the web apps)
for (const v of ['full', 'reversed', 'dark', 'mono']) out(`packages/tokens/assets/mark-${v}.svg`, markSvg(v));

// Web: website and console favicons (thick strokes, one tile colour), touch icon, PWA icons.
for (const app of ['web-site', 'web-admin']) {
  const base = `apps/${app}/public`;
  const tile = s => iconSvg({ size: s, shape: 'rounded', scale: 0.66, thick: s <= 64 });
  out(`${base}/favicon.svg`, tile(64));
  out(`${base}/favicon-32.png`, png(tile(32), 32));
  out(`${base}/favicon-16.png`, png(tile(16), 16));
  out(`${base}/apple-touch-icon.png`, png(iconSvg({ size: 180, scale: 0.56 }), 180));
  out(`${base}/icon-192.png`, png(iconSvg({ size: 192, shape: 'rounded', scale: 0.58 }), 192));
  out(`${base}/icon-512.png`, png(iconSvg({ size: 512, shape: 'rounded', scale: 0.58 }), 512));
  out(`${base}/mark.svg`, markSvg('full'));
  out(`${base}/mark-reversed.svg`, markSvg('reversed'));
}

// Mobile: patient app on Indigo, physio (partner) app on Ink so the two are easy to tell apart.
const apps = {
  'mobile-patient': { bg: C.indigo, variant: 'reversed', splash: 'full' },   // splash on white
  'mobile-therapist': { bg: C.ink, variant: 'dark', splash: 'dark' },        // splash on ink
  'mobile-admin': { bg: C.white, variant: 'full', splash: 'full' },          // staff app: white tile, full-colour mark
};
for (const [app, { bg, variant, splash }] of Object.entries(apps)) {
  const a = `apps/${app}/assets`;
  out(`${a}/icon.png`, png(iconSvg({ size: 1024, bg, variant, scale: 0.56 }), 1024));
  // Android adaptive: transparent foreground with the mark inside the 66% safe zone; background is a solid colour.
  out(`${a}/android-icon-foreground.png`, png(iconSvg({ size: 1024, variant, shape: 'none', scale: 0.42 }), 1024));
  out(`${a}/android-icon-background.png`, png(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="${bg}"/></svg>`, 1024));
  out(`${a}/android-icon-monochrome.png`, png(iconSvg({ size: 1024, variant: 'monoWhite', shape: 'none', scale: 0.42 }), 1024));
  // Splash: the mark on the app's base colour.
  out(`${a}/splash-icon.png`, png(iconSvg({ size: 1024, variant: splash, shape: 'none', scale: 0.7 }), 1024));
  // In-app logo marks (the apps have no SVG renderer): full colour, reversed (on indigo), dark (on ink).
  for (const v of ['full', 'reversed', 'dark']) out(`${a}/mark-${v}.png`, png(iconSvg({ size: 192, variant: v, shape: 'none', scale: 0.96 }), 192));
  // Android status-bar notification icon: white on transparent (Android tints it).
  out(`${a}/notification-icon.png`, png(iconSvg({ size: 96, variant: 'monoWhite', shape: 'none', scale: 0.84, thick: true }), 96));
  out(`${a}/favicon.png`, png(iconSvg({ size: 48, bg, variant, shape: 'rounded', scale: 0.66, thick: true }), 48));
}
console.log('Brand assets generated.');
