import swaggerJsdoc from "swagger-jsdoc";
import path from "path";
import { env } from "./env";

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.0.3",
    info: {
      title: "FarmLink Intelligence API — Modules 1–8",
      version: "1.5.0",
      description:
        "SIH26132 — Strengthening market linkages and price discovery for farmers.\n\n" +
        "**Module 1**: Identity, authentication, sessions, RBAC.\n" +
        "**Module 2**: Farmer & farm profile management, crops, and reference data.\n" +
        "**Module 3**: FPO management, farmer aggregation, FPO analytics.\n" +
        "**Module 4**: Crop/Lot management (drafts, publishing, cancellation).\n" +
        "**Module 5**: Quality Grading & Produce Assessment (self-reports, AI pipelines, human verification).\n" +
        "**Module 6**: Market Intelligence & Price Discovery (freshness, local context).\n" +
        "**Module 7**: Buyer Management & Matching (demands, deterministic lot matching, offers, atomic reservation).\n" +
        "**Module 8**: Sell vs Store Decision Engine (market/quality/storage context evaluation).\n\n" +
        "Logistics, shipment, payment, and grievance are not yet part of this API.",
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
