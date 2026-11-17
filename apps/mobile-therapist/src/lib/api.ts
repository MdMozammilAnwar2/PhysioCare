// API client for the therapist app. Tokens in SecureStore; one automatic refresh on 401.
import * as SecureStore from 'expo-secure-store';

const BASE = `${process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:4000'}/api/v1`;

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: { missing?: string[] }) { super(message); }
}

let access: string | null = null;
export const tokens = {
  async load() { access = await SecureStore.getItemAsync('pt.access'); return Boolean(access); },
  async set(t: { accessToken: string; refreshToken: string }) {
    access = t.accessToken;
    await SecureStore.setItemAsync('pt.access', t.accessToken);
    await SecureStore.setItemAsync('pt.refresh', t.refreshToken);
  },
  async clear() { access = null; await SecureStore.deleteItemAsync('pt.access'); await SecureStore.deleteItemAsync('pt.refresh'); },
};

async function call<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, { ...init, headers: { 'content-type': 'application/json', ...(access ? { authorization: `Bearer ${access}` } : {}) } });
  } catch {
    throw new ApiError(0, 'network', 'No connection. Check your internet and try again.');
  }
  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    const refresh = await SecureStore.getItemAsync('pt.refresh');
    if (refresh) {
      const r = await fetch(`${BASE}/auth/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: refresh }) });
      if (r.ok) { await tokens.set((await r.json()).tokens); return call<T>(path, init, false); }
      await tokens.clear();
    }
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error?.code ?? 'error', body.error?.message ?? 'Something went wrong.', body.error?.details);
  return body as T;
}
const post = <T>(p: string, b?: unknown) => call<T>(p, { method: 'POST', body: JSON.stringify(b ?? {}) });
const put = <T>(p: string, b: unknown) => call<T>(p, { method: 'PUT', body: JSON.stringify(b) });

export type DocType = 'aadhaar_pan' | 'selfie' | 'degree' | 'council_registration' | 'police_verification' | 'bank_proof';
export const DOCS: [DocType, string, string][] = [
  ['aadhaar_pan', 'Aadhaar & PAN', 'Both sides, clear photo'],
  ['selfie', 'Live selfie', 'Your face, good light'],
  ['degree', 'BPT / MPT degree', 'Final or provisional certificate'],
  ['council_registration', 'Council / IAP registration', 'Certificate with number'],
  ['police_verification', 'Police verification', 'Issued in the last 12 months'],
  ['bank_proof', 'Bank account proof', 'Cancelled cheque or passbook page'],
];
export type Profile = {
  profile: null | { qualification: string; years_experience: number; specialisations: string[]; languages: string[]; home_lat: number | null; service_radius_km: string; verification_status: 'applied' | 'under_review' | 'verified' | 'suspended'; review_note: string | null; female_patients_only: boolean };
  documents: { id: string; type: DocType; status: 'pending' | 'approved' | 'rejected'; review_note: string | null }[];
  missingDocuments: DocType[];
  agreement: { version: string; current: boolean } | null;
};
export type Visit = {
  id: string; mode: string; status: string; physio_consent: 'not_needed' | 'pending' | 'accepted' | 'declined'; starts_at: string; ends_at: string;
  family_member: { name: string; relation: string } | null; patient_name: string | null; patient_gender: string | null; line1: string | null; landmark: string | null;
  lat: number | null; lng: number | null; zone_name: string | null; zone_color: string | null; sessions_total: number | null;
  payment_id: string | null; payment_method: string | null; payment_status: string | null; amount_paise: number | null;
};

export const api = {
  status: () => call<Status>('/status'),
  sendOtp: (phone: string) => post('/auth/otp/send', { phone }),
  verifyOtp: async (phone: string, code: string) => {
    const r = await post<{ isNew: boolean; user: { name: string | null }; tokens: { accessToken: string; refreshToken: string } }>('/auth/otp/verify', { phone, code, role: 'therapist' });
    await tokens.set(r.tokens);
    return r;
  },
  me: () => call<{ user: { name: string | null; phone: string } }>('/me'),
  updateMe: (b: object) => call('/me', { method: 'PATCH', body: JSON.stringify(b) }),
  profile: () => call<Profile>('/therapist/profile'),
  saveProfile: (b: object) => put('/therapist/profile', b),
  zones: () => call<{ zones: { id: string; name: string; color: string; lat: number; lng: number }[] }>('/zones?city=Patna'),
  upload: async (file: { uri: string; name: string; type: string }, purpose = 'document') => {
    const fd = new FormData();
    fd.append('purpose', purpose);
    fd.append('file', file as unknown as Blob);
    const res = await fetch(`${BASE}/files`, { method: 'POST', body: fd, headers: access ? { authorization: `Bearer ${access}` } : {} });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, body.error?.code ?? 'error', body.error?.message ?? 'Upload failed.');
    return body.file as { id: string };
  },
  addDocument: (type: DocType, fileId: string) => post('/therapist/documents', { type, fileId }),
  signAgreement: (signedName: string) => post('/therapist/agreement', { version: '2.1', accepted: true, signedName }),
  submit: () => post<{ status: string }>('/therapist/submit'),
  availability: () => call<{ rules: { weekday: number; start: string; end: string; modes: string[] }[] }>('/therapist/availability'),
  saveAvailability: (rules: object[]) => put('/therapist/availability', { rules }),
  savePrices: (prices: object[]) => put('/therapist/prices', { prices }),
  visits: () => call<{ visits: Visit[] }>('/therapist/visits'),
  consent: (id: string, accept: boolean) => post(`/therapist/visits/${id}/consent`, { accept }),
  onTheWay: (id: string) => post(`/therapist/visits/${id}/on-the-way`),
  checkIn: (id: string, code: string, familyPresent?: boolean) => post(`/therapist/visits/${id}/check-in`, { code, familyPresent }),
  nobodyPresent: (id: string) => post(`/therapist/visits/${id}/nobody-present`),
  location: (id: string, lat: number, lng: number) => post(`/therapist/visits/${id}/location`, { lat, lng }),
  complete: (id: string, b: object) => post(`/therapist/visits/${id}/complete`, b),
  sos: (b: { visitId?: string; lat?: number; lng?: number }) => post<{ message: string }>('/therapist/sos', b),
  cashReceived: (paymentId: string) => post(`/therapist/payments/${paymentId}/cash-received`),
  wallet: () => call<Wallet>('/therapist/wallet'),
};

export const rupees = (p: number) => `₹${Math.round(p / 100).toLocaleString('en-IN')}`;
const IST = 330 * 60000;
export function fmtTime(iso: string) {
  const d = new Date(new Date(iso).getTime() + IST);
  const h = d.getUTCHours(), m = d.getUTCMinutes();
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
export function fmtDay(iso: string) {
  const d = new Date(new Date(iso).getTime() + IST);
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()]} ${d.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]}`;
}
export const visitsCache: { list: Visit[] } = { list: [] };
export type Status = { status: string; version: string; maintenance: { enabled: boolean; message: string | null }; minAppVersion: Record<string, string> | null };

export type Wallet = {
  availablePaise: number; heldPaise: number; frozenPaise: number; paidPaise: number; tdsThisYearPaise: number;
  entries: { id: string; gross_paise: number; fee_paise: number; tds_paise: number; net_paise: number; status: string; available_at: string; visit_at: string; patient_name: string | null; payout_reference: string | null }[];
  payouts: { id: string; amount_paise: number; tds_paise: number; status: string; method: string | null; reference: string | null; paid_at: string | null; created_at: string }[];
};
