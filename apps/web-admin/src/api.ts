// Minimal API client for Phase 0. Tokens live in memory + sessionStorage (console sessions end with the tab).
export type Status = {
  status: 'operational' | 'maintenance' | 'major_outage';
  version: string;
  services: Record<string, string>;
  maintenance: { enabled: boolean; message: string | null };
  checkedAt: string;
};
export type User = { id: string; phone: string; name: string | null; roles: string[]; primaryRole: string };

export class ApiError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = sessionStorage.getItem('pc.access');
  const res = await fetch(`/api/v1${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...init.headers },
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error?.code ?? 'error', body.error?.message ?? 'Something went wrong.');
  return body as T;
}

export const api = {
  status: () => call<Status>('/status'),
  sendOtp: (phone: string) => call<{ resendAfterSeconds: number }>('/auth/otp/send', { method: 'POST', body: JSON.stringify({ phone }) }),
  verifyOtp: async (phone: string, code: string) => {
    const r = await call<{ user: User; tokens: { accessToken: string; refreshToken: string } }>('/auth/otp/verify', { method: 'POST', body: JSON.stringify({ phone, code }) });
    sessionStorage.setItem('pc.access', r.tokens.accessToken);
    sessionStorage.setItem('pc.refresh', r.tokens.refreshToken);
    return r.user;
  },
  me: () => call<{ user: User }>('/me').then(r => r.user),
  logout: async () => {
    const refreshToken = sessionStorage.getItem('pc.refresh');
    sessionStorage.clear();
    if (refreshToken) await call('/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken }) }).catch(() => undefined);
  },
};
