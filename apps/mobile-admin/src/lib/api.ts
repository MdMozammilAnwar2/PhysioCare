// API client for the PhysioCare Admin app (staff). Tokens in SecureStore; one automatic refresh on 401.
import * as SecureStore from 'expo-secure-store';

const BASE = `${process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:4000'}/api/v1`;

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

let access: string | null = null;
export const tokens = {
  async load() { access = await SecureStore.getItemAsync('pa.access'); return Boolean(access); },
  async set(t: { accessToken: string; refreshToken: string }) {
    access = t.accessToken;
    await SecureStore.setItemAsync('pa.access', t.accessToken);
    await SecureStore.setItemAsync('pa.refresh', t.refreshToken);
  },
  async clear() { access = null; await SecureStore.deleteItemAsync('pa.access'); await SecureStore.deleteItemAsync('pa.refresh'); },
};

async function call<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, { ...init, headers: { 'content-type': 'application/json', ...(access ? { authorization: `Bearer ${access}` } : {}) } });
  } catch {
    throw new ApiError(0, 'network', 'No connection. Check your internet and try again.');
  }
  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    const refresh = await SecureStore.getItemAsync('pa.refresh');
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

export type Status = { status: string; version: string; maintenance: { enabled: boolean; message: string | null }; minAppVersion: Record<string, string> | null };
export type User = { id: string; name: string | null; phone: string; roles: string[]; primaryRole: string };
export type Dashboard = {
  today: { visits: number; completed: number; live: number; lost: number };
  queues: { sos: number; verifications: number; payments: number; incidents: number; refunds: number; partners: number; grievances: number; grievances_overdue: number; blocked: number };
  growth: { signups_today: number; signups_7d: number; first_paid_7d: number; physios_verified: number; partners_active: number };
  money: { collected_7d: number; collected_30d: number; outstanding: number; payouts_due: number; refunds_due: number; partner_rewards_due: number };
};
export type Sos = { id: string; status: 'open' | 'acknowledged'; lat: number | null; lng: number | null; created_at: string; visit_id: string | null; raised_by_name: string | null; raised_by_phone: string };
export type LiveVisit = { id: string; status: string; starts_at: string; therapist_name: string; zone_name: string | null; overrun: boolean; lat: number | null; lng: number | null };
export type Payment = { id: string; method: 'cash' | 'upi'; reference: string; amount_paise: number; utr: string | null; submitted_at: string | null; patient_name: string | null; therapist_name: string | null };
export type Partner = { id: string; name: string; type: string; contact_name: string | null; phone: string | null; created_at: string };
export type Refund = { id: string; amount_paise: number; reason: string; patient_name: string | null; patient_phone: string; created_at: string };

export const api = {
  status: () => call<Status>('/status'),
  sendOtp: (phone: string) => post<{ devCode?: string }>('/auth/otp/send', { phone }), // devCode only in local development
  verifyOtp: async (phone: string, code: string) => {
    const r = await post<{ user: User; tokens: { accessToken: string; refreshToken: string } }>('/auth/otp/verify', { phone, code });
    await tokens.set(r.tokens);
    return r.user;
  },
  me: () => call<{ user: User }>('/me').then(r => r.user),
  logout: async () => { const t = await SecureStore.getItemAsync('pa.refresh'); await tokens.clear(); if (t) await post('/auth/logout', { refreshToken: t }).catch(() => undefined); },
  registerDevice: (b: { pushToken: string; platform: 'android' | 'ios'; app: string; appVersion?: string }) => post('/devices', b),

  dashboard: () => call<Dashboard>('/admin/control/dashboard'),
  live: () => call<{ sos: Sos[]; visits: LiveVisit[] }>('/admin/live-visits'),
  ackSos: (id: string) => post(`/admin/sos/${id}/acknowledge`),
  resolveSos: (id: string, note: string) => post(`/admin/sos/${id}/resolve`, { note }),
  payments: () => call<{ payments: Payment[] }>('/admin/payments?status=submitted'),
  reviewPayment: (id: string, approve: boolean, note?: string) => post(`/admin/payments/${id}/review`, { approve, note }),
  partners: () => call<{ partners: Partner[] }>('/admin/growth/partners?status=pending'),
  decidePartner: (id: string, approve: boolean, note?: string) => post(`/admin/growth/partners/${id}/decide`, { approve, note }),
  refunds: () => call<{ refunds: Refund[] }>('/admin/money/refunds?status=requested'),
  decideRefund: (id: string, approve: boolean, note?: string) => post(`/admin/money/refunds/${id}/decide`, { approve, note }),
};

export const STAFF = ['ops_admin', 'finance', 'city_coordinator', 'grievance_committee', 'super_admin'];
export const rupees = (p: number) => `₹${Math.round(p / 100).toLocaleString('en-IN')}`;
const IST = 330 * 60000;
export function fmtWhen(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(new Date(iso).getTime() + IST);
  const h = d.getUTCHours(), m = d.getUTCMinutes();
  return `${d.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]}, ${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
