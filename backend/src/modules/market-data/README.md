# Market data operations

Market prices are stored in canonical INR per quintal. Historical imports are
an operator-only CLI workflow; there is deliberately no dataset upload API.

Run an import with either command:

```bash
npm run market-data:import -- path/to/prices.csv
npm run market:import -- path/to/prices.xlsx
```

CSV, XLS, XLSX, and JSON are supported. CSV files are streamed; JSON must be
an array (or an object containing a `records` array), while Excel files are
read by the workbook parser. Required source values are commodity, market,
state, district, date, min/max/modal price, and a supported unit (`QTL`,
`quintal`, or `kg`). Unknown crops and malformed rows are persisted only as
run diagnostics; they never create crops or fabricated market data.

The optional data.gov.in sync runs at 02:00 Asia/Kolkata only when
`MARKET_SYNC_ENABLED=true` and both `MARKET_DATA_GOV_API_KEY` and
`MARKET_DATA_GOV_RESOURCE_ID` are configured. It uses the configured timeout,
page size, retry and rate-limit values, a Redis lease when Redis is available,
and advances its checkpoint only after imported source data succeeds. Automatic
repair is capped to the recent seven-day window; historical backfill remains a
manual import operation.

Every import and sync creates a `MarketDataImportRun`. Successful writes bump
the versioned market-intelligence cache, so no per-key deletion or coordinate
storage is required.
