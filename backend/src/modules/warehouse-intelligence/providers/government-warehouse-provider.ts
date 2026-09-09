import { env } from "../../../config/env";
import { WarehouseDataProvider, WarehouseProviderRequest, WarehouseProviderResult } from "./warehouse-data-provider";

/**
 * Boundary for a government warehouse data source with no real,
 * documented, integrable endpoint.
 *
 * The GOVERNMENT provider slot in app.ts's WarehouseProviderRegistry is
 * now filled by FciIisfmWarehouseProvider (a real integration against
 * https://api.iisfm.nic.in/DepotsWithCap) plus the separate one-time
 * WDRA CSV importer (wdra-csv-import.ts) — so this class is no longer
 * registered there. It's kept as the honest-UNAVAILABLE template for a
 * *second* government source that genuinely has no integrable endpoint
 * yet (e.g. NABARD, explicitly out of scope for the FCI/WDRA work — see
 * docs/modules/module-09-warehouse-intelligence.md). Registering a second
 * instance of this class would need its own provider slot/id, since the
 * registry now has a real GOVERNMENT provider filling that role.
 *
 * fetchWarehouses() always returns an explicit UNAVAILABLE result rather
 * than fabricating data. This is intentionally NOT a system failure:
 * WarehouseProviderRegistry treats UNAVAILABLE the same as "provider not
 * enabled", never as an error to surface, retry, or alert on.
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
