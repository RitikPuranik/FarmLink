import { env } from "../../../config/env";
import { logger } from "../../../config/logger";
import {
  ExternalWarehouseRecord,
  WarehouseDataProvider,
  WarehouseProviderRequest,
  WarehouseProviderResult,
  WarehouseProviderStatus,
} from "./warehouse-data-provider";
import { mapFciDepotToExternalRecord, parseFciDepotsResponse } from "./fci-iisfm-record-mapper";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Reasonable response-size protection (Part 5) — a public government JSON
// endpoint returning tens of megabytes for a depot list would indicate
// something is wrong; refuse to buffer/parse past this rather than let one
// bad response exhaust memory.
const MAX_RESPONSE_BYTES = 20 * 1024 * 1024;

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

/**
 * The real FCI/IISFM government warehouse provider — replaces
 * UnavailableGovernmentWarehouseProvider in the GOVERNMENT provider slot
 * (app.ts) now that a real, documented public endpoint exists to
 * integrate against: https://api.iisfm.nic.in/DepotsWithCap.
 *
 * Response shape caveat (read fci-iisfm-record-mapper.ts's header
 * comment first): the live JSON shape could not be captured from this
 * codebase's build environment (direct fetch blocked by the endpoint's
 * robots.txt; no public documentation of this specific endpoint's body
 * was found). This provider is built to be tolerant of several plausible
 * shapes rather than a single guessed one, and fails closed (a FAILED
 * result, never fabricated records) if the response matches none of
 * them — see parseFciDepotsResponse.
 */
export class FciIisfmWarehouseProvider implements WarehouseDataProvider {
  readonly providerId = "fci-iisfm";
  readonly providerType = "GOVERNMENT" as const;

  /** Reuses the shared WAREHOUSE_GOVERNMENT_PROVIDER_ENABLED flag rather
   * than a bespoke FCI-only toggle — there is exactly one GOVERNMENT
   * provider slot in the registry today, so one flag is enough; a second
   * government source (e.g. a future NABARD provider, explicitly out of
   * scope for this task) would need its own slot and its own flag. */
  get configured(): boolean {
    return env.WAREHOUSE_GOVERNMENT_PROVIDER_ENABLED;
  }

  private get endpointUrl(): string {
    const base = env.FCI_IISFM_API_BASE_URL.replace(/\/+$/, "");
    const path = env.FCI_IISFM_DEPOTS_ENDPOINT.startsWith("/") ? env.FCI_IISFM_DEPOTS_ENDPOINT : `/${env.FCI_IISFM_DEPOTS_ENDPOINT}`;
    return `${base}${path}`;
  }

  async fetchWarehouses(_request: WarehouseProviderRequest): Promise<WarehouseProviderResult> {
    const fetchedAt = new Date();

    if (!this.configured) {
      return {
        provider: { id: this.providerId, type: this.providerType },
        status: "UNAVAILABLE",
        warehouses: [],
        metadata: { fetchedAt, recordCount: 0 },
        errors: [
          {
            code: "FCI_IISFM_SOURCE_NOT_CONFIGURED",
            message: "FCI/IISFM government warehouse source is not enabled (WAREHOUSE_GOVERNMENT_PROVIDER_ENABLED=false).",
          },
        ],
      };
    }

    let body: unknown;
    try {
      body = await this.fetchDepotsWithRetry();
    } catch (err) {
      // Never a raw payload or credential in this log line — just the
      // failure reason (Part 5: "no secrets in logs").
      logger.error({ err, providerId: this.providerId, endpoint: this.endpointUrl }, "FCI/IISFM depot fetch failed");
      return {
        provider: { id: this.providerId, type: this.providerType },
        status: "FAILED",
        warehouses: [],
        metadata: { fetchedAt, recordCount: 0 },
        errors: [
          {
            code: "FCI_IISFM_FETCH_FAILED",
            message: err instanceof Error ? err.message : "Unknown FCI/IISFM fetch failure.",
          },
        ],
      };
    }

    const { records: rawDepots, issues } = parseFciDepotsResponse(body);
    if (rawDepots.length === 0 && issues.length) {
      return {
        provider: { id: this.providerId, type: this.providerType },
        status: "FAILED",
        warehouses: [],
        metadata: { fetchedAt, recordCount: 0 },
        errors: [{ code: "FCI_IISFM_MALFORMED_RESPONSE", message: issues.join("; ").slice(0, 500) }],
      };
    }

    const warehouses: ExternalWarehouseRecord[] = [];
    let droppedForMissingCode = 0;
    for (const depot of rawDepots) {
      const mapped = mapFciDepotToExternalRecord(depot);
      if (mapped) warehouses.push(mapped);
      else droppedForMissingCode += 1;
    }

    const status: WarehouseProviderStatus =
      droppedForMissingCode > 0 && warehouses.length > 0
        ? "PARTIAL"
        : droppedForMissingCode > 0 && warehouses.length === 0
          ? "FAILED"
          : "SUCCESS";

    return {
      provider: { id: this.providerId, type: this.providerType },
      status,
      warehouses,
      metadata: { fetchedAt, recordCount: warehouses.length },
      errors: droppedForMissingCode
        ? [{ code: "FCI_IISFM_RECORDS_MISSING_DEPOT_CODE", message: `${droppedForMissingCode} depot record(s) had no usable Depot Code and were dropped before normalization.` }]
        : undefined,
    };
  }

  /** Bounded retries with exponential backoff (Part 5), fails fast on a
   * non-retryable (e.g. 4xx other than 408/429) response instead of
   * burning through retries on something that will never succeed. */
  private async fetchDepotsWithRetry(): Promise<unknown> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= env.WAREHOUSE_GOVERNMENT_PROVIDER_MAX_RETRIES; attempt++) {
      let response: Response;
      try {
        response = await fetch(this.endpointUrl, {
          signal: AbortSignal.timeout(env.WAREHOUSE_GOVERNMENT_PROVIDER_TIMEOUT_MS),
          headers: { Accept: "application/json" },
        });
      } catch (err) {
        // Network error / timeout — retryable.
        lastError = err;
        if (attempt < env.WAREHOUSE_GOVERNMENT_PROVIDER_MAX_RETRIES) {
          await sleep(2 ** attempt * 250);
          continue;
        }
        break;
      }

      if (response.ok) {
        return this.readJsonBody(response);
      }

      if (!RETRYABLE_STATUSES.has(response.status)) {
        throw new Error(`FCI/IISFM request failed with non-retryable status ${response.status}.`);
      }

      lastError = new Error(`Transient FCI/IISFM response ${response.status}`);
      if (attempt < env.WAREHOUSE_GOVERNMENT_PROVIDER_MAX_RETRIES) {
        await sleep(2 ** attempt * 250);
      }
    }

    throw lastError instanceof Error ? lastError : new Error("FCI/IISFM depots endpoint is unavailable.");
  }

  private async readJsonBody(response: Response): Promise<unknown> {
    const contentLength = response.headers.get("content-length");
    if (contentLength && Number(contentLength) > MAX_RESPONSE_BYTES) {
      throw new Error(`FCI/IISFM response declared ${contentLength} bytes, exceeding the ${MAX_RESPONSE_BYTES}-byte limit; refusing to parse.`);
    }

    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) {
      throw new Error(`FCI/IISFM response body exceeded the ${MAX_RESPONSE_BYTES}-byte limit; refusing to parse.`);
    }

    try {
      return JSON.parse(text);
    } catch {
      throw new Error("FCI/IISFM response was not valid JSON.");
    }
  }
}
