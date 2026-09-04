import { Request, Response } from "express";
import { sendSuccess } from "../../common/apiResponse";
import { trackEvent } from "../../config/posthog";
import { AuthenticatedUserContext } from "../auth/auth.types";
import { ClientForecastScope, PriceForecastingService } from "./price-forecasting.service";
import { GenerateForecastBody, LatestForecastQuery, ListForecastsQuery } from "./price-forecasting.schemas";

/**
 * Thin controller for the Price Forecasting API — validation already
 * happened in middleware (validateBody/validateParams/validateQuery, per
 * project convention), so every handler here does exactly two things:
 * call the orchestration service, and send the response. "Viewed"
 * analytics for the three read endpoints live here (not the service) to
 * mirror sell-vs-store.controller.ts's own split between service-level
 * generation events and controller-level view events.
 */
export function createPriceForecastingController(service: PriceForecastingService) {
  return {
    generate: async (req: Request, res: Response) => {
      const user = req.user as AuthenticatedUserContext;
      const body = req.body as GenerateForecastBody;

      const forecast = await service.generateForecast(
        { cropId: body.cropId, scope: body.scope as ClientForecastScope, horizonDays: body.horizonDays },
        user,
      );

      sendSuccess(res, forecast, "Forecast retrieved.", 200);
    },

    getByPublicId: async (req: Request, res: Response) => {
      const user = req.user as AuthenticatedUserContext;
      const forecast = await service.getForecast(req.params.forecastPublicId);
      trackEvent("forecast_viewed", user.id, { forecastPublicId: forecast.forecastPublicId, status: forecast.status });
      sendSuccess(res, forecast, "Forecast retrieved.");
    },

    listForCrop: async (req: Request, res: Response) => {
      const user = req.user as AuthenticatedUserContext;
      const q = req.validatedQuery as ListForecastsQuery;

      const forecasts = await service.listForecasts(req.params.cropId, {
        scopeType: q.scopeType,
        mandiId: q.mandiId,
        startDate: q.startDate,
        endDate: q.endDate,
        limit: q.limit,
      });
      trackEvent("forecast_viewed", user.id, { cropId: req.params.cropId, listSize: forecasts.length });
      sendSuccess(res, forecasts, "Forecasts retrieved.");
    },

    latestForCrop: async (req: Request, res: Response) => {
      const user = req.user as AuthenticatedUserContext;
      const q = req.validatedQuery as LatestForecastQuery;

      const scope: ClientForecastScope =
        q.scopeType === "MANDI"
          ? { type: "MANDI", mandiId: q.mandiId! }
          : q.scopeType === "REGIONAL"
            ? { type: "REGIONAL", state: q.state!, district: q.district }
            : { type: "CROP_WIDE" };

      const forecast = await service.findLatestForecast(req.params.cropId, scope);
      trackEvent("forecast_viewed", user.id, { cropId: req.params.cropId, forecastPublicId: forecast.forecastPublicId });
      sendSuccess(res, forecast, "Latest forecast retrieved.");
    },
  };
}
