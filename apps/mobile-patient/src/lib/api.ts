// API client for the patient app. Tokens in SecureStore; one automatic refresh on 401.
import * as SecureStore from 'expo-secure-store';

const BASE = `${process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:4000'}/api/v1`;

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

let access: string | null = null;
export const tokens = {
  async load() { access = await SecureStore.getItemAsync('pc.access'); return Boolean(access); },
  async set(t: { accessToken: string; refreshToken: string }) {
    access = t.accessToken;
    await SecureStore.setItemAsync('pc.access', t.accessToken);
    await SecureStore.setItemAsync('pc.refresh', t.refreshToken);
  },
  async clear() { access = null; await SecureStore.deleteItemAsync('pc.access'); await SecureStore.deleteItemAsync('pc.refresh'); },
};

async function call<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, { ...init, headers: { 'content-type': 'application/json', ...(access ? { authorization: `Bearer ${access}` } : {}) } });
  } catch {
    throw new ApiError(0, 'network', 'No connection. Check your internet and try again.');
  }
  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    const refresh = await SecureStore.getItemAsync('pc.refresh');
    if (refresh) {
      const r = await fetch(`${BASE}/auth/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: refresh }) });
      if (r.ok) { await tokens.set((await r.json()).tokens); return call<T>(path, init, false); }
      await tokens.clear();
    }
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error?.code ?? 'error', body.error?.message ?? 'Something went wrong.');
  return body as T;
}
const post = <T>(p: string, b?: unknown) => call<T>(p, { method: 'POST', body: JSON.stringify(b ?? {}) });

export type Zone = { id: string; name: string; color: string; lat?: number; lng?: number };
export type Match = { id: string; name: string; qualification: string; yearsExperience: number; rating: number | null; distanceKm: number | null; pricePaise: number; requiresFamilyAndConsent: boolean };
export type Payment = { id: string; method: 'cash' | 'upi'; status: 'pending' | 'submitted' | 'paid' | 'rejected'; reference: string; amountPaise: number; upiId?: string; payeeName?: string; upiUri?: string; qrUrl?: string; invoiceNo?: string | null; reviewNote?: string | null };
export type Status = { status: string; version: string; maintenance: { enabled: boolean; message: string | null }; minAppVersion: Record<string, string> | null };

export const api = {
  status: () => call<Status>('/status'),
  sendOtp: (phone: string) => post<{ devCode?: string }>('/auth/otp/send', { phone }), // devCode only in local development
  verifyOtp: async (phone: string, code: string, ref?: string) => {
    const r = await post<{ isNew: boolean; user: { name: string | null }; tokens: { accessToken: string; refreshToken: string } }>('/auth/otp/verify', { phone, code, ref });
    await tokens.set(r.tokens);
    return r;
  },
  me: () => call<{ user: { name: string | null; phone: string } }>('/me'),
  updateMe: (b: object) => call('/me', { method: 'PATCH', body: JSON.stringify(b) }),
  saveProfile: (b: object) => call('/patient/profile', { method: 'PUT', body: JSON.stringify(b) }),
  consents: (consents: object[]) => post('/patient/consents', { consents }),
  zones: () => call<{ zones: Zone[] }>('/zones?city=Patna'),
  addAddress: (b: object) => post<{ id: string; zone: Zone }>('/patient/addresses', b),
  match: (b: object) => post<{ matches: Match[] }>('/therapists/match', b),
  therapist: (id: string) => call<{ therapist: { packages: { id: string; name: string; mode: string; sessions: number; price_paise: number }[]; prices: { mode: string; price_paise: number }[] } }>(`/therapists/${id}`),
  slots: (id: string, q: Record<string, string>) => call<{ slots: string[] }>(`/therapists/${id}/slots?${new URLSearchParams(q)}`),
  hold: (b: object) => post<{ visitId: string; amountPaise: number; holdExpiresAt: string }>('/bookings/hold', b),
  confirm: (visitId: string, method: 'cash' | 'upi', useCoins = false) => post<{ payment: Payment }>(`/bookings/${visitId}/confirm`, { method, useCoins }),
  // Phase 4: coins and referral.
  coins: () => call<{ balance: number; rupeesPaise: number; entries: { id: number; delta: number; reason: string; note: string | null; created_at: string }[] }>('/growth/coins'),
  coinCheckout: (amountPaise: number) => call<{ coins: number; discountPaise: number; maxPct: number }>(`/growth/coins/checkout?amountPaise=${amountPaise}`),
  referral: () => call<{ code: string; url: string; shareText: string; joined: number; booked: number; referrerCoins: number; welcomeCoins: number }>('/growth/referral'),
  payment: (id: string) => call<{ payment: Payment }>(`/payments/${id}`),
  upiProof: (id: string, b: { utr?: string; fileId?: string }) => post<{ status: string }>(`/payments/${id}/upi-proof`, b),
  // Multipart upload to the permanent file store. React Native's FormData takes { uri, name, type }.
  upload: async (file: { uri: string; name: string; type: string }, purpose = 'general') => {
    const fd = new FormData();
    fd.append('purpose', purpose);
    fd.append('file', file as unknown as Blob);
    const res = await fetch(`${BASE}/files`, { method: 'POST', body: fd, headers: access ? { authorization: `Bearer ${access}` } : {} });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, body.error?.code ?? 'error', body.error?.message ?? 'Upload failed.');
    return body.file as { id: string; url: string };
  },
  // Image source for protected images (QR code): <Image source={api.imageSource(path)} />.
  imageSource: (path: string) => ({ uri: `${BASE.replace(/\/api\/v1$/, '')}${path}`, headers: access ? { Authorization: `Bearer ${access}` } : undefined }),

  // Phase 7: video and calendar.
  video: (visitId: string) => call<{ url: string }>(`/video/${visitId}`),
  calendar: () => call<{ feedUrl: string }>('/calendar/me'),
  // Phase 5: grievances.
  grievanceOfficer: () => call<{ officer: { name: string; designation: string; email: string | null; phone: string | null; address: string; hours: string; ackHours: number; resolveDays: number } }>('/public/grievance-officer'),
  myGrievances: () => call<{ grievances: { id: string; ticket_no: string; status: string; resolution: string | null }[] }>('/grievances'),
  fileGrievance: (b: { category: string; description: string }) => post<{ grievance: { id: string; ticket_no: string } }>('/grievances', b),
  // Phase 3: plans, refunds, problems, ratings, chat.
  plans: () => call<{ plans: { id: string; status: string; sessions_total: number; price_paise: number; valid_until: string | null; mode: string; therapist_name: string; payment_status: string | null; completed: number }[] }>('/patient/plans'),
  refunds: () => call<{ refunds: { id: string; plan_id: string; amount_paise: number; status: string; note: string | null }[] }>('/patient/refunds'),
  refundEstimate: (planId: string) => call<{ planId: string; unused: number; amountPaise: number }>(`/patient/plans/${planId}/refund-estimate`),
  requestRefund: (planId: string, refundTo: string) => post(`/patient/plans/${planId}/refund`, { refundTo }),
  report: (b: { visitId: string; category: string; description: string; fileIds?: string[] }) => post('/patient/incidents', b),
  rate: (visitId: string, b: { stars: number; tags?: string[]; comment?: string }) => post(`/patient/visits/${visitId}/rating`, b),
  messages: (planId: string, after = 0) => call<{ messages: { id: number; body: string; created_at: string; mine: boolean }[] }>(`/chat/${planId}/messages?after=${after}`),
  send: (planId: string, body: string) => post<{ id: number }>(`/chat/${planId}/messages`, { body }),

  bookings: () => call<{ bookings: { id: string; plan_id: string | null; rated: boolean; status: string; starts_at: string; therapist_name: string; mode: string; sessions_total: number; zone_name: string | null; payment_id: string | null; payment_method: string | null; payment_status: string | null }[] }>('/bookings'),
};

export const rupees = (p: number) => `₹${Math.round(p / 100).toLocaleString('en-IN')}`;
const IST = 330 * 60000;
export const istYmd = (d: Date) => new Date(d.getTime() + IST).toISOString().slice(0, 10);
export function fmtTime(iso: string) {
  const d = new Date(new Date(iso).getTime() + IST);
  const h = d.getUTCHours(), m = d.getUTCMinutes();
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
export function fmtDay(iso: string) {
  const d = new Date(new Date(iso).getTime() + IST);
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()]} ${d.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]}`;
}

// Booking in progress (in memory; the flow is short).
export const draft: { mode?: 'home' | 'video'; addressId?: string; zone?: Zone; therapistId?: string; therapistName?: string; requiresConsent?: boolean; family?: boolean; hold?: { visitId: string; start: string; amountPaise: number } } = {};
