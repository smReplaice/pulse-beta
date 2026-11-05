import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as entities from '../entities';
import { InitialSchema1700000000000 } from './migrations/1700000000000-InitialSchema';
import { MsProjectImport1700000001000 } from './migrations/1700000001000-MsProjectImport';
import { UuidDefaults1700000002000 } from './migrations/1700000002000-UuidDefaults';

function parseUrl(url: string) {
  try {
    const u = new URL(url);
    return {
      host: u.hostname,
      port: u.port ? Number(u.port) : 5432,
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: u.pathname.replace(/^\//, ''),
      ssl: u.searchParams.get('sslmode') === 'require' || process.env.PGSSL === 'require',
    };
  } catch {
    return null;
  }
}

const url = process.env.DATABASE_URL?.trim();
const parsed = url ? parseUrl(url) : null;

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: parsed?.host ?? process.env.PGHOST ?? 'localhost',
  port: parsed?.port ?? Number(process.env.PGPORT ?? 5432),
  username: parsed?.user ?? process.env.PGUSER ?? 'postgres',
  password: parsed?.password ?? process.env.PGPASSWORD ?? 'postgres',
  database: parsed?.database ?? process.env.PGDATABASE ?? 'pulse',
  ssl: (parsed?.ssl || process.env.PGSSL === 'require') ? { rejectUnauthorized: false } : undefined,
  entities: Object.values(entities) as Function[],
  migrations: [InitialSchema1700000000000, MsProjectImport1700000001000, UuidDefaults1700000002000],
  synchronize: false,
  migrationsTableName: 'pulse_schema_migrations',
  logging: false,
});
