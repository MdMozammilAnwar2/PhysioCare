// PhysioCare logo (Care Cross in Motion). Wordmark: Plus Jakarta Sans ExtraBold, "Physio" in Ink, "Care" in Indigo.
// variant: full (light backgrounds) · reversed (on indigo) · dark (on ink). Keep it at least 120 px wide; mark alone at least 24 px.
const V = {
  full: { body: '#5146D9', arm: '#8B7FF0', physio: '#1F1A4D', care: '#5146D9', by: '#5E5A7A' },
  reversed: { body: '#FFFFFF', arm: '#C9C3F7', physio: '#FFFFFF', care: '#C9C3F7', by: 'rgba(255,255,255,0.75)' },
  dark: { body: '#A99FF5', arm: '#FFFFFF', physio: '#FFFFFF', care: '#A99FF5', by: 'rgba(255,255,255,0.65)' },
} as const;
type Variant = keyof typeof V;

export function Mark({ size = 32, variant = 'full', title }: { size?: number; variant?: Variant; title?: string }) {
  const c = V[variant];
  return (
    <svg width={size} height={size} viewBox="-2 -2 104 104" role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <circle cx="47" cy="13" r="13" fill={c.body} />
      <path d="M47 43V88M13 61H47" stroke={c.body} strokeWidth="21" strokeLinecap="round" fill="none" />
      <path d="M54 62L87 38" stroke={c.arm} strokeWidth="21" strokeLinecap="round" fill="none" />
    </svg>
  );
}

/** Horizontal lockup. `endorsed` adds "BY HEALTHTROPIC" (website header, documents); leave it off in tight app bars. */
export function Logo({ variant = 'full', height = 36, endorsed = false, suffix }: { variant?: Variant; height?: number; endorsed?: boolean; suffix?: string }) {
  const c = V[variant];
  const word = height * 0.72;
  return (
    <span className="inline-flex items-center select-none" style={{ gap: height * 0.28 }} aria-label={`PhysioCare${endorsed ? ' by Healthtropic' : ''}${suffix ? ` ${suffix}` : ''}`} role="img">
      <Mark size={height} variant={variant} />
      <span className="flex flex-col leading-none" aria-hidden>
        <span style={{ fontSize: word, fontWeight: 800, letterSpacing: '-0.025em', lineHeight: 1 }}>
          <span style={{ color: c.physio }}>Physio</span><span style={{ color: c.care }}>Care</span>
          {suffix && <span style={{ color: c.by, fontWeight: 600, fontSize: word * 0.55, letterSpacing: 0, marginLeft: word * 0.25 }}>{suffix}</span>}
        </span>
        {endorsed && <span style={{ color: c.by, fontSize: Math.max(8, word * 0.22), fontWeight: 600, letterSpacing: '0.25em', marginTop: word * 0.14 }}>BY HEALTHTROPIC</span>}
      </span>
    </span>
  );
}
