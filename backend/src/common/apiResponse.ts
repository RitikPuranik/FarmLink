import { Response } from "express";

export function sendSuccess<T>(
  res: Response,
  data: T,
  message = "Operation completed successfully",
  statusCode = 200,
) {
  return res.status(statusCode).json({
    success: true,
    data,
    message,
  });
}

export function sendError(
  res: Response,
  statusCode: number,
  code: string,
  message: string,
  fields?: Record<string, string>,
) {
  return res.status(statusCode).json({
    success: false,
    error: {
      code,
      message,
      ...(fields ? { fields } : {}),
    },
  });
}
