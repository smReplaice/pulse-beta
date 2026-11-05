import 'reflect-metadata';
import { AppDataSource } from './data-source';
import { seedProgrammes } from './seed-core';

/** PostgreSQL seed entry: npm run db:seed (uses DATABASE_URL/.env). */
AppDataSource.initialize()
  .then(() => seedProgrammes(AppDataSource))
  .then(() => AppDataSource.destroy())
  .then(() => console.log('Seed complete (PostgreSQL).'))
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
