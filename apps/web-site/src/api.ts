// API client for the website. Access token in memory/localStorage, refreshed automatically once on 401.
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}

const store = {
  get access() { return localStorage.getItem('pc.access'); },
  get refresh() { return localStorage.getItem('pc.refresh'); },
  set(t: { accessToken: string; refreshToken: string }) { localStorage.setItem('pc.access', t.accessToken); localStorage.setItem('pc.refresh', t.refreshToken); },
  clear() { localStorage.removeItem('pc.access'); localStorage.removeItem('pc.refresh'); },
};
export const isSignedIn = () => Boolean(store.access);

async function raw<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(store.access ? { authorization: `Bearer ${store.access}` } : {}), ...init.headers },
  });
  if (res.status === 401 && retry && store.refresh && !path.startsWith('/auth/')) {
    const r = await fetch('/api/v1/auth/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: store.refresh }) });
    if (r.ok) { store.set((await r.json()).tokens); return raw<T>(path, init, false); }
    store.clear();
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error?.code ?? 'error', body.error?.message ?? 'Something went wrong.', body.error?.details);
  return body as T;
}
const post = <T>(p: string, b?: unknown) => raw<T>(p, { method: 'POST', body: JSON.stringify(b ?? {}) });

export type Zone = { id: string; name: string; color: 'green' | 'blue' | 'yellow' | 'orange' | 'red'; lat?: number; lng?: number };
export type Match = { id: string; name: string; gender: string; qualification: string; yearsExperience: number; specialisations: string[]; languages: string[]; rating: number | null; tier: string; distanceKm: number | null; pricePaise: number; requiresFamilyAndConsent: boolean };
export type Package = { id: string; name: string; mode: string; sessions: number; price_paise: number; validity_days: number };
export type Hold = { visitId: string; planId: string; amountPaise: number; holdExpiresAt: string; needsPhysioConsent: boolean };
export type Payment = { id: string; method: 'cash' | 'upi'; status: 'pending' | 'submitted' | 'paid' | 'rejected'; reference: string; amountPaise: number; upiId?: string; payeeName?: string; upiUri?: string; qrUrl?: string; invoiceNo?: string | null; reviewNote?: string | null };
export type UploadedFile = { id: string; name: string; url: string };
export type Booking = { id: string; plan_id: string | null; rated: boolean; mode: string; status: string; starts_at: string; therapist_name: string; sessions_total: number; plan_status: string; zone_name: string | null; zone_color: string | null; payment_id: string | null; payment_method: string | null; payment_status: string | null; payment_reference: string | null };

export const api = {
  status: () => raw<{ version: string; maintenance: { enabled: boolean; message: string | null } }>('/status'),
  sendOtp: (phone: string) => post<{ resendAfterSeconds: number }>('/auth/otp/send', { phone }),
  verifyOtp: async (phone: string, code: string, extra: { ref?: string; utm?: Record<string, string>; role?: string } = {}) => {
    const r = await post<{ isNew: boolean; user: { id: string; name: string | null }; tokens: { accessToken: string; refreshToken: string } }>('/auth/otp/verify', { phone, code, ...extra });
    store.set(r.tokens);
    return r;
  },
  signOut: async () => { const t = store.refresh; store.clear(); if (t) await post('/auth/logout', { refreshToken: t }).catch(() => undefined); },
  me: () => raw<{ user: { id: string; name: string | null; phone: string } }>('/me'),
  updateMe: (b: { name?: string; gender?: string; birthYear?: number }) => raw('/me', { method: 'PATCH', body: JSON.stringify(b) }),
  saveProfile: (b: Record<string, unknown>) => raw('/patient/profile', { method: 'PUT', body: JSON.stringify(b) }),
  consents: (consents: { document: string; version: string; accepted: boolean }[]) => post('/patient/consents', { consents }),
  zones: () => raw<{ zones: Zone[] }>('/zones?city=Patna'),
  addAddress: (b: { line1: string; landmark?: string; lat: number; lng: number }) => post<{ id: string; zone: Zone & { outsideService?: boolean } }>('/patient/addresses', b),
  match: (b: { mode: string; addressId?: string; familyPresent?: boolean }) => post<{ zone: Zone | null; matches: Match[] }>('/therapists/match', b),
  therapist: (id: string) => raw<{ therapist: { id: string; name: string; packages: Package[]; prices: { mode: string; price_paise: number }[] } }>(`/therapists/${id}`),
  slots: (id: string, q: { mode: string; from: string; days: number; addressId?: string }) =>
    raw<{ slots: string[] }>(`/therapists/${id}/slots?${new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]))}`),
  hold: (b: Record<string, unknown>) => post<Hold>('/bookings/hold', b),
  confirm: (visitId: string, method: 'cash' | 'upi', useCoins = false) => post<{ visitId: string; payment: Payment }>(`/bookings/${visitId}/confirm`, { method, useCoins }),
  payment: (id: string) => raw<{ payment: Payment }>(`/payments/${id}`),
  upiProof: (id: string, b: { utr?: string; fileId?: string }) => post<{ status: string }>(`/payments/${id}/upi-proof`, b),
  // Multipart upload to the permanent file store.
  upload: async (file: File, purpose = 'general') => {
    const fd = new FormData(); fd.append('purpose', purpose); fd.append('file', file);
    const res = await fetch('/api/v1/files', { method: 'POST', body: fd, headers: store.access ? { authorization: `Bearer ${store.access}` } : {} });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, body.error?.code ?? 'error', body.error?.message ?? 'Upload failed.');
    return body.file as UploadedFile;
  },
  // Fetches a protected image (QR, proof) with the token and returns a local object URL for <img>.
  imageUrl: async (path: string) => {
    const res = await fetch(path, { headers: store.access ? { authorization: `Bearer ${store.access}` } : {} });
    if (!res.ok) throw new ApiError(res.status, 'image_failed', 'Couldn’t load the image.');
    return URL.createObjectURL(await res.blob());
  },
  bookings: () => raw<{ bookings: Booking[] }>('/bookings'),
};

// ---------- Phase 3: plans, refunds, problems, ratings, chat ----------
export type Plan = { id: string; status: string; sessions_total: number; price_paise: number; valid_until: string | null; mode: string; therapist_name: string; payment_status: string | null; completed: number };
export type RefundEstimate = { planId: string; paid: boolean; status: string; sessionsTotal: number; used: number; unused: number; amountPaise: number };
export type PatientRefund = { id: string; plan_id: string; amount_paise: number; status: string; reference: string | null; note: string | null; created_at: string };
export type ChatMessage = { id: number; body: string; created_at: string; mine: boolean };
export const trust = {
  plans: () => raw<{ plans: Plan[] }>('/patient/plans'),
  refunds: () => raw<{ refunds: PatientRefund[] }>('/patient/refunds'),
  refundEstimate: (planId: string) => raw<RefundEstimate>(`/patient/plans/${planId}/refund-estimate`),
  requestRefund: (planId: string, refundTo: string) => post<{ refundId: string; amountPaise: number }>(`/patient/plans/${planId}/refund`, { refundTo }),
  report: (b: { visitId: string; category: string; description: string; fileIds?: string[] }) => post('/patient/incidents', b),
  rate: (visitId: string, b: { stars: number; tags?: string[]; comment?: string }) => post(`/patient/visits/${visitId}/rating`, b),
  messages: (planId: string, after = 0) => raw<{ messages: ChatMessage[] }>(`/chat/${planId}/messages?after=${after}`),
  send: (planId: string, body: string) => post<{ id: number }>(`/chat/${planId}/messages`, { body }),
};

// ---------- Phase 4: coins, referral, partner portal ----------
export type CoinWallet = { balance: number; rupeesPaise: number; coinsPerRupee: number; entries: { id: number; delta: number; reason: string; note: string | null; created_at: string }[] };
export type Referral = { code: string; url: string; shareText: string; joined: number; booked: number; referrerCoins: number; welcomeCoins: number; coinsPerRupee: number };
export type PartnerLink = { id: string; code: string; meta: { label?: string }; active: boolean; scans: number; clicks: number; signups: number; paid: number; url: string; qrUrl: string };
export type PartnerMe = { partner: null | { id: string; name: string; type: string; status: string; contact_name: string | null; registration_no: string | null; payout_to: string | null; address: string | null; decision_note: string | null; access: string }; types: string[]; links?: PartnerLink[]; earnedPaise?: number; paidPaise?: number; rewardPaise?: number; rewards?: { id: string; amount_paise: number; status: string; reference: string | null; created_at: string; label: string | null }[] };
export const growth = {
  coins: () => raw<CoinWallet>('/growth/coins'),
  checkout: (amountPaise: number) => raw<{ balance: number; coins: number; discountPaise: number; maxPct: number }>(`/growth/coins/checkout?amountPaise=${amountPaise}`),
  referral: () => raw<Referral>('/growth/referral'),
  partner: () => raw<PartnerMe>('/partner/me'),
  apply: (b: Record<string, string>) => post<{ partnerId: string }>('/partner/apply', b),
  updatePartner: (b: Record<string, string>) => raw('/partner/me', { method: 'PATCH', body: JSON.stringify(b) }),
  addLink: (label: string) => post<{ link: PartnerLink }>('/partner/links', { label }),
};

export const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

