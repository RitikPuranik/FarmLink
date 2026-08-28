Prisma engine binaries could not be fetched in this build sandbox (binaries.prisma.sh
is not reachable from here). Run this once on a machine with normal internet access:

    npm install
    npx prisma generate
    npx prisma migrate dev --name init

Everything else (schema, repository/service code, tests against a mocked repository)
was written and verified without needing the live-generated client.
