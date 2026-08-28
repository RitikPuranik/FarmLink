export type ErrorCode =
  | "VALIDATION_ERROR"
  | "AUTHENTICATION_ERROR"
  | "INVALID_CREDENTIALS"
  | "AUTHORIZATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "DATABASE_ERROR"
  | "UNEXPECTED_ERROR";

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: ErrorCode;
  public readonly fields?: Record<string, string>;

  constructor(
    message: string,
    statusCode: number,
    code: ErrorCode,
    fields?: Record<string, string>,
  ) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.fields = fields;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message = "Please correct the highlighted fields", fields?: Record<string, string>) {
    super(message, 400, "VALIDATION_ERROR", fields);
  }
}

export class AuthenticationError extends AppError {
  constructor(message = "Authentication is required.") {
    super(message, 401, "AUTHENTICATION_ERROR");
  }
}

export class InvalidCredentialsError extends AppError {
  constructor(message = "Invalid mobile number or password.") {
    super(message, 401, "INVALID_CREDENTIALS");
  }
}

export class AuthorizationError extends AppError {
  constructor(message = "You don't have permission to perform this action.") {
    super(message, 403, "AUTHORIZATION_ERROR");
  }
}

export class NotFoundError extends AppError {
  constructor(message = "The requested resource was not found.") {
    super(message, 404, "NOT_FOUND");
  }
}

export class ConflictError extends AppError {
  constructor(message = "This request conflicts with existing data.", fields?: Record<string, string>) {
    super(message, 409, "CONFLICT", fields);
  }
}

export class RateLimitError extends AppError {
  constructor(message = "Too many requests. Please try again later.") {
    super(message, 429, "RATE_LIMITED");
  }
}

export class DatabaseError extends AppError {
  constructor(message = "A database error occurred.") {
    super(message, 500, "DATABASE_ERROR");
  }
}
