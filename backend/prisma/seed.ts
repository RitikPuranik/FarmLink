import { Language, PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/modules/auth/auth.utils";

const prisma = new PrismaClient();

// Development-only demo credentials. Never a real production password, and
// this script is not wired into any production deploy step — run it
// explicitly with `npm run prisma:seed` when you want a demo account.
const DEMO_FARMER = {
  fullName: "Ramesh Patil",
  mobile: "9876543210",
  email: "ramesh.demo@farmlink.test",
  password: "DemoFarmer123!",
  preferredLanguage: "mr" as const,
};

// ---------------------------------------------------------------------------
// Module 2 reference data. Build spec section 7: "For the current SIH
// scope, prioritize Maharashtra, but design the database so other states
// can be added later." A representative set of agricultural
// districts/talukas is seeded — not all ~36 districts of Maharashtra —
// since the point is to exercise the cascading location UI end-to-end,
// not to ship a production gazetteer.
// ---------------------------------------------------------------------------

const MAHARASHTRA_DISTRICTS: Record<string, string[]> = {
  Nashik: ["Niphad", "Dindori", "Chandwad", "Nashik"],
  Pune: ["Haveli", "Baramati", "Junnar"],
  Ahmednagar: ["Rahata", "Shrirampur", "Kopargaon"],
  Solapur: ["Karmala", "Barshi", "Pandharpur"],
  Kolhapur: ["Panhala", "Hatkanangale"],
  "Chhatrapati Sambhajinagar": ["Paithan", "Gangapur"],
  Amravati: ["Achalpur", "Chandur"],
  Nagpur: ["Kamptee", "Hingna"],
};

// Build spec section 17: seed at least this list. Category is a free-text
// grouping label (not a controlled enum — see schema.prisma).
const CROPS: { name: string; category: string; hi: string; mr: string }[] = [
  { name: "Onion", category: "Vegetable", hi: "प्याज़", mr: "कांदा" },
  { name: "Cotton", category: "Fibre", hi: "कपास", mr: "कापूस" },
  { name: "Soybean", category: "Oilseed", hi: "सोयाबीन", mr: "सोयाबीन" },
  { name: "Wheat", category: "Cereal", hi: "गेहूं", mr: "गहू" },
  { name: "Tomato", category: "Vegetable", hi: "टमाटर", mr: "टोमॅटो" },
  { name: "Potato", category: "Vegetable", hi: "आलू", mr: "बटाटा" },
  { name: "Tur", category: "Pulse", hi: "तूर", mr: "तूर" },
  { name: "Rice", category: "Cereal", hi: "चावल", mr: "तांदूळ" },
  { name: "Maize", category: "Cereal", hi: "मक्का", mr: "मका" },
];

async function seedLocations() {
  const maharashtra = await prisma.state.upsert({
    where: { name: "Maharashtra" },
    update: {},
    create: { name: "Maharashtra" },
  });

  const districtIdByName: Record<string, string> = {};
  const talukaIdByName: Record<string, string> = {};

  for (const [districtName, talukaNames] of Object.entries(MAHARASHTRA_DISTRICTS)) {
    const district = await prisma.district.upsert({
      where: { stateId_name: { stateId: maharashtra.id, name: districtName } },
      update: {},
      create: { stateId: maharashtra.id, name: districtName },
    });
    districtIdByName[districtName] = district.id;

    for (const talukaName of talukaNames) {
      const taluka = await prisma.taluka.upsert({
        where: { districtId_name: { districtId: district.id, name: talukaName } },
        update: {},
        create: { districtId: district.id, name: talukaName },
      });
      talukaIdByName[`${districtName}:${talukaName}`] = taluka.id;
    }
  }

  console.log(`Seeded Maharashtra with ${Object.keys(districtIdByName).length} districts.`);
  return { maharashtraId: maharashtra.id, districtIdByName, talukaIdByName };
}

async function seedCrops() {
  const cropIdByName: Record<string, string> = {};

  for (const crop of CROPS) {
    const row = await prisma.crop.upsert({
      where: { name: crop.name },
      update: {},
      create: { name: crop.name, category: crop.category, active: true },
    });
    cropIdByName[crop.name] = row.id;

    for (const [language, localizedName] of [
      ["hi", crop.hi],
      ["mr", crop.mr],
    ] as [Language, string][]) {
      await prisma.cropTranslation.upsert({
        where: { cropId_language: { cropId: row.id, language } },
        update: { localizedName },
        create: { cropId: row.id, language, localizedName },
      });
    }
  }

  console.log(`Seeded ${CROPS.length} crops with Hindi/Marathi translations.`);
  return cropIdByName;
}

async function seedDemoFpo(nashikDistrictId: string) {
  const name = "Nashik Farmers Producer Organization";
  const existing = await prisma.fpo.findFirst({ where: { name, districtId: nashikDistrictId } });
  if (existing) return existing;

  const fpo = await prisma.fpo.create({
    data: { name, districtId: nashikDistrictId, active: true },
  });
  console.log("Seeded demo FPO:", fpo.name);
  return fpo;
}

async function seedDemoFarmer(context: {
  nashikDistrictId: string;
  niphadTalukaId: string;
  maharashtraId: string;
  demoFpoId: string;
  onionCropId: string;
  soybeanCropId: string;
}) {
  const existingUser = await prisma.user.findUnique({ where: { mobile: DEMO_FARMER.mobile } });
  if (existingUser) {
    const existingProfile = await prisma.farmerProfile.findUnique({ where: { userId: existingUser.id } });
    if (existingProfile) {
      console.log("Demo farmer + farmer profile already exist — skipping Module 2 demo data.");
      return;
    }
  }

  // Build spec section 61: fictional demo data only — never real farmer PII.
  const user =
    existingUser ??
    (await prisma.user.create({
      data: {
        fullName: DEMO_FARMER.fullName,
        mobile: DEMO_FARMER.mobile,
        email: DEMO_FARMER.email,
        passwordHash: await hashPassword(DEMO_FARMER.password),
        role: "FARMER",
        accountStatus: "ACTIVE",
        preferredLanguage: DEMO_FARMER.preferredLanguage,
        phoneVerificationStatus: "VERIFIED",
        emailVerificationStatus: "PENDING",
        identityVerificationStatus: "PENDING",
      },
    }));

  const profile = await prisma.farmerProfile.create({
    data: {
      userId: user.id,
      fpoMembershipStatus: "MEMBER",
      fpoId: context.demoFpoId,
      liquidityPreference: "CAN_WAIT_2_WEEKS",
      willingToStore: true,
      communicationPreference: "IN_APP",
    },
  });

  const farm = await prisma.farm.create({
    data: {
      farmerProfileId: profile.id,
      name: "Main Farm",
      village: "Pimpalgaon",
      pincode: "422209",
      stateId: context.maharashtraId,
      districtId: context.nashikDistrictId,
      talukaId: context.niphadTalukaId,
      area: 4.5,
      areaUnit: "ACRE",
      irrigationType: "DRIP",
    },
  });

  await prisma.farmerCrop.create({
    data: {
      farmerProfileId: profile.id,
      farmId: farm.id,
      cropId: context.onionCropId,
      area: 3,
      areaUnit: "ACRE",
      isPrimary: true,
    },
  });
  await prisma.farmerCrop.create({
    data: {
      farmerProfileId: profile.id,
      farmId: farm.id,
      cropId: context.soybeanCropId,
      area: 1.5,
      areaUnit: "ACRE",
      isPrimary: false,
    },
  });

  console.log("Seeded demo farmer profile + farm + crops:", {
    mobile: user.mobile,
    farm: `${farm.village}, ${MAHARASHTRA_DISTRICTS.Nashik ? "Nashik" : ""}, Maharashtra`,
    note: `Demo login password: ${DEMO_FARMER.password} (development only)`,
  });
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    console.log("Refusing to seed demo data in a production environment.");
    return;
  }

  const { maharashtraId, districtIdByName, talukaIdByName } = await seedLocations();
  const cropIdByName = await seedCrops();
  const demoFpo = await seedDemoFpo(districtIdByName.Nashik);

  await seedDemoFarmer({
    nashikDistrictId: districtIdByName.Nashik,
    niphadTalukaId: talukaIdByName["Nashik:Niphad"],
    maharashtraId,
    demoFpoId: demoFpo.id,
    onionCropId: cropIdByName.Onion,
    soybeanCropId: cropIdByName.Soybean,
  });
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
