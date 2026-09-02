export type ErrorCode =
  | "VALIDATION_ERROR"
  | "AUTHENTICATION_ERROR"
  | "INVALID_CREDENTIALS"
  | "AUTHORIZATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "DATABASE_ERROR"
  | "CROP_NOT_FOUND"
  | "MANDI_NOT_FOUND"
  | "INSUFFICIENT_MARKET_DATA"
  | "INVALID_LOCATION"
  | "LOCATION_REQUIRED"
  | "NO_NEARBY_MARKETS_FOUND"
  | "INVALID_DATE_RANGE"
  | "UNSUPPORTED_UNIT"
  | "INVALID_DATE"
  | "UNKNOWN_CROP"
  | "AMBIGUOUS_CROP"
  | "MARKET_DATA_PROVIDER_ERROR"
  | "MARKET_DATA_SYNC_FAILED"
  | "BUYER_PROFILE_NOT_FOUND"
  | "BUYER_PROFILE_ALREADY_EXISTS"
  | "BUYER_NOT_VERIFIED"
  | "DEMAND_NOT_FOUND"
  | "DEMAND_NOT_ACTIVE"
  | "INVALID_DEMAND_TRANSITION"
  | "LOT_NOT_FOUND"
  | "LOT_NOT_AVAILABLE"
  | "OFFER_NOT_FOUND"
  | "INVALID_OFFER_TRANSITION"
  | "OFFER_EXPIRED"
  | "OFFER_NOT_PARTICIPANT"
  | "INSUFFICIENT_AVAILABLE_QUANTITY"
  | "DEMAND_QUANTITY_ALREADY_FULFILLED"
  | "INVALID_QUANTITY"
  | "REQUIRED_QUANTITY_BELOW_COMMITTED"
  | "INVALID_PRICE"
  | "QUALITY_REQUIREMENTS_INVALID"
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

export class MarketDomainError extends AppError {
  constructor(
    message: string,
    code: Exclude<ErrorCode, "VALIDATION_ERROR" | "AUTHENTICATION_ERROR" | "INVALID_CREDENTIALS" | "AUTHORIZATION_ERROR" | "NOT_FOUND" | "CONFLICT" | "RATE_LIMITED" | "DATABASE_ERROR" | "UNEXPECTED_ERROR">,
    statusCode = 422,
  ) {
    super(message, statusCode, code);
  }
}
