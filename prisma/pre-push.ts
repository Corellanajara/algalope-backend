// Idempotent SQL renames so `prisma db push` can apply the new schema in
// place instead of failing on incompatible changes.
//
// Why this exists: the schema renamed `Program` → `Reunion`, `programDate` →
// `reunionDate`, `Race.programId` → `Race.reunionId`, and dropped `Payment`.
// Without these renames, `db push` sees them as drop+create and refuses on a
// non-empty DB.
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

async function main() {
  console.log('🔧 Pre-push: aplicando renombres idempotentes…');

  // 1) Drop legacy Payment table (already removed from schema).
  if (await tableExists('Payment')) {
    await exec('DROP TABLE IF EXISTS "Payment" CASCADE');
  }

  // 2) Rename Program → Reunion (table + sequence + PK + indexes are renamed
  //    automatically with the table in PostgreSQL >= 9).
  if ((await tableExists('Program')) && !(await tableExists('Reunion'))) {
    await exec('ALTER TABLE "Program" RENAME TO "Reunion"');
  }

  // 3) Rename column programDate → reunionDate on Reunion.
  if ((await tableExists('Reunion')) && (await columnExists('Reunion', 'programDate'))) {
    await exec('ALTER TABLE "Reunion" RENAME COLUMN "programDate" TO "reunionDate"');
  }

  // 4) Rename column Race.programId → Race.reunionId.
  if ((await tableExists('Race')) && (await columnExists('Race', 'programId'))) {
    await exec('ALTER TABLE "Race" RENAME COLUMN "programId" TO "reunionId"');
  }

  // 5) Programa: weekId → reunionId. The mapping from a (user, week) payment
  //    to a single reunion of that week is ambiguous, so we drop the table and
  //    let `db push` recreate it. Existing payment rows are lost — same outcome
  //    as the migration.sql, but compatible with the db-push deploy flow.
  if (
    (await tableExists('Programa')) &&
    (await columnExists('Programa', 'weekId')) &&
    !(await columnExists('Programa', 'reunionId'))
  ) {
    await exec('DROP TABLE IF EXISTS "Programa" CASCADE');
  }

  console.log('✅ Pre-push completo.');
}

main()
  .catch((e) => {
    console.error('Pre-push falló:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
