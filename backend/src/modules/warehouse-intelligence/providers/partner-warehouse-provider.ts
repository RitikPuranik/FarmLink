import { env } from "../../../config/env";
import { WarehouseDataProvider, WarehouseProviderRequest, WarehouseProviderResult } from "./warehouse-data-provider";

/**
 * Boundary for a future private-partner warehouse data source (e.g. a cold
 * storage network, a warehouse aggregator, or a logistics partner's API).
 *
 * Same rationale as UnavailableGovernmentWarehouseProvider: no partner
 * integration, credential, or endpoint exists today, so this always
 * returns an explicit UNAVAILABLE result rather than a fabricated one.
 * WAREHOUSE_PARTNER_PROVIDER_ENABLED/_TIMEOUT_MS/_MAX_RETRIES
 * (config/env.ts) are pre-wired for whenever a real partner is onboarded.
 */
export class UnavailablePartnerWarehouseProvider implements WarehouseDataProvider {
  readonly providerId = "private-partner-unconfigured";
  readonly providerType = "PRIVATE_PARTNER" as const;

  get configured(): boolean {
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
          code: "PARTNER_WAREHOUSE_SOURCE_NOT_CONFIGURED",
          message: env.WAREHOUSE_PARTNER_PROVIDER_ENABLED
            ? "Private partner warehouse source is enabled but no real provider implementation/credentials exist yet."
            : "Private partner warehouse source is not enabled (WAREHOUSE_PARTNER_PROVIDER_ENABLED=false).",
        },
      ],
    };
  }
}
