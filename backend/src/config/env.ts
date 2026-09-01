import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  JWT_ACCESS_SECRET: z.string().min(16, "JWT_ACCESS_SECRET must be a long random string"),
  JWT_REFRESH_SECRET: z.string().min(16, "JWT_REFRESH_SECRET must be a long random string"),
  SESSION_SECRET: z.string().min(16, "SESSION_SECRET must be a long random string"),

  JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
  JWT_REFRESH_EXPIRES_IN_DAYS: z.coerce.number().default(30),

  FRONTEND_URL: z.string().default("http://localhost:3000"),
  BACKEND_URL: z.string().default("http://localhost:4000"),

  REDIS_URL: z.string().optional(),

  POSTHOG_API_KEY: z.string().optional().default(""),
  POSTHOG_HOST: z.string().optional().default("https://app.posthog.com"),

  SENTRY_DSN: z.string().optional().default(""),

  COOKIE_DOMAIN: z.string().optional().default("localhost"),
  MARKET_SYNC_ENABLED: z.coerce.boolean().default(false),
  MARKET_DATA_GOV_API_KEY: z.string().optional().default(""),
  MARKET_DATA_GOV_RESOURCE_ID: z.string().optional().default(""),
  MARKET_DATA_GOV_BASE_URL: z.string().url().default("https://api.data.gov.in/resource"),
  MARKET_DATA_GOV_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  MARKET_DATA_GOV_PAGE_SIZE: z.coerce.number().int().min(1).max(1_000).default(500),
  MARKET_DATA_GOV_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(3),
  MARKET_DATA_GOV_RATE_LIMIT_MS: z.coerce.number().int().min(0).max(60_000).default(250),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Intentionally do not log process.env itself — only the validation issues.
  // eslint-disable-next-line no-console
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment configuration. Check .env against .env.example.");
}

export const env = parsed.data;

export const isProduction = env.NODE_ENV === "production";
export const isTest = env.NODE_ENV === "test";
