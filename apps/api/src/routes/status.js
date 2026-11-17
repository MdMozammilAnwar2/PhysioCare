// Public, no login. Every web and mobile app calls this on start and every 60 s.
import { Router } from 'express';
import { config } from '../config/index.js';
import { AppSetting, sequelize } from '../models/index.js';

export const statusRouter = Router();

statusRouter.get('/', async (_req, res) => {
  const started = Date.now();
  let db = 'up';
  let maintenance = { enabled: false, message: null };
  let minAppVersion = null;
  try {
    await sequelize.query('SELECT 1');
    const settings = await AppSetting.findAll({ where: { key: ['maintenance', 'min_app_version'] } });
    for (const s of settings) {
      if (s.key === 'maintenance') maintenance = s.value;
      if (s.key === 'min_app_version') minAppVersion = s.value;
    }
  } catch {
    db = 'down';
  }
  const status = db === 'down' ? 'major_outage' : maintenance.enabled ? 'maintenance' : 'operational';
  res.set('Cache-Control', 'no-store');
  res.status(db === 'down' ? 503 : 200).json({
    status,
    version: config.version,
    services: { api: 'up', db, payments: 'not_configured', otp: config.sms.provider === 'msg91' ? 'up' : `dev:${config.sms.provider}`, push: 'not_configured' },
    maintenance,
    minAppVersion,
    responseMs: Date.now() - started,
    checkedAt: new Date().toISOString(),
  });
});
