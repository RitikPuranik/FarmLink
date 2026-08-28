import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { AppError } from "../common/errors";
import { sendError } from "../common/apiResponse";
import { captureException } from "../config/sentry";
import { isProduction } from "../config/env";
import { logger } from "../config/logger";

interface BodyParserLikeError extends Error {
  status?: number;
  statusCode?: number;
  type?: string;
  expose?: boolean;
}

function isBodyParserClientError(err: unknown): err is BodyParserLikeError {
  if (!(err instanceof Error)) return false;
  const status = (err as BodyParserLikeError).status ?? (err as BodyParserLikeError).statusCode;
  return typeof status === "number" && status >= 400 && status < 500;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      captureException(err, { path: req.originalUrl, method: req.method });
    }
    return sendError(res, err.statusCode, err.code, err.message, err.fields);
  }

  if (err instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of err.issues) {
      fields[issue.path.join(".") || "_"] = issue.message;
    }
    return sendError(res, 400, "VALIDATION_ERROR", "Please correct the highlighted fields", fields);
  }

  // body-parser (express.json/urlencoded) throws plain errors with a
  // `status`/`statusCode` for things like oversized payloads or malformed
  // JSON — surface the real 4xx instead of masking it as a 500.
  if (isBodyParserClientError(err)) {
    const status = err.status ?? err.statusCode!;
    const message =
      err.type === "entity.too.large"
        ? "Request body is too large."
        : "The request could not be understood.";
    return sendError(res, status, status === 413 ? "PAYLOAD_TOO_LARGE" : "VALIDATION_ERROR", message);
  }

  // Unknown/unexpected error: never leak internals to the client.
  captureException(err, { path: req.originalUrl, method: req.method });
  if (!isProduction) {
    logger.error({ err }, "Unhandled error");
  }
  return sendError(res, 500, "UNEXPECTED_ERROR", "Something went wrong on our end. Please try again.");
}
