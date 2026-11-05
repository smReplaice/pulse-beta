/** Shared e2e helpers: builds a Nest app on an in-memory SQLite database. */
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { ScheduleGateway } from '../src/gateway/schedule.gateway';

async function createTestApp() {
  const entities = await import('../src/entities');
  const featureModules = [
    (await import('../src/modules/schedule/schedule.module')).ScheduleModule,
    (await import('../src/modules/projects/projects.module')).ProjectsModule,
    (await import('../src/modules/tasks/tasks.module')).TasksModule,
    (await import('../src/modules/dependencies/dependencies.module')).DependenciesModule,
    (await import('../src/modules/resources/resources.module')).ResourcesModule,
    (await import('../src/modules/calendars/calendars.module')).CalendarsModule,
    (await import('../src/modules/usage/usage.module')).UsageModule,
    (await import('../src/modules/leveling/leveling.module')).LevelingModule,
    (await import('../src/modules/baselines/baselines.module')).BaselinesModule,
    (await import('../src/modules/progress/progress.module')).ProgressModule,
    (await import('../src/modules/io/io.module')).IoModule,
    (await import('../src/modules/ai/ai.module')).AiModule,
    (await import('../src/modules/msproject/msproject.module')).MsProjectModule,
  ];

  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true }),
      TypeOrmModule.forRoot({
        type: 'better-sqlite3',
        database: ':memory:',
        entities: Object.values(entities),
        synchronize: true,
        dropSchema: true,
      }),
      ...featureModules,
    ],
    providers: [ScheduleGateway],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  const { ValidationPipe } = await import('@nestjs/common');
  const { WsAdapter } = await import('@nestjs/platform-ws');
  const { EngineExceptionFilter } = await import('../src/common/engine-exception.filter');
  app.useWebSocketAdapter(new WsAdapter(app));
  app.useGlobalFilters(new EngineExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: false, transform: true, skipMissingProperties: true }));
  await app.init();
  return app;
}

export { createTestApp };
