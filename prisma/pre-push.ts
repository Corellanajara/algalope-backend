// Idempotent SQL renames so `prisma db push` can apply the new schema in
// place instead of failing on incompatible changes.
//
// Why this exists: the schema renamed `Program` → `Reunion`, `programDate` →
// `reunionDate`, `Race.programId` → `Race.reunionId`, dropped `Payment`, and
// later added multi-tenant ownership (`adminId` columns on User, Racetrack,
// RaceWeek and Reunion). Without these renames, `db push` sees them as
// drop+create and refuses on a non-empty DB.
//
// Each block uses IF EXISTS / IF NOT EXISTS so it's safe to re-run.

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function exec(sql: string) {
  try {
    await prisma.$executeRawUnsafe(sql);
    console.log('   ✔', sql.replace(/\s+/g, ' ').slice(0, 120));
  } catch (e: any) {
    console.log('   • skip:', sql.replace(/\s+/g, ' ').slice(0, 80), '·', e.message?.split('\n')[0]);
  }
}

async function tableExists(name: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1) AS exists`,
    name,
  );
  return rows[0]?.exists ?? false;
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2) AS exists`,
    table,
    column,
  );
  return rows[0]?.exists ?? false;
}

async function indexExists(name: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
    `SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname=$1) AS exists`,
    name,
  );
  return rows[0]?.exists ?? false;
}

async function main() {
  console.log('🔧 Pre-push: aplicando renombres idempotentes…');

  // 1) Drop legacy Payment table (already removed from schema).
  if (await tableExists('Payment')) {
    await exec('DROP TABLE IF EXISTS "Payment" CASCADE');
  }

  // 2) Rename Program → Reunion.
  if ((await tableExists('Program')) && !(await tableExists('Reunion'))) {
    await exec('ALTER TABLE "Program" RENAME TO "Reunion"');
  }
  if ((await tableExists('Reunion')) && (await columnExists('Reunion', 'programDate'))) {
    await exec('ALTER TABLE "Reunion" RENAME COLUMN "programDate" TO "reunionDate"');
  }
  if ((await tableExists('Race')) && (await columnExists('Race', 'programId'))) {
    await exec('ALTER TABLE "Race" RENAME COLUMN "programId" TO "reunionId"');
  }
  if (
    (await tableExists('Programa')) &&
    (await columnExists('Programa', 'weekId')) &&
    !(await columnExists('Programa', 'reunionId'))
  ) {
    await exec('DROP TABLE IF EXISTS "Programa" CASCADE');
  }

  // 3) Multi-tenant: add adminId columns (nullable) where missing.
  if ((await tableExists('User')) && !(await columnExists('User', 'adminId'))) {
    await exec('ALTER TABLE "User" ADD COLUMN "adminId" INTEGER');
  }
  if ((await tableExists('Racetrack')) && !(await columnExists('Racetrack', 'adminId'))) {
    await exec('ALTER TABLE "Racetrack" ADD COLUMN "adminId" INTEGER');
  }
  if ((await tableExists('RaceWeek')) && !(await columnExists('RaceWeek', 'adminId'))) {
    await exec('ALTER TABLE "RaceWeek" ADD COLUMN "adminId" INTEGER');
  }
  if ((await tableExists('Reunion')) && !(await columnExists('Reunion', 'adminId'))) {
    await exec('ALTER TABLE "Reunion" ADD COLUMN "adminId" INTEGER');
  }

  // 4) The `name` column in Racetrack used to be globally unique; now it is
  //    unique per (adminId, name). Drop the old single-column unique if present.
  if (await indexExists('Racetrack_name_key')) {
    await exec('ALTER TABLE "Racetrack" DROP CONSTRAINT IF EXISTS "Racetrack_name_key"');
    await exec('DROP INDEX IF EXISTS "Racetrack_name_key"');
  }
  // RaceWeek (year, weekNumber) was unique; now it's unique per (adminId, year, weekNumber).
  if (await indexExists('RaceWeek_year_weekNumber_key')) {
    await exec('ALTER TABLE "RaceWeek" DROP CONSTRAINT IF EXISTS "RaceWeek_year_weekNumber_key"');
    await exec('DROP INDEX IF EXISTS "RaceWeek_year_weekNumber_key"');
  }

  console.log('✅ Pre-push completo.');
}

main()
  .catch((e) => {
    console.error('Pre-push falló:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
