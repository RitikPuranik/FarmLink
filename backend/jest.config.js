/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: ".",
  roots: ["<rootDir>/tests"],
  setupFiles: ["<rootDir>/tests/setupEnv.ts"],
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { isolatedModules: true }],
  },
  testMatch: ["**/*.test.ts"],
  // *.db.test.ts files talk to a real PostgreSQL database through the
  // generated Prisma Client (needed for genuine concurrency/transaction
  // tests — an in-memory fake can't exercise real row-locking behavior).
  // They're excluded from the default `npm test` run, same as this
  // project's existing convention of not requiring `prisma generate` /
  // a live DATABASE_URL for the default suite (see prisma/README-engines.md).
  // Run them explicitly with `npm run test:db` once you have both set up.
  testPathIgnorePatterns: ["/node_modules/", "\\.db\\.test\\.ts$"],
  clearMocks: true,
};
