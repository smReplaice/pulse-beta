export class EngineError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'EngineError';
  }
}

export class CircularDependencyError extends EngineError {
  constructor(public readonly cycleIds: string[], public readonly cycleNames: string[]) {
    super(
      'CIRCULAR_DEPENDENCY',
      `Circular dependency detected: ${cycleNames.join(' → ')}`,
      { cycleIds, cycleNames },
    );
    this.name = 'CircularDependencyError';
  }
}

export class InvalidDependencyError extends EngineError {
  constructor(code: string, message: string, details?: unknown) {
    super(code, message, details);
    this.name = 'InvalidDependencyError';
  }
}

export class CalendarError extends EngineError {
  constructor(message: string) {
    super('CALENDAR_ERROR', message);
    this.name = 'CalendarError';
  }
}
