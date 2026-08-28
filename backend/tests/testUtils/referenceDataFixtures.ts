// Fixed ids (not randomUUID()) so tests can reference "Nashik" or "Onion"
// by a stable constant instead of looking them up first. Mirrors the shape
// (not the literal ids — those are DB-generated) that prisma/seed.ts loads
// into a real database.

export const MAHARASHTRA_STATE_ID = "11111111-1111-1111-1111-111111111111";

export const NASHIK_DISTRICT_ID = "22222222-2222-2222-2222-222222222221";
export const PUNE_DISTRICT_ID = "22222222-2222-2222-2222-222222222222";

export const NIPHAD_TALUKA_ID = "33333333-3333-3333-3333-333333333331";
export const DINDORI_TALUKA_ID = "33333333-3333-3333-3333-333333333332";
export const HAVELI_TALUKA_ID = "33333333-3333-3333-3333-333333333333";

export const ONION_CROP_ID = "44444444-4444-4444-4444-444444444441";
export const SOYBEAN_CROP_ID = "44444444-4444-4444-4444-444444444442";
export const COTTON_CROP_ID = "44444444-4444-4444-4444-444444444443";
export const INACTIVE_CROP_ID = "44444444-4444-4444-4444-444444444444";

export const DEMO_FPO_ID = "55555555-5555-5555-5555-555555555551";
export const INACTIVE_FPO_ID = "55555555-5555-5555-5555-555555555552";

export const FIXTURE_STATES = [{ id: MAHARASHTRA_STATE_ID, name: "Maharashtra" }];

export const FIXTURE_DISTRICTS = [
  { id: NASHIK_DISTRICT_ID, stateId: MAHARASHTRA_STATE_ID, name: "Nashik" },
  { id: PUNE_DISTRICT_ID, stateId: MAHARASHTRA_STATE_ID, name: "Pune" },
];

export const FIXTURE_TALUKAS = [
  { id: NIPHAD_TALUKA_ID, districtId: NASHIK_DISTRICT_ID, name: "Niphad" },
  { id: DINDORI_TALUKA_ID, districtId: NASHIK_DISTRICT_ID, name: "Dindori" },
  { id: HAVELI_TALUKA_ID, districtId: PUNE_DISTRICT_ID, name: "Haveli" },
];

export const FIXTURE_CROPS = [
  { id: ONION_CROP_ID, name: "Onion", category: "Vegetable", active: true },
  { id: SOYBEAN_CROP_ID, name: "Soybean", category: "Oilseed", active: true },
  { id: COTTON_CROP_ID, name: "Cotton", category: "Fibre", active: true },
  { id: INACTIVE_CROP_ID, name: "Discontinued Crop", category: "Other", active: false },
];

export const FIXTURE_CROP_TRANSLATIONS = [
  { cropId: ONION_CROP_ID, language: "hi", localizedName: "प्याज़" },
  { cropId: ONION_CROP_ID, language: "mr", localizedName: "कांदा" },
  { cropId: SOYBEAN_CROP_ID, language: "hi", localizedName: "सोयाबीन" },
  { cropId: SOYBEAN_CROP_ID, language: "mr", localizedName: "सोयाबीन" },
];

export const FIXTURE_FPOS = [
  { id: DEMO_FPO_ID, name: "Nashik Farmers Producer Organization", districtId: NASHIK_DISTRICT_ID, active: true },
  { id: INACTIVE_FPO_ID, name: "Retired FPO", districtId: NASHIK_DISTRICT_ID, active: false },
];
