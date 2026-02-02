export type VersionErrorCode =
  | 'ASYNC_PREDICATE'
  | 'ASYNC_RULE_VALUE'
  | 'INVALID_CONTEXT'
  | 'INVALID_RULE'
  | 'INVALID_VERSION';

export class VersionError extends Error {
  public readonly code?: VersionErrorCode;

  constructor(message: string, code?: VersionErrorCode, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'VersionError';
    this.code = code;
  }
}

export class AsyncPredicateError extends VersionError {
  constructor() {
    super('Async predicate detected. Use resolveAsync().', 'ASYNC_PREDICATE');
    this.name = 'AsyncPredicateError';
  }
}

export class AsyncRuleValueError extends VersionError {
  constructor() {
    super('Async rule value detected. Use resolveAsync().', 'ASYNC_RULE_VALUE');
    this.name = 'AsyncRuleValueError';
  }
}

export class InvalidContextError extends VersionError {
  constructor(message: string) {
    super(message, 'INVALID_CONTEXT');
    this.name = 'InvalidContextError';
  }
}

export class InvalidRuleError extends VersionError {
  constructor(message: string) {
    super(message, 'INVALID_RULE');
    this.name = 'InvalidRuleError';
  }
}

export class InvalidVersionError extends VersionError {
  constructor(component: string) {
    super(`Invalid version component: ${component}`, 'INVALID_VERSION');
    this.name = 'InvalidVersionError';
  }
}
