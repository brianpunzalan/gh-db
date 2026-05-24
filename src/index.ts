export { GhDb } from './core/gh-db.js';

export type {
  GhDbConfig,
  ConflictPolicy,
  ReadConsistencyPolicy,
  CommitOptions,
  CommitResult,
  StagedOperation,
  StagedOperationKind,
  CreateRepositoryOptions,
  CreateRepositoryResult,
  WebhookSubscriptionOptions,
  WebhookSubscription,
  JsonValue,
  RetrieveResult,
} from './types/public.js';

export {
  GhDbError,
  AuthError,
  PermissionError,
  NotFoundError,
  ValidationError,
  ConflictError,
  RateLimitError,
  ServerError,
  NetworkError,
  ParseError,
  SerializationError,
  KeyValidationError,
  RetryExhaustedError,
  StagingError,
  RollbackError,
} from './errors/index.js';

export type { GhDbErrorCode } from './errors/index.js';
