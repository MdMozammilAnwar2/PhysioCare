import { migrator } from '../src/db/migrator.js';
import { sequelize } from '../src/db/index.js';

const direction = process.argv[2] || 'up';
try {
  const done = direction === 'down' ? await migrator.down() : await migrator.up();
  console.log(`${direction}: ${done.map(m => m.name).join(', ') || 'nothing to run'}`);
} finally {
  await sequelize.close();
}
