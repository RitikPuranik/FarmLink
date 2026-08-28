import { NextFunction, Request, Response } from "express";
import { NotFoundError } from "../common/errors";

export function notFoundHandler(req: Request, _res: Response, next: NextFunction) {
  next(new NotFoundError(`No route matches ${req.method} ${req.originalUrl}`));
}
