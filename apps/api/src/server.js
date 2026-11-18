import { config } from './config/index.js';
import { createApp } from './app.js';
import { sequelize } from './db/index.js';
import { syncAll } from './services/calendar.js';
import { dispatchOnce } from './services/notify.js';

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`PhysioCare API v${config.version} listening on http://localhost:${config.port} (${config.env})`);
});

// Calendar sync: pull busy times from Google/Calendly and push visits to Google, every CALENDAR_SYNC_MINUTES.
let syncing = false;
const calendarTimer = config.calendar.syncMinutes > 0 ? setInterval(async () => {
  if (syncing) return;
  syncing = true;
  try { await syncAll(); } catch (e) { console.error('[calendar] sync failed:', e.message); } finally { syncing = false; }
}, config.calendar.syncMinutes * 60_000) : null;

// Notifications → push / SMS / WhatsApp, and visit reminders, every NOTIFY_DISPATCH_SECONDS.
let dispatching = false;
const notifyTimer = setInterval(async () => {
  if (dispatching) return;
  dispatching = true;
  try { await dispatchOnce(); } catch (e) { console.error('[notify] dispatch failed:', e.message); } finally { dispatching = false; }
}, config.messaging.dispatchEverySeconds * 1000);

async function shutdown() {
  clearInterval(notifyTimer);
  if (calendarTimer) clearInterval(calendarTimer);
  server.close();
  await sequelize.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
