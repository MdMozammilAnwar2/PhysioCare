// PhysioCare brand (Care Cross in Motion) — the single source of design tokens for web and mobile.
// Indigo #5146D9 primary · Lavender #8B7FF0 motion arm · Ink #1F1A4D wordmark · Mist #EFEDFD backgrounds.
export const colors = {
  brand: '#5146D9', // actions, links, active states
  brandDark: '#4038B8',
  navy: '#1F1A4D', // text, sidebars, dark buttons
  ink: '#1F1A4D',
  sub: '#5E5A7A', // secondary text
  muted: '#8C88A6',
  line: '#E4E1F5', // borders, separators
  bg: '#F7F6FC', // app canvas
  surface: '#FFFFFF',
  soft: '#EFEDFD', // tinted backgrounds
  violet: '#8B7FF0', // lavender accent (motion arm)
  lavender: '#8B7FF0',
  lavenderLight: '#C9C3F7', // motion arm on indigo
  lavenderOnDark: '#A99FF5', // mark on ink
  mist: '#EFEDFD',
  teal: '#14B8A6',
  success: '#10B981',
  successInk: '#047857',
  warning: '#F59E0B',
  warningInk: '#B45309',
  danger: '#F43F5E',
  dangerInk: '#BE123C',
};

export const gradients = {
  hero: 'linear-gradient(155deg, #5146D9 0%, #6A5FE6 50%, #8B7FF0 100%)',
};

// Zone colours mean service status; they must always be shown with a label.
export const zoneColors = {
  green: { color: '#10B981', label: 'Live' },
  blue: { color: '#38BDF8', label: 'Launching' },
  yellow: { color: '#FACC15', label: 'Limited supply' },
  orange: { color: '#F97316', label: 'Restricted' },
  red: { color: '#F43F5E', label: 'Blocked' },
};

export const font = {
  family: "'Plus Jakarta Sans', 'Helvetica Neue', Arial, sans-serif",
  weights: { regular: 400, medium: 500, semibold: 600, bold: 700, heavy: 800 },
  sizes: { caption: 12, footnote: 13, body: 15, bodyLg: 17, title3: 20, title2: 24, title1: 28, large: 34, display: 72 },
};

export const radius = { sm: 8, md: 12, lg: 16, xl: 20, xxl: 28, pill: 999 };
export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48 };

export default { colors, gradients, zoneColors, font, radius, space };
