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

async function upsertUser(opts: {
  email: string;
  password: string;
  displayName: string;
  role: 'SUPERADMIN' | 'ADMIN' | 'USER';
  adminId?: number | null;
}) {
  const passwordHash = await bcrypt.hash(opts.password, 10);
  return prisma.user.upsert({
    where: { email: opts.email },
    update: {
      displayName: opts.displayName,
      role: opts.role,
      passwordHash,
      adminId: opts.adminId ?? null,
    },
    create: {
      email: opts.email,
      passwordHash,
      displayName: opts.displayName,
      role: opts.role,
      adminId: opts.adminId ?? null,
    },
  });
}

async function main() {
  console.log('🌱 Seeding...');

  // 1) SUPERADMIN por defecto. No pertenece a ningún tenant (adminId null)
  //    y puede ver/operar todo lo que ven los ADMIN.
  await upsertUser({
    email: 'superadmin@algalope.cl',
    password: 'superadmin123',
    displayName: 'Super Administrador',
    role: 'SUPERADMIN',
    adminId: null,
  });

  // 2) ADMIN demo. Es dueño del tenant demo: las reuniones, racetracks y
  //    usuarios siguientes se cuelgan de su id.
  const admin = await upsertUser({
    email: 'admin@algalope.cl',
    password: 'admin123',
    displayName: 'Administrador',
    role: 'ADMIN',
    adminId: null,
  });

  // 3) USERs demo, todos dentro del tenant del ADMIN demo.
  const demoUsers = [
    { email: 'demo@algalope.cl', password: 'demo123', displayName: 'Demo' },
    { email: 'rival@algalope.cl', password: 'rival123', displayName: 'Rival' },
    { email: 'jorge@algalope.cl', password: 'jorge123', displayName: 'Jorge' },
    { email: 'maria@algalope.cl', password: 'maria123', displayName: 'María' },
    { email: 'pedro@algalope.cl', password: 'pedro123', displayName: 'Pedro' },
    { email: 'ana@algalope.cl', password: 'ana123', displayName: 'Ana' },
    { email: 'luis@algalope.cl', password: 'luis123', displayName: 'Luis' },
  ];
  for (const u of demoUsers) {
    await upsertUser({ ...u, role: 'USER', adminId: admin.id });
  }

  // 4) Racetracks demo, vinculados al tenant del ADMIN demo. La unicidad de
  //    Racetrack es (adminId, name) así que upserteamos por esa clave.
  const tracks = [
    { name: 'Club Hípico de Santiago', city: 'Santiago' },
    { name: 'Hipódromo Chile', city: 'Santiago' },
    { name: 'Valparaíso Sporting Club', city: 'Viña del Mar' },
    { name: 'Club Hípico de Concepción', city: 'Concepción' },
  ];
  for (const t of tracks) {
    await prisma.racetrack.upsert({
      where: { adminId_name: { adminId: admin.id, name: t.name } },
      update: { city: t.city },
      create: { ...t, adminId: admin.id },
    });
  }

  const now = new Date();
  const { year, week } = getISOWeek(now);
  const raceWeek = await prisma.raceWeek.upsert({
    where: { adminId_year_weekNumber: { adminId: admin.id, year, weekNumber: week } },
    update: {},
    create: {
      adminId: admin.id,
      year,
      weekNumber: week,
      startDate: now,
      endDate: addDays(now, 7),
    },
  });

  const adminTracks = await prisma.racetrack.findMany({ where: { adminId: admin.id } });
  const existing = await prisma.reunion.count({
    where: { weekId: raceWeek.id, adminId: admin.id },
  });

  if (existing === 0) {
    // Reunión 1: Club Hípico de Santiago — 3 carreras
    const r1Date = addDays(now, 2);
    const r1 = await prisma.reunion.create({
      data: {
        racetrackId: adminTracks.find((t) => t.name === 'Club Hípico de Santiago')!.id,
        weekId: raceWeek.id,
        adminId: admin.id,
        name: 'Reunión Sábado',
        reunionDate: r1Date,
        deadline: new Date(r1Date.getTime() - 60 * 60 * 1000),
      },
    });
    const p1 = [
      ['Trueno', 'Relámpago', 'Estrella', 'Huracán', 'Sombra'],
      ['Don Carlos', 'Fortuna', 'Majestad', 'Real', 'Duque'],
      ['Centauro', 'Pegaso', 'Bucéfalo', 'Fénix'],
    ];
    for (let i = 0; i < p1.length; i++) {
      const race = await prisma.race.create({
        data: { reunionId: r1.id, raceNumber: i + 1 },
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

    // Reunión 2: Hipódromo Chile — 2 carreras
    const r2Date = addDays(now, 4);
    const r2 = await prisma.reunion.create({
      data: {
        racetrackId: adminTracks.find((t) => t.name === 'Hipódromo Chile')!.id,
        weekId: raceWeek.id,
        adminId: admin.id,
        name: 'Reunión Lunes',
        reunionDate: r2Date,
        deadline: new Date(r2Date.getTime() - 60 * 60 * 1000),
      },
    });
    const p2 = [
      ['Tormenta', 'Viento', 'Luna', 'Cometa', 'Rayo', 'Meteoro'],
      ['Pacífico', 'Costero', 'Marea', 'Arena'],
    ];
    for (let i = 0; i < p2.length; i++) {
      const race = await prisma.race.create({
        data: { reunionId: r2.id, raceNumber: i + 1 },
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

    console.log(`   ✔ 2 reuniones / 5 carreras creadas (semana ${week}/${year}).`);
  } else {
    console.log(`   • Semana ${week}/${year} ya tiene reuniones, no inserto demos.`);
  }

  console.log('✅ Seed completo.');
  console.log('   Cuentas de acceso rápido:');
  console.log(`   • 👑 Super Admin    superadmin@algalope.cl / superadmin123`);
  console.log(`   • 🛠  Administrador  admin@algalope.cl      / admin123`);
  for (const u of demoUsers) {
    console.log(`   •     ${u.displayName.padEnd(14)} ${u.email} / ${u.password}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
