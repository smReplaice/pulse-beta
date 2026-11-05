import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as entities from '../entities';
import { seedProgrammes } from './seed-core';

/**
 * Lightweight seed used by the dev SQLite path and by `npm run db:seed`.
 * Idempotent: skips when a sample programme already exists.
 */
export async function seedDatabase(dataSource: DataSource): Promise<void> {
  await seedProgrammes(dataSource);
}

export function makeSqliteDataSource(database = 'data/pulse-dev.sqlite'): DataSource {
  return new DataSource({
    type: 'better-sqlite3',
    database,
    entities: Object.values(entities) as unknown as Function[],
    synchronize: true,
  });
}

// Also runnable directly: ts-node src/database/seed-lite.ts (sqlite)
if (require.main === module) {
  const ds = makeSqliteDataSource();
  void ds.initialize().then(async () => {
    await seedDatabase(ds);
    await ds.destroy();
    console.log('Seed complete (SQLite).');
  });
}
