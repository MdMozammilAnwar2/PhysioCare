import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { config } from './config/index.js';
import { errorHandler, notFound } from './middleware/index.js';
import { statusRouter } from './routes/status.js';
import { authRouter } from './routes/auth.js';
import { meRouter } from './routes/me.js';
import { patientRouter } from './routes/patient.js';
import { bookingsRouter, notificationsRouter, paymentsRouter, therapistsRouter } from './routes/booking.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigins }));
  // Webhooks need the raw body for signature checks, so they get it before the JSON parser.
  app.use('/api/v1/payments/razorpay/webhook', express.raw({ type: '*/*', limit: '1mb' }));
  app.use(express.json({ limit: '100kb' }));

  app.use('/api/v1/status', cors({ origin: '*' }), statusRouter); // public for any app or monitor
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/me', meRouter);
  app.use('/api/v1/patient', patientRouter);
  app.use('/api/v1/therapists', therapistsRouter);
  app.use('/api/v1/bookings', bookingsRouter);
  app.use('/api/v1/payments', paymentsRouter);
  app.use('/api/v1/notifications', notificationsRouter);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
