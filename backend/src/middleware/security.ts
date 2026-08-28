import cors, { CorsOptions } from "cors";
import helmet from "helmet";
import { env } from "../config/env";

export const securityHeaders = helmet();

// Never `origin: "*"` with credentials (spec section 36). Only the
// configured frontend origin may send credentialed (cookie-bearing)
// requests to the auth API.
export const corsOptions: CorsOptions = {
  origin: env.FRONTEND_URL,
  credentials: true,
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

export const corsMiddleware = cors(corsOptions);
