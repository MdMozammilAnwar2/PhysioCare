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
export type Hold = { visitId: string; planId: string; amountPaise: number; holdExpiresAt: string; needsPhysioConsent: boolean; payment: { provider: 'razorpay' | 'fake'; keyId: string; orderId: string } };
export type Booking = { id: string; mode: string; status: string; starts_at: string; therapist_name: string; sessions_total: number; plan_status: string; zone_name: string | null; zone_color: string | null };

export const api = {
  status: () => raw<{ version: string; maintenance: { enabled: boolean; message: string | null } }>('/status'),
  sendOtp: (phone: string) => post<{ resendAfterSeconds: number }>('/auth/otp/send', { phone }),
  verifyOtp: async (phone: string, code: string, extra: { ref?: string; utm?: Record<string, string> } = {}) => {
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
  verifyPayment: (b: { orderId: string; paymentId: string; signature: string }) => post<{ invoiceNo: string; needsNewTime: boolean }>('/payments/razorpay/verify', b),
  simulatePayment: (orderId: string) => post<{ invoiceNo: string; needsNewTime: boolean }>('/dev/payments/simulate', { orderId }),
  bookings: () => raw<{ bookings: Booking[] }>('/bookings'),
};

export const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

// Razorpay Checkout (only when real keys are configured on the server).
declare global { interface Window { Razorpay?: new (o: Record<string, unknown>) => { open: () => void } } }
export async function payWithRazorpay(hold: Hold, prefill: { contact?: string; name?: string }) {
  if (hold.payment.provider === 'fake') return api.simulatePayment(hold.payment.orderId);
  if (!window.Razorpay) await new Promise<void>((ok, fail) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js'; s.onload = () => ok(); s.onerror = () => fail(new Error('Could not load Razorpay.'));
    document.body.appendChild(s);
  });
  return new Promise<{ invoiceNo: string; needsNewTime: boolean }>((resolve, reject) => {
    const rzp = new window.Razorpay!({
      key: hold.payment.keyId, order_id: hold.payment.orderId, amount: hold.amountPaise, currency: 'INR',
      name: 'PhysioConnect', description: 'Physiotherapy booking', prefill, theme: { color: '#0A6CFF' },
      handler: (r: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) =>
        api.verifyPayment({ orderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature }).then(resolve, reject),
      modal: { ondismiss: () => reject(new ApiError(0, 'payment_cancelled', 'Payment was cancelled. Your slot is held for a few minutes.')) },
    });
    rzp.open();
  });
}
