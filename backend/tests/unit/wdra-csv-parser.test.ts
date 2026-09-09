import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { csvColumns, readCsvRows } from "../../src/modules/warehouse-intelligence/wdra-csv-parser";

describe("csvColumns", () => {
  it("splits a simple comma-separated line", () => {
    expect(csvColumns("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("keeps a comma inside a quoted field as part of that field", () => {
    expect(csvColumns('WH-1,"Plot 12, MIDC, Nashik",Maharashtra')).toEqual(["WH-1", "Plot 12, MIDC, Nashik", "Maharashtra"]);
  });

  it("unescapes a doubled quote inside a quoted field", () => {
    expect(csvColumns('WH-1,"The ""Best"" Warehouse",Maharashtra')).toEqual(["WH-1", 'The "Best" Warehouse', "Maharashtra"]);
  });

  it("trims surrounding whitespace on unquoted cells", () => {
    expect(csvColumns("  a  , b ,c  ")).toEqual(["a", "b", "c"]);
  });
});

describe("readCsvRows", () => {
  function writeTempCsv(content: string): string {
    const file = path.join(os.tmpdir(), `wdra-test-${Date.now()}-${Math.random().toString(36).slice(2)}.csv`);
    fs.writeFileSync(file, content, "utf8");
    return file;
  }

  async function collect(filePath: string) {
    const rows: Record<string, string | undefined>[] = [];
    for await (const row of readCsvRows(filePath)) rows.push(row);
    return rows;
  }

  it("keys each data row by the header row", async () => {
    const file = writeTempCsv("WH ID,WH Name,State\nWDRA-1,ABC Cold Storage,Maharashtra\nWDRA-2,XYZ Godown,Punjab\n");
    const rows = await collect(file);
    expect(rows).toEqual([
      { "WH ID": "WDRA-1", "WH Name": "ABC Cold Storage", State: "Maharashtra" },
      { "WH ID": "WDRA-2", "WH Name": "XYZ Godown", State: "Punjab" },
    ]);
  });

  it("strips a UTF-8 BOM from the first header only", async () => {
    const file = writeTempCsv("\uFEFFWH ID,WH Name\nWDRA-1,ABC\n");
    const rows = await collect(file);
    expect(rows).toEqual([{ "WH ID": "WDRA-1", "WH Name": "ABC" }]);
  });

  it("skips blank lines rather than treating them as empty rows", async () => {
    const file = writeTempCsv("WH ID,WH Name\nWDRA-1,ABC\n\nWDRA-2,XYZ\n");
    const rows = await collect(file);
    expect(rows).toHaveLength(2);
  });

  it("fills a short row's missing trailing columns with undefined instead of throwing", async () => {
    const file = writeTempCsv("WH ID,WH Name,State\nWDRA-1,ABC\n");
    const rows = await collect(file);
    expect(rows).toEqual([{ "WH ID": "WDRA-1", "WH Name": "ABC", State: undefined }]);
  });
});
