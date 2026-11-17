// The booking in progress, kept in sessionStorage so a refresh doesn't lose it.
export type BookingDraft = {
  mode?: 'home' | 'video';
  addressId?: string;
  zone?: { name: string | null; color: string };
  familyPresent?: boolean;
  therapistId?: string;
  therapistName?: string;
  requiresFamilyAndConsent?: boolean;
  hold?: { visitId: string; amountPaise: number; start: string; holdExpiresAt: string };
};
const KEY = 'pc.booking';
export const draft = {
  get: (): BookingDraft => { try { return JSON.parse(sessionStorage.getItem(KEY) || '{}'); } catch { return {}; } },
  set: (patch: BookingDraft) => sessionStorage.setItem(KEY, JSON.stringify({ ...draft.get(), ...patch })),
  clear: () => sessionStorage.removeItem(KEY),
};

// Referral / campaign info from the landing URL (?ref=ROHIT25&utm_source=...), kept until sign-up.
export function captureAttribution(search: string) {
  const p = new URLSearchParams(search);
  const ref = p.get('ref');
  const utm = Object.fromEntries(['source', 'medium', 'campaign', 'content'].map(k => [k, p.get(`utm_${k}`)]).filter(([, v]) => v));
  if (ref || Object.keys(utm).length) localStorage.setItem('pc.attribution', JSON.stringify({ ref: ref ?? undefined, utm: Object.keys(utm).length ? utm : undefined }));
}
export const pendingAttribution = (): { ref?: string; utm?: Record<string, string> } => { try { return JSON.parse(localStorage.getItem('pc.attribution') || '{}'); } catch { return {}; } };
