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

// ---------- Phase 4: growth ----------
export type PartnerRow = { id: string; name: string; type: string; status: string; contact_name: string | null; phone: string | null; registration_no: string | null; created_at: string; signups: number; paid: number; due_paise: number };
export type PartnerLink = { id: string; code: string; meta: { label?: string }; active: boolean; scans: number; clicks: number; signups: number; paid: number; url: string; qrUrl: string };
export type PartnerReward = { id: string; amount_paise: number; status: string; reference: string | null; paid_at: string | null; created_at: string; label: string | null };
export type GrowthRules = { welcomeCoins: number; referrerCoins: number; maxCoinPct: number; partnerRewardPaise: number };
export type Attribution = {
  from: string; to: string;
  bySource: { source: string; signups: number; paid: number; flagged: number }[];
  partners: { id: string; name: string; type: string; signups: number; paid: number; reward_paise: number }[];
  referrers: { id: string; name: string | null; phone: string; signups: number; paid: number }[];
  coins: { issued: number; redeemed: number };
};
export const growth = {
  partners: (status = 'pending') => call<{ partners: PartnerRow[] }>(`/admin/growth/partners?status=${status}`),
  partner: (id: string) => call<{ partner: Record<string, string | number | null> & { id: string; name: string; type: string; status: string; reward_paise: number | null }; links: PartnerLink[]; earnedPaise: number; paidPaise: number; rewards: PartnerReward[]; defaultRewardPaise: number }>(`/admin/growth/partners/${id}`),
  createPartner: (b: Record<string, unknown>) => post<{ partnerId: string; code: string }>('/admin/growth/partners', b),
  decide: (id: string, b: { approve: boolean; note?: string; rewardPaise?: number }) => post(`/admin/growth/partners/${id}/decide`, b),
  payRewards: (id: string, reference: string) => post<{ count: number; totalPaise: number }>(`/admin/growth/partners/${id}/rewards/paid`, { reference }),
  attribution: (from: string, to: string) => call<Attribution>(`/admin/growth/attribution?from=${from}&to=${to}`),
  rules: () => call<{ rules: GrowthRules; coinsPerRupee: number }>('/admin/growth/rules'),
  saveRules: (r: GrowthRules) => call<{ rules: GrowthRules }>('/admin/growth/rules', { method: 'PUT', body: JSON.stringify(r) }),
  adjustCoins: (phone: string, delta: number, note: string) => post('/admin/growth/coins/adjust', { phone, delta, note }),
};
export const PARTNER_TYPE_LABEL: Record<string, string> = { doctor: 'Doctor', hospital: 'Hospital', clinic: 'Clinic', pathology_lab: 'Pathology lab', physiotherapist: 'Physiotherapist', pharmacy: 'Pharmacy', gym: 'Gym', other: 'Other' };

// ---------- Phase 5: control ----------
export type Dashboard = {
  today: { visits: number; completed: number; live: number; lost: number };
  queues: { sos: number; verifications: number; payments: number; incidents: number; refunds: number; partners: number; grievances: number; grievances_overdue: number; blocked: number };
  growth: { signups_today: number; signups_7d: number; first_paid_7d: number; physios_verified: number; partners_active: number };
  money: { collected_7d: number; collected_30d: number; outstanding: number; payouts_due: number; refunds_due: number; partner_rewards_due: number };
  trend: { day: string; completed: number; collected: number }[];
};
export type UserRow = { id: string; name: string | null; phone: string; gender: string | null; status: string; created_at: string; last_login_at: string | null; roles: string[]; block: { reason: string; note: string; endsAt: string | null; at: string } | null };
export type BlockRow = { id: string; user_id: string; name: string | null; phone: string; reason_code: string; note: string; ends_at: string | null; until_review: boolean; created_at: string; lifted_at: string | null; lift_note: string | null; blocked_by_name: string | null; roles: string[] };
export type Zone = { id: string; name: string; color: string; reason: string | null; review_on: string | null; center_lat: number | null; center_lng: number | null; radius_km: number | null; updated_at: string; city: string; city_id: string; upcoming: number };
export type GrievanceRow = { id: string; ticket_no: string; category: string; status: string; committee: boolean; created_at: string; ack_due_at: string; resolve_due_at: string; acknowledged_at: string | null; resolved_at: string | null; complainant_name: string | null; against_name: string | null; assigned_name: string | null; overdue: boolean };
export type Scheduling = { visitMinutes: { home: number; video: number; clinic: number }; travelBufferMinutes: number; bookingWindowDays: number; minNoticeHours: number; paymentHoldMinutes: number; offerHoldMinutes: number; minDaysBetweenSessions: number; maxVisitsPerDay: number; freeRescheduleHours: number };
const put = <T>(p: string, b: unknown) => call<T>(p, { method: 'PUT', body: JSON.stringify(b) });
const C = '/admin/control';
export const control = {
  dashboard: () => call<Dashboard>(`${C}/dashboard`),
  users: (p: { q?: string; role?: string; status?: string }) => call<{ users: UserRow[] }>(`${C}/users?${new URLSearchParams(Object.entries(p).filter(([, v]) => v) as [string, string][])}`),
  user: (id: string) => call<{ user: UserRow; blocks: BlockRow[]; personalBlocks: { blocker_id: string; blocked_id: string; reason_code: string | null; note: string | null; created_at: string; blocker_name: string | null; blocked_name: string | null }[]; visits: { total: number; completed: number }; reasons: string[] }>(`${C}/users/${id}`),
  block: (id: string, b: { reasonCode: string; note: string; days?: number }) => post(`${C}/users/${id}/block`, b),
  unblock: (id: string, note: string) => post(`${C}/users/${id}/unblock`, { note }),
  blocks: (active = true) => call<{ blocks: BlockRow[] }>(`${C}/blocks?active=${active ? 1 : 0}`),
  personalBlocks: () => call<{ blocks: { blocker_id: string; blocked_id: string; reason_code: string | null; note: string | null; created_at: string; blocker_name: string | null; blocker_phone: string; blocked_name: string | null; blocked_phone: string }[] }>(`${C}/personal-blocks`),
  staff: () => call<{ roles: string[]; staff: { id: string; name: string | null; phone: string; status: string; last_login_at: string | null; roles: string[] }[] }>(`${C}/staff`),
  addStaff: (b: { phone: string; name?: string; role: string }) => post(`${C}/staff`, b),
  removeRole: (id: string, role: string) => call(`${C}/staff/${id}/roles/${role}`, { method: 'DELETE' }),
  zones: () => call<{ zones: Zone[]; cities: { id: string; name: string; status: string }[]; colors: string[] }>(`${C}/zones`),
  addZone: (b: Record<string, unknown>) => post<{ id: string }>(`${C}/zones`, b),
  updateZone: (id: string, b: Record<string, unknown>) => call(`${C}/zones/${id}`, { method: 'PATCH', body: JSON.stringify(b) }),
  zoneHistory: (id: string) => call<{ changes: { from_color: string | null; to_color: string; reason: string; created_at: string; changed_by: string | null }[] }>(`${C}/zones/${id}/history`),
  settings: () => call<{ maintenance: { enabled: boolean; message: string | null }; min_app_version: Record<string, string>; scheduling: Scheduling }>(`${C}/settings`),
  setMaintenance: (enabled: boolean, message: string | null) => put(`${C}/settings/maintenance`, { enabled, message }),
  setMinVersions: (v: Record<string, string>) => put(`${C}/settings/min-app-version`, v),
  setScheduling: (s: Scheduling) => put(`${C}/settings/scheduling`, s),
  audit: (p: { action?: string; target?: string; before?: number }) => call<{ entries: { id: number; action: string; target_type: string | null; target_id: string | null; before: unknown; after: unknown; ip: string | null; created_at: string; actor_name: string | null; actor_phone: string | null }[] }>(`${C}/audit?${new URLSearchParams(Object.entries(p).filter(([, v]) => v).map(([k, v]) => [k, String(v)]))}`),
};
const G = '/admin/grievances';
export const grievances = {
  list: (status = 'active') => call<{ grievances: GrievanceRow[]; committee: { id: string; name: string | null }[]; officer: { name: string; email: string | null; ackHours: number; resolveDays: number } }>(`${G}?status=${status}`),
  get: (id: string) => call<{ grievance: GrievanceRow & { description: string; complainant_phone: string; against_phone: string | null; resolution: string | null; file_ids: string[]; visit_id: string | null }; events: { id: number; kind: string; body: string | null; public: boolean; created_at: string; actor_name: string | null }[] }>(`${G}/${id}`),
  acknowledge: (id: string, message?: string) => post(`${G}/${id}/acknowledge`, { message }),
  assign: (id: string, userId: string) => post(`${G}/${id}/assign`, { userId }),
  note: (id: string, body: string, toComplainant: boolean) => post(`${G}/${id}/note`, { body, toComplainant }),
  escalate: (id: string, reason: string) => post(`${G}/${id}/escalate`, { reason }),
  resolve: (id: string, resolution: string, reject = false) => post(`${G}/${id}/resolve`, { resolution, reject }),
};
export const ROLE_LABEL: Record<string, string> = { patient: 'Patient', therapist: 'Physio', partner_owner: 'Partner', partner_staff: 'Partner staff', partner_wallet: 'Partner wallet', ops_admin: 'Ops admin', finance: 'Finance', city_coordinator: 'City coordinator', grievance_committee: 'Grievance committee', super_admin: 'Super admin' };
