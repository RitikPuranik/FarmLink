import fixture from "../fixtures/fci-iisfm-depots-with-cap.fixture.json";
import { mapFciDepotToExternalRecord, parseFciDepotsResponse } from "../../src/modules/warehouse-intelligence/providers/fci-iisfm-record-mapper";

describe("parseFciDepotsResponse", () => {
  it("unwraps an array nested under a conventional wrapper key (the fixture's own 'data' key)", () => {
    const { records, issues } = parseFciDepotsResponse(fixture);
    expect(issues).toHaveLength(0);
    expect(records).toHaveLength(3);
  });

  it("accepts a bare top-level array", () => {
    const { records, issues } = parseFciDepotsResponse([{ "Depot Code": "FCI-1" }]);
    expect(issues).toHaveLength(0);
    expect(records).toHaveLength(1);
  });

  it("reports an issue (never a silent empty success) for a response with no recognizable array", () => {
    const { records, issues } = parseFciDepotsResponse({ message: "no depots today" });
    expect(records).toHaveLength(0);
    expect(issues.length).toBeGreaterThan(0);
  });

  it("reports an issue for malformed non-object entries in the list instead of throwing", () => {
    const { records, issues } = parseFciDepotsResponse({ data: [{ "Depot Code": "FCI-1" }, "not an object", 42] });
    expect(records).toHaveLength(1);
    expect(issues.length).toBe(2);
  });
});

describe("mapFciDepotToExternalRecord", () => {
  it("maps Depot Code -> externalId, Depot Name -> name, Revenue State/District -> location", () => {
    const { records } = parseFciDepotsResponse(fixture);
    const mapped = mapFciDepotToExternalRecord(records[0]);
    expect(mapped).toMatchObject({
      externalId: "FCI-DL-001",
      name: "Bijwasan CWC Depot",
      source: { providerId: "fci-iisfm", providerType: "GOVERNMENT" },
    });
    expect(mapped?.location.state).toBe("Delhi");
    expect(mapped?.location.district).toBe("South West Delhi");
  });

  it("maps Total Capacity through as raw text, preserving Covered/Open Capacity as metadata", () => {
    const { records } = parseFciDepotsResponse(fixture);
    const mapped = mapFciDepotToExternalRecord(records[1]);
    expect(mapped?.storage?.totalCapacity).toBe("45000");
    expect(mapped?.metadata).toEqual({ coveredCapacity: "45000", openCapacity: "0" });
  });

  it("never invents a capacity unit when the response names none", () => {
    const { records } = parseFciDepotsResponse(fixture);
    const mapped = mapFciDepotToExternalRecord(records[0]);
    expect(mapped?.storage?.capacityUnit).toBeNull();
  });

  it("resolves a unit if the response itself supplies one", () => {
    const mapped = mapFciDepotToExternalRecord({ "Depot Code": "FCI-9", "Total Capacity": "100", Unit: "MT" });
    expect(mapped?.storage?.capacityUnit).toBe("MT");
  });

  it("never invents coordinates or an address, since the endpoint doesn't provide them", () => {
    const { records } = parseFciDepotsResponse(fixture);
    const mapped = mapFciDepotToExternalRecord(records[0]);
    expect(mapped?.location.latitude).toBeNull();
    expect(mapped?.location.longitude).toBeNull();
    expect(mapped?.location.address).toBeNull();
  });

  it("returns null (drops the record) rather than fabricating an externalId when Depot Code is missing", () => {
    const { records } = parseFciDepotsResponse(fixture);
    const mapped = mapFciDepotToExternalRecord(records[2]);
    expect(mapped).toBeNull();
  });

  it("tolerates camelCase and snake_case key variants for the same fields", () => {
    const camel = mapFciDepotToExternalRecord({ depotCode: "FCI-CAMEL", depotName: "Camel Depot", revenueState: "Bihar", revenueDistrict: "Patna" });
    const snake = mapFciDepotToExternalRecord({ depot_code: "FCI-SNAKE", depot_name: "Snake Depot", revenue_state: "Bihar", revenue_district: "Patna" });
    expect(camel).toMatchObject({ externalId: "FCI-CAMEL", name: "Camel Depot" });
    expect(snake).toMatchObject({ externalId: "FCI-SNAKE", name: "Snake Depot" });
  });
});
