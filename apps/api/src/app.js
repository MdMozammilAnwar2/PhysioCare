import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { config } from './config/index.js';
import { errorHandler, notFound } from './middleware/index.js';
import { statusRouter } from './routes/status.js';
import { authRouter } from './routes/auth.js';
import { meRouter } from './routes/me.js';
import { patientRouter } from './routes/patient.js';
import { adminPaymentsRouter, bookingsRouter, notificationsRouter, paymentsRouter, therapistsRouter } from './routes/booking.js';
import { therapistRouter } from './routes/therapist.js';
import { adminRouter } from './routes/admin.js';
import { zonesRouter } from './routes/public.js';
import { filesRouter } from './routes/files.js';
import { adminMoneyRouter, chatRouter, patientMoneyRouter, walletRouter } from './routes/money.js';
import { adminGrowthRouter, growthRouter, linkRouter, partnerRouter } from './routes/growth.js';
import { controlRouter, personalBlocksRouter } from './routes/control.js';
import { adminGrievanceRouter, grievanceRouter, publicRouter } from './routes/grievance.js';
import { adminCmsRouter, publicCmsRouter, seoRouter } from './routes/cms.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  // Files are served to other origins (website, apps), so allow cross-origin reads of resources.
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin: config.corsOrigins }));
  app.use(express.json({ limit: '100kb' }));

  app.use('/api/v1/status', cors({ origin: '*' }), statusRouter); // public for any app or monitor
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/me', meRouter);
  app.use('/api/v1/patient', patientRouter);
  app.use('/api/v1/therapists', therapistsRouter);
  app.use('/api/v1/bookings', bookingsRouter);
  app.use('/api/v1/payments', paymentsRouter);
  app.use('/api/v1/admin/payments', adminPaymentsRouter);
  app.use('/api/v1/admin/money', adminMoneyRouter);
  app.use('/api/v1/admin/growth', adminGrowthRouter);
  app.use('/api/v1/admin/control', controlRouter);
  app.use('/api/v1/admin/cms', adminCmsRouter);
  app.use('/api/v1/admin/grievances', adminGrievanceRouter);
  app.use('/api/v1/admin', adminRouter);
  app.use('/api/v1/therapist/wallet', walletRouter);
  app.use('/api/v1/therapist', therapistRouter);
  app.use('/api/v1/patient', patientMoneyRouter);
  app.use('/api/v1/chat', chatRouter);
  app.use('/api/v1/notifications', notificationsRouter);
  app.use('/api/v1/zones', zonesRouter);
  app.use('/api/v1/files', filesRouter);
  app.use('/api/v1/growth', growthRouter);
  app.use('/api/v1/public', cors({ origin: '*' }), publicRouter, publicCmsRouter);
  app.use('/', seoRouter); // /sitemap.xml and /robots.txt
  app.use('/api/v1/grievances', grievanceRouter);
  app.use('/api/v1/blocks', personalBlocksRouter);
  app.use('/api/v1/partner', partnerRouter);
  app.use('/r', linkRouter); // QR scans and shared links

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
