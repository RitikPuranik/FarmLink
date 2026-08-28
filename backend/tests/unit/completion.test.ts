import { calculateCompletion } from "../../src/modules/farmers/completion";
import { FarmDTO } from "../../src/modules/farms/farms.types";
import { FarmerCropDTO } from "../../src/modules/crops/crops.types";

function farm(overrides: Partial<FarmDTO> = {}): FarmDTO {
  return {
    id: "farm-1",
    name: null,
    village: "Pimpalgaon",
    pincode: null,
    latitude: null,
    longitude: null,
    state: { id: "s1", name: "Maharashtra" },
    district: { id: "d1", name: "Nashik" },
    taluka: { id: "t1", name: "Niphad" },
    area: 4.5,
    areaUnit: "ACRE",
    irrigationType: "DRIP",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function crop(overrides: Partial<FarmerCropDTO> = {}): FarmerCropDTO {
  return {
    id: "fc-1",
    farmId: "farm-1",
    crop: { id: "c1", name: "Onion", category: "Vegetable", translations: {} },
    area: 2,
    areaUnit: "ACRE",
    isPrimary: false,
    typicalYield: null,
    yieldUnit: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

const emptyProfile = {
  fpoMembershipStatus: null,
  fpoId: null,
  liquidityPreference: null,
  willingToStore: null,
} as const;

describe("calculateCompletion", () => {
  it("a brand-new farmer starts at 20% (basic info only) with everything else missing", () => {
    const result = calculateCompletion({ profile: emptyProfile, farms: [], crops: [] });
    expect(result.percentage).toEqual(20);
    expect(result.missing).toEqual(
      expect.arrayContaining(["farmLocation", "farmInfo", "primaryCrop", "fpoMembership", "sellingPreferences"]),
    );
  });

  it("adding a farm with area + irrigation covers farmLocation and farmInfo (+40%)", () => {
    const result = calculateCompletion({ profile: emptyProfile, farms: [farm()], crops: [] });
    expect(result.percentage).toEqual(60);
    expect(result.missing).not.toContain("farmLocation");
    expect(result.missing).not.toContain("farmInfo");
  });

  it("a farm with irrigation NOT_SPECIFIED still counts for location but not farmInfo", () => {
    const result = calculateCompletion({
      profile: emptyProfile,
      farms: [farm({ irrigationType: "NOT_SPECIFIED" })],
      crops: [],
    });
    expect(result.missing).not.toContain("farmLocation");
    expect(result.missing).toContain("farmInfo");
  });

  it("crops without a designated primary do not satisfy primaryCrop", () => {
    const result = calculateCompletion({ profile: emptyProfile, farms: [], crops: [crop({ isPrimary: false })] });
    expect(result.missing).toContain("primaryCrop");
  });

  it("a designated primary crop satisfies primaryCrop", () => {
    const result = calculateCompletion({ profile: emptyProfile, farms: [], crops: [crop({ isPrimary: true })] });
    expect(result.missing).not.toContain("primaryCrop");
  });

  it("fpoMembership requires fpoId specifically when status is MEMBER", () => {
    const withoutFpoId = calculateCompletion({
      profile: { ...emptyProfile, fpoMembershipStatus: "MEMBER", fpoId: null },
      farms: [],
      crops: [],
    });
    expect(withoutFpoId.missing).toContain("fpoMembership");

    const withFpoId = calculateCompletion({
      profile: { ...emptyProfile, fpoMembershipStatus: "MEMBER", fpoId: "fpo-1" },
      farms: [],
      crops: [],
    });
    expect(withFpoId.missing).not.toContain("fpoMembership");
  });

  it("NOT_A_MEMBER alone (no fpoId needed) satisfies fpoMembership", () => {
    const result = calculateCompletion({
      profile: { ...emptyProfile, fpoMembershipStatus: "NOT_A_MEMBER" },
      farms: [],
      crops: [],
    });
    expect(result.missing).not.toContain("fpoMembership");
  });

  it("sellingPreferences requires both liquidityPreference and willingToStore", () => {
    const onlyOne = calculateCompletion({
      profile: { ...emptyProfile, liquidityPreference: "FLEXIBLE" },
      farms: [],
      crops: [],
    });
    expect(onlyOne.missing).toContain("sellingPreferences");

    const both = calculateCompletion({
      profile: { ...emptyProfile, liquidityPreference: "FLEXIBLE", willingToStore: false },
      farms: [],
      crops: [],
    });
    expect(both.missing).not.toContain("sellingPreferences");
  });

  it("willingToStore=false still counts as answered (false is not 'unset')", () => {
    const result = calculateCompletion({
      profile: { ...emptyProfile, liquidityPreference: "FLEXIBLE", willingToStore: false },
      farms: [],
      crops: [],
    });
    expect(result.missing).not.toContain("sellingPreferences");
  });

  it("a fully completed profile reaches exactly 100%", () => {
    const result = calculateCompletion({
      profile: { fpoMembershipStatus: "MEMBER", fpoId: "fpo-1", liquidityPreference: "CAN_WAIT_2_WEEKS", willingToStore: true },
      farms: [farm()],
      crops: [crop({ isPrimary: true })],
    });
    expect(result.percentage).toEqual(100);
    expect(result.missing).toEqual([]);
  });
});
