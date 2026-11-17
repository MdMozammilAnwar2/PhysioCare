import { config } from './config/index.js';
import { createApp } from './app.js';
import { sequelize } from './db/index.js';

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`PhysioConnect API v${config.version} listening on http://localhost:${config.port} (${config.env})`);
});

async function shutdown() {
  server.close();
  await sequelize.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
