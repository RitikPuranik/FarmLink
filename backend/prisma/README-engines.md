Prisma engine binaries could not be fetched in this build sandbox (binaries.prisma.sh
is not reachable from here). Run this once on a machine with normal internet access:

    npm install
    npx prisma generate
    npx prisma migrate dev --name init

Everything else (schema, repository/service code, tests against a mocked repository)
was written and verified without needing the live-generated client.

Module 16 (Logistics Quote & Optimization) hit the exact same wall and follows the
same approach: the schema additions, every repository/service/controller/route file,
and the deterministic engines (Haversine distance, cost estimator, vehicle
eligibility, quote state machine, optimization engine) were all written and the
pure-logic pieces were unit-tested for real (they don't import generated Prisma
types). The Prisma-typed repository/service files could not be type-checked or run
against a live DB here — run the three commands above, then:

    npm run build
    npm test
    npx prisma migrate dev --name add_logistics_module

to verify Module 16's own repository/service code and run its full test suite,
including the accept-quote concurrency test in tests/integration (see
tests/integration/logistics.routes.test.ts and any *.db.test.ts files added for it).
