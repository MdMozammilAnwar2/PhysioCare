import { colors, font, gradients, radius } from './index.js';

// Tailwind preset so every web app uses the same PhysioCare brand tokens.
export default {
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: colors.brand, dark: colors.brandDark, soft: colors.soft },
        navy: colors.navy,
        ink: colors.ink,
        sub: colors.sub,
        muted: colors.muted,
        line: colors.line,
        canvas: colors.bg,
        violet: colors.violet,
        lavender: { DEFAULT: colors.lavender, light: colors.lavenderLight, dark: colors.lavenderOnDark },
        mist: colors.mist,
        teal: colors.teal,
        success: { DEFAULT: colors.success, ink: colors.successInk },
        warning: { DEFAULT: colors.warning, ink: colors.warningInk },
        danger: { DEFAULT: colors.danger, ink: colors.dangerInk },
      },
      fontFamily: { sans: font.family.split(',').map(s => s.trim().replace(/'/g, '')) },
      borderRadius: { card: `${radius.xl}px`, hero: `${radius.xxl}px` },
      backgroundImage: { hero: gradients.hero },
    },
  },
};
