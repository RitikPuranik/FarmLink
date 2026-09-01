import { env } from "../../config/env";
import { MarketDomainError } from "../../common/errors";
import { SourceMarketRecord } from "./market-data.service";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Provider adapter: keeps data.gov.in response conventions outside domain code. */
export class DataGovMarketProvider {
  get configured() { return Boolean(env.MARKET_DATA_GOV_API_KEY && env.MARKET_DATA_GOV_RESOURCE_ID); }

  private async fetchPage(offset: number, from?: Date): Promise<Record<string, string>[]> {
    const url = new URL(`${env.MARKET_DATA_GOV_BASE_URL.replace(/\/$/, "")}/${env.MARKET_DATA_GOV_RESOURCE_ID}`);
    url.searchParams.set("api-key", env.MARKET_DATA_GOV_API_KEY);
    url.searchParams.set("format", "json");
    url.searchParams.set("limit", String(env.MARKET_DATA_GOV_PAGE_SIZE));
    url.searchParams.set("offset", String(offset));
    // This is a lower bound only; source-side sorting is not assumed.
    if (from) url.searchParams.set("filters[arrival_date]", from.toISOString().slice(0, 10));

    let failure: unknown;
    for (let attempt = 0; attempt <= env.MARKET_DATA_GOV_MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(env.MARKET_DATA_GOV_TIMEOUT_MS) });
        if (response.ok) {
          const body = await response.json() as { records?: unknown };
          if (!Array.isArray(body.records)) throw new MarketDomainError("Provider returned a malformed page.", "MARKET_DATA_PROVIDER_ERROR", 502);
          return body.records.filter((row): row is Record<string, string> => Boolean(row) && typeof row === "object");
        }
        if (![408, 429, 500, 502, 503, 504].includes(response.status)) throw new MarketDomainError(`Provider request failed (${response.status}).`, "MARKET_DATA_PROVIDER_ERROR", 502);
        failure = new Error(`Transient provider response ${response.status}`);
      } catch (error) { failure = error; }
      if (attempt < env.MARKET_DATA_GOV_MAX_RETRIES) await sleep((2 ** attempt) * 250);
    }
    throw new MarketDomainError(failure instanceof Error ? failure.message : "Market data provider is unavailable.", "MARKET_DATA_PROVIDER_ERROR", 502);
  }

  async *records(from?: Date): AsyncGenerator<SourceMarketRecord> {
    if (!this.configured) return;
    let offset = 0;
    for (;;) {
      const rows = await this.fetchPage(offset, from);
      for (const row of rows) {
        const text = (...keys: string[]) => keys.map((key) => row[key]).find((value) => value !== undefined && value !== null && value !== "") ?? "";
        const number = (...keys: string[]) => Number(text(...keys));
        const date = text("arrival_date", "date");
        if (!date) continue; // persisted importer diagnostics handle all other malformed rows.
        yield {
          source: "data.gov.in",
          sourceRecordId: text("id", "_id") || undefined,
          observedDate: new Date(date),
          commodity: text("commodity", "crop"),
          marketId: text("market_id", "market_code") || undefined,
          mandiName: text("market", "mandi"),
          state: text("state"), district: text("district"),
          minPrice: number("min_price", "minPrice"), maxPrice: number("max_price", "maxPrice"), modalPrice: number("modal_price", "modalPrice"),
          priceUnit: "QTL", arrivals: null, metadata: { resourceId: env.MARKET_DATA_GOV_RESOURCE_ID, offset },
        };
      }
      if (rows.length < env.MARKET_DATA_GOV_PAGE_SIZE) break;
      offset += rows.length;
      if (env.MARKET_DATA_GOV_RATE_LIMIT_MS) await sleep(env.MARKET_DATA_GOV_RATE_LIMIT_MS);
    }
  }
}
