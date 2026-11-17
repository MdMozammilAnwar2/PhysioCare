// Payment providers. "razorpay" when keys are set; "fake" in development and tests (same signature scheme).
import crypto from 'node:crypto';
import { config } from '../config/index.js';
import { hmac, safeEqualHex } from '../lib/util.js';

const razorpay = {
  name: 'razorpay',
  keyId: () => config.razorpay.keyId,
  async createOrder({ amountPaise, receipt, notes }) {
    const res = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Basic ${Buffer.from(`${config.razorpay.keyId}:${config.razorpay.keySecret}`).toString('base64')}` },
      body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt, notes }),
    });
    if (!res.ok) throw new Error(`Razorpay order failed with status ${res.status}`);
    const o = await res.json();
    return { orderId: o.id, raw: o };
  },
};

const fake = {
  name: 'fake',
  keyId: () => 'rzp_test_fake',
  async createOrder() { return { orderId: `order_fake_${crypto.randomBytes(8).toString('hex')}`, raw: null }; },
};

export const paymentProvider = () => (config.razorpay.keyId && config.razorpay.keySecret && !config.isTest ? razorpay : fake);

// Checkout signature: HMAC_SHA256(order_id + "|" + payment_id, key_secret). Razorpay docs: "Verify Payment Signature".
export const checkoutSignature = (orderId, paymentId) => hmac(config.razorpay.keySecret || 'dev-only-razorpay-secret', `${orderId}|${paymentId}`);
export const verifyCheckoutSignature = (orderId, paymentId, signature) =>
  /^[a-f0-9]{64}$/.test(String(signature)) && safeEqualHex(checkoutSignature(orderId, paymentId), signature);

// Webhook signature: HMAC_SHA256(raw request body, webhook_secret), header X-Razorpay-Signature.
export const webhookSignature = rawBody => hmac(config.razorpay.webhookSecret || 'dev-only-webhook-secret', rawBody);
export const verifyWebhookSignature = (rawBody, signature) =>
  /^[a-f0-9]{64}$/.test(String(signature)) && safeEqualHex(webhookSignature(rawBody), signature);
