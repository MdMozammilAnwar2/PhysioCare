// SMS providers. "memory" is used in tests, "console" in development, "msg91" in production.
import { config } from '../config/index.js';
import { maskPhone } from '../lib/util.js';

const sentInMemory = new Map(); // phone -> last code (tests only)

const providers = {
  memory: {
    async sendOtp(phone, code) { sentInMemory.set(phone, code); },
  },
  console: {
    async sendOtp(phone, code) { console.log(`[sms:console] OTP for ${maskPhone(phone)} is ${code}`); },
  },
  msg91: {
    // MSG91 OTP API with a DLT-registered template. https://docs.msg91.com
    async sendOtp(phone, code) {
      const url = new URL('https://control.msg91.com/api/v5/otp');
      url.searchParams.set('template_id', config.sms.msg91TemplateId);
      url.searchParams.set('mobile', phone.replace('+', ''));
      url.searchParams.set('otp', code);
      const res = await fetch(url, { method: 'POST', headers: { authkey: config.sms.msg91AuthKey, 'content-type': 'application/json' } });
      // MSG91 can answer HTTP 200 with { type: 'error' } (wrong key, template or DLT problem), so check the body too.
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.type === 'error') throw new Error(`MSG91 send failed: ${body.message ?? res.status}`);
    },
  },
};

export function smsProvider() {
  const p = providers[config.sms.provider];
  if (!p) throw new Error(`Unknown SMS provider ${config.sms.provider}`);
  if (config.isProd && config.sms.provider !== 'msg91') throw new Error('Production must use the msg91 SMS provider');
  return p;
}

export const lastCodeSentTo = phone => sentInMemory.get(phone);
