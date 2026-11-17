import { Sequelize } from 'sequelize';
import { config } from '../config/index.js';

export const sequelize = new Sequelize(config.databaseUrl, {
  dialect: 'postgres',
  logging: false,
  // underscored maps camelCase attributes (createdAt) to snake_case columns (created_at).
  define: { underscored: true, timestamps: true },
  pool: { max: 10, min: 0, idle: 10000 },
});
