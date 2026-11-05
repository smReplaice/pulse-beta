import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from './app.module';
import { EngineExceptionFilter } from './common/engine-exception.filter';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, { cors: true });
  const port = Number(process.env.PORT ?? 4000);

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: false,
      transform: true,
    }),
  );
  app.useGlobalFilters(new EngineExceptionFilter());
  app.useWebSocketAdapter(new WsAdapter(app));
  app.enableShutdownHooks();

  await app.listen(port, '0.0.0.0');
  const origin = process.env.CORS_ORIGIN ?? 'http://localhost:5173';
  logger.log(`BiltFlow Pulse API listening on http://localhost:${port}/api`);
  logger.log(`CORS enabled for ${origin} (all origins allowed in dev)`);
}

void bootstrap();
