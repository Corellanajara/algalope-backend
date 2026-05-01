import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

function addDays(d: Date, n: number) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function getISOWeek(d: Date): { year: number; week: number } {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year: date.getUTCFullYear(), week };
}

async function main() {
  console.log('🌱 Seeding...');

  const tracks = [
    { name: 'Club Hípico de Santiago', city: 'Santiago' },
    { name: 'Hipódromo Chile', city: 'Santiago' },
    { name: 'Valparaíso Sporting Club', city: 'Viña del Mar' },
    { name: 'Club Hípico de Concepción', city: 'Concepción' },
  ];
  for (const t of tracks) {
    await prisma.racetrack.upsert({ where: { name: t.name }, update: {}, create: t });
  }

  const quickAccounts = [
    { email: 'demo@algalope.cl', password: 'demo123', displayName: 'Demo', role: 'USER' },
    { email: 'admin@algalope.cl', password: 'admin123', displayName: 'Administrador', role: 'ADMIN' },
    { email: 'rival@algalope.cl', password: 'rival123', displayName: 'Rival', role: 'USER' },
    { email: 'jorge@algalope.cl', password: 'jorge123', displayName: 'Jorge', role: 'USER' },
    { email: 'maria@algalope.cl', password: 'maria123', displayName: 'María', role: 'USER' },
    { email: 'pedro@algalope.cl', password: 'pedro123', displayName: 'Pedro', role: 'USER' },
    { email: 'ana@algalope.cl', password: 'ana123', displayName: 'Ana', role: 'USER' },
    { email: 'luis@algalope.cl', password: 'luis123', displayName: 'Luis', role: 'USER' },
  ];

  for (const a of quickAccounts) {
    const passwordHash = await bcrypt.hash(a.password, 10);
    await prisma.user.upsert({
      where: { email: a.email },
      update: { displayName: a.displayName, role: a.role, passwordHash },
      create: {
        email: a.email,
        passwordHash,
        displayName: a.displayName,
        role: a.role,
      },
    });
  }

  const now = new Date();
  const { year, week } = getISOWeek(now);
  const raceWeek = await prisma.raceWeek.upsert({
    where: { year_weekNumber: { year, weekNumber: week } },
    update: {},
    create: { year, weekNumber: week, startDate: now, endDate: addDays(now, 7) },
  });

  const allTracks = await prisma.racetrack.findMany();
  const existing = await prisma.program.count({ where: { weekId: raceWeek.id } });

  if (existing === 0) {
    // Programa 1: Club Hípico de Santiago — 3 carreras
    const prog1Date = addDays(now, 2);
    const prog1 = await prisma.program.create({
      data: {
        racetrackId: allTracks.find((t) => t.name === 'Club Hípico de Santiago')!.id,
        weekId: raceWeek.id,
        name: 'Reunión Sábado',
        programDate: prog1Date,
        deadline: new Date(prog1Date.getTime() - 60 * 60 * 1000),
      },
    });
    const p1 = [
      ['Trueno', 'Relámpago', 'Estrella', 'Huracán', 'Sombra'],
      ['Don Carlos', 'Fortuna', 'Majestad', 'Real', 'Duque'],
      ['Centauro', 'Pegaso', 'Bucéfalo', 'Fénix'],
    ];
    for (let i = 0; i < p1.length; i++) {
      const race = await prisma.race.create({
        data: { programId: prog1.id, raceNumber: i + 1 },
      });
      await prisma.horse.createMany({
        data: p1[i].map((name, idx) => ({
          raceId: race.id,
          number: idx + 1,
          name,
          odds: Math.round((2 + Math.random() * 20) * 10) / 10,
        })),
      });
    }

    // Programa 2: Hipódromo Chile — 2 carreras
    const prog2Date = addDays(now, 4);
    const prog2 = await prisma.program.create({
      data: {
        racetrackId: allTracks.find((t) => t.name === 'Hipódromo Chile')!.id,
        weekId: raceWeek.id,
        name: 'Reunión Lunes',
        programDate: prog2Date,
        deadline: new Date(prog2Date.getTime() - 60 * 60 * 1000),
      },
    });
    const p2 = [
      ['Tormenta', 'Viento', 'Luna', 'Cometa', 'Rayo', 'Meteoro'],
      ['Pacífico', 'Costero', 'Marea', 'Arena'],
    ];
    for (let i = 0; i < p2.length; i++) {
      const race = await prisma.race.create({
        data: { programId: prog2.id, raceNumber: i + 1 },
      });
      await prisma.horse.createMany({
        data: p2[i].map((name, idx) => ({
          raceId: race.id,
          number: idx + 1,
          name,
          odds: Math.round((2 + Math.random() * 20) * 10) / 10,
        })),
      });
    }

    console.log(`   ✔ 2 programas / 5 carreras creadas (semana ${week}/${year}).`);
  } else {
    console.log(`   • Semana ${week}/${year} ya tiene programas, no inserto demos.`);
  }

  console.log('✅ Seed completo.');
  console.log('   Cuentas de acceso rápido:');
  for (const a of quickAccounts) {
    console.log(`   • ${a.displayName.padEnd(14)} ${a.email} / ${a.password}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
