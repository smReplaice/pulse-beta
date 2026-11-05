import { HttpException, HttpStatus } from '@nestjs/common';

export class ScheduleVersionConflictException extends HttpException {
  constructor(currentVersion: number) {
    super(
      {
        statusCode: 409,
        code: 'SCHEDULE_VERSION_CONFLICT',
        message: `Schedule was modified (current version ${currentVersion}). Reload the programme and retry.`,
        currentVersion,
      },
      HttpStatus.CONFLICT,
    );
  }
}

export class NotFoundError extends HttpException {
  constructor(what: string) {
    super({ statusCode: 404, code: 'NOT_FOUND', message: `${what} not found` }, HttpStatus.NOT_FOUND);
  }
}

export class ValidationError extends HttpException {
  constructor(message: string) {
    super({ statusCode: 400, code: 'VALIDATION', message }, HttpStatus.BAD_REQUEST);
  }
}
