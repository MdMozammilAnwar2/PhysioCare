import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Umzug, SequelizeStorage } from 'umzug';
import { sequelize } from './index.js';

const dir = path.dirname(fileURLToPath(import.meta.url));

export const migrator = new Umzug({
  migrations: {
    glob: ['migrations/*.js', { cwd: dir }],
    resolve: ({ name, path: file, context }) => ({
      name,
      up: async () => (await import(pathToFileURL(file).href)).up({ context }),
      down: async () => (await import(pathToFileURL(file).href)).down({ context }),
    }),
  },
  context: sequelize,
  storage: new SequelizeStorage({ sequelize, tableName: 'schema_migrations' }),
  logger: undefined,
});
