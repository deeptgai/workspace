#!/usr/bin/env node
import { spawnSync } from "node:child_process";

import { prisma } from "../db/prisma.js";

const baselineMigration = "20260713000100_baseline_existing_schema";

async function tableExists(tableName: string) {
  const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ${tableName}
    ) AS "exists"
  `;

  return Boolean(rows[0]?.exists);
}

async function migrationApplied(migrationName: string) {
  if (!(await tableExists("_prisma_migrations"))) {
    return false;
  }

  const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM "_prisma_migrations"
      WHERE "migration_name" = ${migrationName}
        AND "rolled_back_at" IS NULL
    ) AS "exists"
  `;

  return Boolean(rows[0]?.exists);
}

function resolveApplied(migrationName: string) {
  const result = spawnSync("npx", ["prisma", "migrate", "resolve", "--applied", migrationName], {
    env: process.env,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

try {
  const hasExistingSchema = await tableExists("Source");

  if (hasExistingSchema && !(await migrationApplied(baselineMigration))) {
    console.log(`[db:prepare] Marking existing schema baseline as applied: ${baselineMigration}`);
    resolveApplied(baselineMigration);
  }
} finally {
  await prisma.$disconnect();
}
