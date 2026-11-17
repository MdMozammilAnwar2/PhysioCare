// Style A · Clean Blue — the single source of design tokens for web and mobile.
export const colors = {
  brand: '#0A6CFF', // actions, links, active states
  brandDark: '#0757D6',
  navy: '#0A1F44', // text, sidebars, dark buttons
  ink: '#0A1F44',
  sub: '#5B6B86', // secondary text
  muted: '#8090A8',
  line: '#E3E9F3', // borders, separators
  bg: '#F3F6FC', // app canvas
  surface: '#FFFFFF',
  soft: '#E8F0FF', // tinted backgrounds
  violet: '#7B61FF', // accent
  teal: '#14B8A6',
  success: '#10B981',
  successInk: '#047857',
  warning: '#F59E0B',
  warningInk: '#B45309',
  danger: '#F43F5E',
  dangerInk: '#BE123C',
};

export const gradients = {
  hero: 'linear-gradient(155deg, #0A6CFF 0%, #4B8BFF 45%, #A68BFF 100%)',
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
  family: "Manrope, 'Helvetica Neue', Arial, sans-serif",
  weights: { regular: 400, medium: 500, semibold: 600, bold: 700, heavy: 800 },
  sizes: { caption: 12, footnote: 13, body: 15, bodyLg: 17, title3: 20, title2: 24, title1: 28, large: 34, display: 72 },
};

export const radius = { sm: 8, md: 12, lg: 16, xl: 20, xxl: 28, pill: 999 };
export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48 };

export default { colors, gradients, zoneColors, font, radius, space };
