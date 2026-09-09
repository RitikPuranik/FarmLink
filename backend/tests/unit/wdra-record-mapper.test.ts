import { mapWdraCsvRowToExternalRecord, WDRA_PROVIDER_ID } from "../../src/modules/warehouse-intelligence/wdra-record-mapper";

function row(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    "WHM Name": "ABC Warehousing Corp",
    "WH Name": "ABC Cold Storage",
    "WH ID": "WDRA-001",
    Address: "Plot 12, MIDC",
    District: "Nashik",
    State: "Maharashtra",
    "Capacity(in MT)": "500",
    "Registration Date": "2020-04-01",
    "Registration Valid Upto": "2027-03-31",
    "Contact No.": "9999999999",
    Status: "Active",
    Remarks: "",
    ...overrides,
  };
}

describe("mapWdraCsvRowToExternalRecord", () => {
  it("maps every documented column to its target field (WH ID -> externalId, WH Name -> name, ...)", () => {
    const record = mapWdraCsvRowToExternalRecord(row());

    expect(record.externalId).toBe("WDRA-001");
    expect(record.source).toEqual({ providerId: WDRA_PROVIDER_ID, providerType: "GOVERNMENT" });
    expect(record.name).toBe("ABC Cold Storage");
    expect(record.location.address).toBe("Plot 12, MIDC");
    expect(record.location.district).toBe("Nashik");
    expect(record.location.state).toBe("Maharashtra");
    expect(record.location.latitude).toBeNull();
    expect(record.location.longitude).toBeNull();
  });

  it("passes capacity through as raw text with a fixed MT unit for the shared MT -> KG conversion", () => {
    const record = mapWdraCsvRowToExternalRecord(row({ "Capacity(in MT)": "1250.5" }));
    expect(record.storage?.totalCapacity).toBe("1250.5");
    expect(record.storage?.capacityUnit).toBe("MT");
  });

  it("never fabricates a capacity unit for a genuinely empty capacity cell", () => {
    const record = mapWdraCsvRowToExternalRecord(row({ "Capacity(in MT)": "" }));
    expect(record.storage?.totalCapacity).toBeNull();
    expect(record.storage?.capacityUnit).toBeNull();
  });

  it.each([
    ["Active", "Active"],
    [" inactive ", "inactive"],
    ["SUSPENDED", "SUSPENDED"],
  ])("passes the raw status text %s through unchanged for the shared normalizer to map", (input) => {
    const record = mapWdraCsvRowToExternalRecord(row({ Status: input }));
    expect(record.status).toBe(input.trim());
  });

  it("never guesses a storage type, since WDRA does not reliably report one", () => {
    const record = mapWdraCsvRowToExternalRecord(row());
    expect(record.storage?.storageType).toBeNull();
  });

  it("preserves WHM Name/Registration Date/Registration Valid Upto/Contact No./Remarks as metadata instead of discarding them", () => {
    const record = mapWdraCsvRowToExternalRecord(
      row({
        "WHM Name": "XYZ Warehousing",
        "Registration Date": "2019-01-15",
        "Registration Valid Upto": "2026-01-14",
        "Contact No.": "9812345678",
        Remarks: "Renewal pending",
      }),
    );
    expect(record.metadata).toEqual({
      whmName: "XYZ Warehousing",
      registrationDate: "2019-01-15",
      registrationValidUpto: "2026-01-14",
      contactNo: "9812345678",
      remarks: "Renewal pending",
    });
  });

  it("leaves missing optional metadata as null rather than omitting the keys or guessing values", () => {
    const record = mapWdraCsvRowToExternalRecord(
      row({ "WHM Name": undefined, "Registration Date": "", "Registration Valid Upto": undefined, "Contact No.": "", Remarks: undefined }),
    );
    expect(record.metadata).toEqual({
      whmName: null,
      registrationDate: null,
      registrationValidUpto: null,
      contactNo: null,
      remarks: null,
    });
  });

  it("produces an empty externalId (never a fabricated one) for a row missing WH ID, for validation to reject", () => {
    const record = mapWdraCsvRowToExternalRecord(row({ "WH ID": "" }));
    expect(record.externalId).toBe("");
  });
});
