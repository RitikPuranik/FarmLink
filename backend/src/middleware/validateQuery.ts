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
 * Same shape as validateBody.ts but for req.query, added by Module 2 for
 * endpoints like `GET /api/reference/districts?stateId=`. Express typings
 * make req.query read-only in some versions, so the parsed result is
 * attached to req.validatedQuery instead of reassigning req.query.
 */
export function validateQuery<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      return next(new ValidationError("Please correct the highlighted fields", flattenZodError(result.error)));
    }
    req.validatedQuery = result.data;
    next();
  };
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      validatedQuery?: unknown;
    }
  }
}
