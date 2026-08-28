import { PrismaClient } from "@prisma/client";
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

async function main() {
  if (process.env.NODE_ENV === "production") {
    console.log("Refusing to seed demo data in a production environment.");
    return;
  }

  const existing = await prisma.user.findUnique({ where: { mobile: DEMO_FARMER.mobile } });
  if (existing) {
    console.log("Demo farmer already exists — skipping.");
    return;
  }

  const passwordHash = await hashPassword(DEMO_FARMER.password);

  const user = await prisma.user.create({
    data: {
      fullName: DEMO_FARMER.fullName,
      mobile: DEMO_FARMER.mobile,
      email: DEMO_FARMER.email,
      passwordHash,
      role: "FARMER",
      accountStatus: "ACTIVE",
      preferredLanguage: DEMO_FARMER.preferredLanguage,
      phoneVerificationStatus: "VERIFIED",
      emailVerificationStatus: "PENDING",
      identityVerificationStatus: "PENDING",
    },
  });

  console.log("Seeded demo farmer:", {
    mobile: user.mobile,
    role: user.role,
    note: `Demo login password: ${DEMO_FARMER.password} (development only)`,
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
