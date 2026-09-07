import { logger } from "../../../config/logger";
import { captureException } from "../../../config/sentry";
import {
  WarehouseDataProvider,
  WarehouseProviderRequest,
  WarehouseProviderResult,
} from "./warehouse-data-provider";

/**
 * Registers a fixed set of providers and executes them with failure
 * isolation: one provider throwing, timing out, or returning UNAVAILABLE
 * must never stop the others from running, and must never be reported as
 * if the whole sync failed (Part 19 of the ingestion spec).
 */
export class WarehouseProviderRegistry {
  constructor(private readonly providers: WarehouseDataProvider[]) {}

  list(): readonly WarehouseDataProvider[] {
    return this.providers;
  }

  /**
   * Runs every registered provider and returns one WarehouseProviderResult
   * per provider, regardless of whether it succeeded, was unavailable, or
   * failed. Never throws on a single provider's behalf — a provider that
   * throws is converted into a FAILED result with the error captured (log
   * + Sentry) so the sync service can still process the providers that did
   * succeed.
   */
  async fetchAll(request: WarehouseProviderRequest): Promise<WarehouseProviderResult[]> {
    const results = await Promise.all(
      this.providers.map(async (provider): Promise<WarehouseProviderResult> => {
        try {
          return await provider.fetchWarehouses(request);
        } catch (err) {
          logger.error({ err, providerId: provider.providerId }, "Warehouse provider failed");
          captureException(err, {
            module: "warehouse_ingestion",
            operation: "provider_fetch",
            providerId: provider.providerId,
            providerType: provider.providerType,
          });
          return {
            provider: { id: provider.providerId, type: provider.providerType },
            status: "FAILED",
            warehouses: [],
            metadata: { fetchedAt: new Date(), recordCount: 0 },
            errors: [
              {
                code: "PROVIDER_FETCH_FAILED",
                message: err instanceof Error ? err.message : "Unknown provider failure.",
              },
            ],
          };
        }
      }),
    );
    return results;
  }
}
