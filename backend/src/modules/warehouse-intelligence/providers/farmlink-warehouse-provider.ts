import { WarehouseDataProvider, WarehouseProviderRequest, WarehouseProviderResult } from "./warehouse-data-provider";

/**
 * The FarmLink provider represents warehouses already registered directly
 * in FarmLink (created through the existing Warehouse Intelligence module's
 * own create/update flow — Part 1).
 *
 * It deliberately does NOT read the warehouses table and translate rows
 * back into ExternalWarehouseRecord: FarmLink is already the canonical
 * source of truth for its own records, so "fetching" them through this
 * provider only to normalize/validate/upsert them straight back into the
 * same table would be pure ceremony — a warehouse a FarmLink user creates
 * is already correctly persisted, owned, and searchable the moment the
 * existing Part 1 create endpoint returns. There is nothing for a sync run
 * to add.
 *
 * The provider still exists (rather than simply omitting a FARMLINK entry
 * from the registry) so the registry's uniform "one provider per source
 * type, one status per source type" shape holds even for FarmLink, and so
 * a future need (e.g. re-publishing FarmLink warehouses to an external
 * partner feed) has an obvious, already-wired place to grow into instead
 * of inventing a new integration point.
 */
export class FarmLinkWarehouseProvider implements WarehouseDataProvider {
  readonly providerId = "farmlink";
  readonly providerType = "FARMLINK" as const;

  async fetchWarehouses(_request: WarehouseProviderRequest): Promise<WarehouseProviderResult> {
    return {
      provider: { id: this.providerId, type: this.providerType },
      status: "SUCCESS",
      warehouses: [],
      metadata: { fetchedAt: new Date(), recordCount: 0 },
    };
  }
}
