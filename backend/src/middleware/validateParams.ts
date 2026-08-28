import { NextFunction, Request, Response } from "express";
import { ZodError, ZodSchema } from "zod";
import { ValidationError } from "../common/errors";

function flattenZodError(error: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    if (!fields[key]) {
      fields[key] = issue.message;
    }
  }
  return fields;
}

/**
 * Validates req.params (e.g. `:id` must be a well-formed uuid) before it
 * ever reaches a repository/Prisma call. Without this, a malformed id in
 * the URL would fail as a raw database error (500) instead of the 400 a
 * client mistake should produce.
 */
export function validateParams<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      return next(new ValidationError("Please correct the highlighted fields", flattenZodError(result.error)));
    }
    next();
  };
}
