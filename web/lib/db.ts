/**
 * Prisma client singleton.
 *
 * Prisma 7 no longer reads the connection string from schema.prisma - the
 * client is constructed with a driver adapter instead. The URL is read here,
 * server-side only; this module must never be imported from a "use client"
 * file.
 *
 * Next.js hot-reloads server modules in development, which would otherwise open
 * a new pool on every edit until Postgres refuses connections. Stashing the
 * client on `globalThis` is the documented workaround.
 */

import "server-only";

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    // Thrown lazily on first query rather than at import time, so a page that
    // does not touch the database still renders.
    throw new Error(
      "DATABASE_URL is not set. Copy web/.env.example to web/.env.local and fill it in."
    );
  }
  // Keep this deployment's tables in their own Postgres schema.
  //
  // The hosted database is shared with another project, so writing into `public`
  // would put Rubric's tables next to an unrelated app's. `DATABASE_SCHEMA`
  // isolates them. It defaults to `public` so a local dev database, which is not
  // shared with anything, behaves exactly as before.
  const schema = process.env.DATABASE_SCHEMA || "public";

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }, { schema }),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new Proxy({} as PrismaClient, {
    // Defer construction until the first property access, so importing this
    // module is free and a missing DATABASE_URL surfaces as a caught query
    // error rather than a build-time crash.
    get(_target, property) {
      const client = (globalForPrisma.prisma ??= createClient());
      const value = Reflect.get(client, property);
      return typeof value === "function" ? value.bind(client) : value;
    },
  });

if (process.env.NODE_ENV !== "production" && globalForPrisma.prisma) {
  globalForPrisma.prisma = globalForPrisma.prisma;
}

/**
 * Prisma returns BigInt for u64 columns, and `JSON.stringify` throws on BigInt.
 * Every API route serializes through this rather than remembering case by case.
 */
export function serializeBigInts<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, v) =>
      typeof v === "bigint" ? v.toString() : v
    )
  );
}
