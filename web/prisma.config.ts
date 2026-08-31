/**
 * Prisma CLI configuration.
 *
 * Prisma 7 removed `url = env("DATABASE_URL")` from schema.prisma. The
 * connection string lives here for CLI commands (`db push`, `migrate`,
 * `studio`), and is supplied to `PrismaClient` at runtime through a driver
 * adapter in lib/db.ts.
 *
 * This file is loaded by the CLI only - never bundled into the app - but it
 * still reads a secret, so it must not be imported from application code.
 */

import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env.DATABASE_URL ?? "",
  },
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
});
