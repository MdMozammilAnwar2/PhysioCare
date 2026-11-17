import { Router } from 'express';
import { sequelize } from '../db/index.js';
import { config } from '../config/index.js';
import { HttpError } from '../lib/util.js';
import { asyncHandler, requireAuth } from '../middleware/index.js';
import { paymentProvider, checkoutSignature } from '../services/payments.js';
import { confirmPayment } from '../services/booking.js';

// Public reference data.
export const zonesRouter = Router();
zonesRouter.get('/', asyncHandler(async (req, res) => {
  const city = String(req.query.city || 'Patna');
  const [rows] = await sequelize.query(`SELECT z.id, z.name, z.color, z.center_lat AS lat, z.center_lng AS lng
    FROM zones z JOIN cities c ON c.id = z.city_id WHERE c.name = :city AND z.center_lat IS NOT NULL ORDER BY z.name`, { replacements: { city } });
  res.json({ city, zones: rows });
}));

// Development only: completes a payment made with the fake provider (there is no real checkout page).
export const devRouter = Router();
devRouter.post('/payments/simulate', requireAuth, asyncHandler(async (req, res) => {
  if (config.isProd || paymentProvider().name !== 'fake') throw new HttpError(404, 'not_found', 'Not found.');
  const orderId = String(req.body?.orderId || '');
  const [[owner]] = await sequelize.query(`SELECT patient_id FROM payments WHERE provider_order_id = :o`, { replacements: { o: orderId } });
  if (!owner || owner.patient_id !== req.user.id) throw new HttpError(404, 'order_not_found', 'Payment not found.');
  const paymentId = `pay_dev_${Date.now()}`;
  res.json({ paymentId, signature: checkoutSignature(orderId, paymentId), ...(await confirmPayment({ orderId, paymentId })) });
}));
