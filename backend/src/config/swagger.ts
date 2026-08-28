import swaggerJsdoc from "swagger-jsdoc";
import path from "path";
import { env } from "./env";

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.0.3",
    info: {
      title: "FarmLink Intelligence API — Modules 1 & 2",
      version: "1.1.0",
      description:
        "SIH26132 — Strengthening market linkages and price discovery for farmers. " +
        "Module 1: identity, authentication, session management, and role-based " +
        "access control. Module 2: farmer & farm profile management — farmer " +
        "profiles, farms, crops, and location/crop/FPO reference data — built on " +
        "top of the identity Module 1 issues. Later business modules (market " +
        "prices, buyers, logistics, etc.) are not yet part of this API.",
    },
    servers: [{ url: env.BACKEND_URL, description: "Current environment" }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "Short-lived access token returned by /api/auth/login or /api/auth/refresh.",
        },
      },
      schemas: {
        SuccessResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", example: true },
            data: { type: "object" },
            message: { type: "string" },
          },
        },
        ErrorResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", example: false },
            error: {
              type: "object",
              properties: {
                code: { type: "string", example: "VALIDATION_ERROR" },
                message: { type: "string" },
                fields: { type: "object" },
              },
            },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: [path.join(__dirname, "../modules/**/*.routes.ts"), path.join(__dirname, "../modules/**/*.routes.js")],
};

export const swaggerSpec = swaggerJsdoc(options);
