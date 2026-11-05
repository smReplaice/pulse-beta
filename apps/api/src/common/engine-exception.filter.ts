import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import {
  CircularDependencyError,
  EngineError,
  InvalidDependencyError,
} from '@pulse/engine';

@Catch()
export class EngineExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof CircularDependencyError) {
      response.status(HttpStatus.BAD_REQUEST).json({
        statusCode: 400,
        code: exception.code,
        message: exception.message,
        details: exception.details,
      });
      return;
    }
    if (exception instanceof InvalidDependencyError) {
      response.status(HttpStatus.BAD_REQUEST).json({
        statusCode: 400,
        code: exception.code,
        message: exception.message,
        details: exception.details,
      });
      return;
    }
    if (exception instanceof EngineError) {
      response.status(HttpStatus.UNPROCESSABLE_ENTITY).json({
        statusCode: 422,
        code: exception.code,
        message: exception.message,
        details: exception.details,
      });
      return;
    }
    if (exception instanceof HttpException) {
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }
    this.logger.error('Unhandled exception', exception instanceof Error ? exception.stack : exception);
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    });
  }
}
