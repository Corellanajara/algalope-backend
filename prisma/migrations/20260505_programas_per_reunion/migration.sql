-- Migrate Programa from per-week to per-reunion.
-- WARNING: existing Programa rows are dropped because there is no 1:1 mapping
-- from a (user, week) payment to a single reunion in that week.

DROP TABLE "Programa";

CREATE TABLE "Programa" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "reunionId" INTEGER NOT NULL,
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "paidAt" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "Programa_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Programa_userId_reunionId_key" ON "Programa"("userId", "reunionId");

ALTER TABLE "Programa" ADD CONSTRAINT "Programa_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Programa" ADD CONSTRAINT "Programa_reunionId_fkey"
    FOREIGN KEY ("reunionId") REFERENCES "Reunion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
