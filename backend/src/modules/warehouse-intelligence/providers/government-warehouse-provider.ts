import { env } from "../../../config/env";
import { WarehouseDataProvider, WarehouseProviderRequest, WarehouseProviderResult } from "./warehouse-data-provider";

/**
 * Boundary for a future government warehouse data source (e.g. a WDRA
 * registry, a state warehousing corporation feed, or similar).
 *
 * No such API is configured, guessed at, or scraped here — there is no
 * reliable, publicly documented government warehouse API this codebase can
 * honestly claim to integrate with today. Rather than fabricate one,
 * fetchWarehouses() always returns an explicit UNAVAILABLE result. This is
 * intentionally NOT a system failure: WarehouseProviderRegistry treats
 * UNAVAILABLE the same as "provider not enabled", never as an error to
 * surface, retry, or alert on.
 *
 * WAREHOUSE_GOVERNMENT_PROVIDER_ENABLED/_TIMEOUT_MS/_MAX_RETRIES
 * (config/env.ts) are already wired through so that the day a real
 * endpoint exists, only this class's fetchWarehouses() body needs to
 * change — the registry, config, and every downstream layer are already
 * ready for it.
 */
export class UnavailableGovernmentWarehouseProvider implements WarehouseDataProvider {
  readonly providerId = "government-unconfigured";
  readonly providerType = "GOVERNMENT" as const;

  get configured(): boolean {
    // Deliberately always false: WAREHOUSE_GOVERNMENT_PROVIDER_ENABLED
    // toggles intent, not capability — there is no real endpoint to
    // enable yet. Kept as a getter (rather than a hardcoded `false`
    // return in fetchWarehouses) so a future real implementation swaps
    // this one condition, not every call site.
    return false;
  }

  async fetchWarehouses(_request: WarehouseProviderRequest): Promise<WarehouseProviderResult> {
    return {
      provider: { id: this.providerId, type: this.providerType },
      status: "UNAVAILABLE",
      warehouses: [],
      metadata: { fetchedAt: new Date(), recordCount: 0 },
      errors: [
        {
          code: "GOVERNMENT_WAREHOUSE_SOURCE_NOT_CONFIGURED",
          message: env.WAREHOUSE_GOVERNMENT_PROVIDER_ENABLED
            ? "Government warehouse source is enabled but no real provider implementation exists yet."
            : "Government warehouse source is not enabled (WAREHOUSE_GOVERNMENT_PROVIDER_ENABLED=false).",
        },
      ],
    };
  }
}
