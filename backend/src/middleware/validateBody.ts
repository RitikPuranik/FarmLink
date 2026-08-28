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
 * Validates and replaces req.body with the parsed (and transformed/
 * normalized) result. Unknown top-level fields are rejected by schemas that
 * use `.strict()` — this is how privilege-escalation attempts like an
 * unexpected `role` field get turned into a 400 instead of being ignored.
 */
export function validateBody(schema: ZodSchema) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return next(new ValidationError("Please correct the highlighted fields", flattenZodError(result.error)));
    }
    req.body = result.data;
    next();
  };
}
