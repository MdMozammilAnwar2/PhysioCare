// Admin console API client. Console sessions live in sessionStorage (end with the tab); one refresh on 401.
export type Status = { status: string; version: string; services: Record<string, string>; maintenance: { enabled: boolean; message: string | null } };
export type User = { id: string; phone: string; name: string | null; roles: string[]; primaryRole: string };

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}

const S = {
  get access() { return sessionStorage.getItem('pc.access'); },
  get refresh() { return sessionStorage.getItem('pc.refresh'); },
  set(t: { accessToken: string; refreshToken: string }) { sessionStorage.setItem('pc.access', t.accessToken); sessionStorage.setItem('pc.refresh', t.refreshToken); },
  clear() { sessionStorage.removeItem('pc.access'); sessionStorage.removeItem('pc.refresh'); },
};
export const hasSession = () => Boolean(S.access);
const authHeader = (): Record<string, string> => (S.access ? { authorization: `Bearer ${S.access}` } : {});

async function call<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const res = await fetch(`/api/v1${path}`, { ...init, headers: { 'content-type': 'application/json', ...authHeader(), ...init.headers } });
  if (res.status === 401 && retry && S.refresh && !path.startsWith('/auth/')) {
    const r = await fetch('/api/v1/auth/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: S.refresh }) });
    if (r.ok) { S.set((await r.json()).tokens); return call<T>(path, init, false); }
    S.clear();
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error?.code ?? 'error', body.error?.message ?? 'Something went wrong.', body.error?.details);
  return body as T;
}
const post = <T>(p: string, b?: unknown) => call<T>(p, { method: 'POST', body: JSON.stringify(b ?? {}) });

export type QueueRow = { id: string; name: string | null; phone: string; gender: string | null; qualification: string | null; years_experience: number | null; specialisations: string[]; submitted_at: string | null; docs_approved: number };
export type Doc = { id: string; type: string; status: 'pending' | 'approved' | 'rejected'; review_note: string | null; file_id: string; mime_type: string; original_name: string; created_at: string };
export type PaymentRow = { id: string; method: 'cash' | 'upi'; status: string; reference: string; amount_paise: number; utr: string | null; proof_file_id: string | null; submitted_at: string | null; patient_name: string | null; therapist_name: string | null };
export type LiveVisit = { id: string; status: string; starts_at: string; ends_at: string; checked_in_at: string | null; therapist_name: string; zone_name: string | null; zone_color: string | null; overrun: boolean; lat: number | null; lng: number | null; location_at: string | null };
export type Sos = { id: string; status: 'open' | 'acknowledged'; lat: number | null; lng: number | null; created_at: string; visit_id: string | null; raised_by_name: string | null; raised_by_phone: string };

export const api = {
  status: () => call<Status>('/status'),
  sendOtp: (phone: string) => post('/auth/otp/send', { phone }),
  verifyOtp: async (phone: string, code: string) => {
    const r = await post<{ user: User; tokens: { accessToken: string; refreshToken: string } }>('/auth/otp/verify', { phone, code });
    S.set(r.tokens);
    return r.user;
  },
  me: () => call<{ user: User }>('/me').then(r => r.user),
  logout: async () => { const t = S.refresh; S.clear(); if (t) await post('/auth/logout', { refreshToken: t }).catch(() => undefined); },

  verificationQueue: (status = 'under_review') => call<{ therapists: QueueRow[]; requiredDocuments: number }>(`/admin/verification?status=${status}`),
  therapist: (id: string) => call<{ therapist: Record<string, unknown> & { id: string; name: string | null; phone: string; gender: string | null; verification_status: string; specialisations: string[]; languages: string[]; service_radius_km: string; qualification: string; years_experience: number; bio: string | null }; documents: Doc[]; agreement: { version: string; created_at: string; meta: { signedName?: string } } | null; requiredDocuments: string[] }>(`/admin/therapists/${id}`),
  reviewDocument: (id: string, approve: boolean, note?: string) => post(`/admin/documents/${id}/review`, { approve, note }),
  verifyTherapist: (id: string, approve: boolean, note?: string) => post(`/admin/therapists/${id}/verify`, { approve, note }),

  payments: (status = 'submitted') => call<{ payments: PaymentRow[] }>(`/admin/payments?status=${status}`),
  reviewPayment: (id: string, approve: boolean, note?: string) => post<{ status: string; invoiceNo: string | null }>(`/admin/payments/${id}/review`, { approve, note }),

  live: () => call<{ sos: Sos[]; visits: LiveVisit[] }>('/admin/live-visits'),
  ackSos: (id: string) => post(`/admin/sos/${id}/acknowledge`),
  resolveSos: (id: string, note: string) => post(`/admin/sos/${id}/resolve`, { note }),

  // Protected file → local object URL for <img>/<iframe>. Caller should revoke when done.
  fileUrl: async (fileId: string) => {
    const res = await fetch(`/api/v1/files/${fileId}/content`, { headers: authHeader() });
    if (!res.ok) throw new ApiError(res.status, 'file_failed', 'Couldn’t open the file.');
    return URL.createObjectURL(await res.blob());
  },
};

export const rupees = (p: number) => `₹${Math.round(p / 100).toLocaleString('en-IN')}`;
export const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—');
export const DOC_LABEL: Record<string, string> = { aadhaar_pan: 'Aadhaar & PAN', selfie: 'Live selfie', degree: 'BPT / MPT degree', council_registration: 'Council registration', police_verification: 'Police verification', bank_proof: 'Bank account proof' };

// ---------- Phase 3: money and trust ----------
export type Incident = { id: string; category: string; severity: 'low' | 'medium' | 'critical'; description: string; file_ids: string[]; status: string; decision_note: string | null; created_at: string; visit_at: string; patient_name: string | null; therapist_name: string | null };
export type Refund = { id: string; amount_paise: number; reason: string; status: string; refund_to: string | null; reference: string | null; note: string | null; created_at: string; patient_name: string | null; patient_phone: string };
export type Payout = { id: string; amount_paise: number; tds_paise: number; status: string; method: string | null; reference: string | null; paid_at: string | null; created_at: string; therapist_name: string | null; therapist_phone: string; sessions: number };
export type MoneyRules = { platformFeePct: number; tdsPct: number; holdDays: number; minPayoutPaise: number; reportWindowDays: number };
export const money = {
  incidents: (status = 'open') => call<{ incidents: Incident[] }>(`/admin/money/incidents?status=${status}`),
  decideIncident: (id: string, b: { uphold: boolean; note: string; refundPaise?: number }) => post(`/admin/money/incidents/${id}/decide`, b),
  refunds: (status = 'requested') => call<{ refunds: Refund[] }>(`/admin/money/refunds?status=${status}`),
  decideRefund: (id: string, approve: boolean, note?: string) => post(`/admin/money/refunds/${id}/decide`, { approve, note }),
  refundPaid: (id: string, reference: string) => post(`/admin/money/refunds/${id}/paid`, { reference }),
  buildBatch: () => post<{ batchId: string; payees: number }>('/admin/money/payout-batches'),
  payouts: (status = 'pending') => call<{ payouts: Payout[] }>(`/admin/money/payouts?status=${status}`),
  payoutPaid: (id: string, method: 'bank' | 'upi', reference: string) => post(`/admin/money/payouts/${id}/paid`, { method, reference }),
  tds: (from: string, to: string) => call<{ from: string; to: string; rows: { id: string; name: string | null; phone: string; gross_paise: number; fee_paise: number; tds_paise: number; net_paise: number; sessions: number }[] }>(`/admin/money/tds?from=${from}&to=${to}`),
  rules: () => call<{ rules: MoneyRules }>('/admin/money/money-rules'),
  saveRules: (r: MoneyRules) => call<{ rules: MoneyRules }>('/admin/money/money-rules', { method: 'PUT', body: JSON.stringify(r) }),
};
