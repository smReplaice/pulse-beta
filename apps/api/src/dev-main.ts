import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import * as entities from './entities';
import { EngineExceptionFilter } from './common/engine-exception.filter';
import { ScheduleGateway } from './gateway/schedule.gateway';

/**
 * Development bootstrap: when DATABASE_URL is EMPTY the API runs on a local
 * SQLite file (apps/api/data/pulse-dev.sqlite) with auto-migrated schema and
 * seed data, so the app works before PostgreSQL credentials are added.
 * With DATABASE_URL set, the normal PostgreSQL path (main.ts + migrations) is used.
 */
async function bootstrap(): Promise<void> {
  const logger = new Logger('DevBootstrap');
  const hasPostgres = Boolean(process.env.DATABASE_URL?.trim());

  const AppModule = hasPostgres
    ? (await import('./app.module')).AppModule
    : (await import('./dev-sqlite.module')).DevSqliteModule;

  const app = await NestFactory.create(AppModule, { cors: true });
  const port = Number(process.env.PORT ?? 4000);
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: false, transform: true }));
  app.useGlobalFilters(new EngineExceptionFilter());
  app.useWebSocketAdapter(new WsAdapter(app));
  app.enableShutdownHooks();

  if (!hasPostgres && (process.env.SEED_ON_BOOT ?? 'true') !== 'false') {
    const dataSource = app.get(DataSource);
    const { seedProgrammes } = await import('./database/seed-core');
    const repo = dataSource.getRepository(entities.ProjectEntity);
    if ((await repo.count()) === 0) {
      await seedProgrammes(dataSource);
    }
  }

  await app.listen(port, '0.0.0.0');

  logger.log(`BiltFlow Pulse API on http://localhost:${port}/api`);
  if (!hasPostgres) {
    logger.warn('DATABASE_URL is empty — running on local SQLite (apps/api/data/pulse-dev.sqlite).');
    logger.warn('Add your PostgreSQL URL to apps/api/.env and restart to use PostgreSQL.');
  }
  void TypeOrmModule;
  void ConfigModule;
  void entities;
}

void bootstrap();
