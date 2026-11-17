// Rebuilds the test database from the real migrations before the test run.
export default async function setup() {
  process.env.NODE_ENV = 'test';
  const { sequelize } = await import('../src/db/index.js');
  const { migrator } = await import('../src/db/migrator.js');
  await sequelize.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrator.up();
  await sequelize.close();
}
