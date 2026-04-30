import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { settleRace } from '../src/services/scoring';

const prisma = new PrismaClient();

async function main() {
  console.log('🧪 Seeding demo users + picks...');

  const demoHash = await bcrypt.hash('demo123', 10);
  const demo = await prisma.user.upsert({
    where: { email: 'demo@algalope.cl' },
    update: {},
    create: { email: 'demo@algalope.cl', passwordHash: demoHash, displayName: 'Demo', role: 'USER' },
  });

  const rivalHash = await bcrypt.hash('rival123', 10);
  const rival = await prisma.user.upsert({
    where: { email: 'rival@algalope.cl' },
    update: {},
    create: { email: 'rival@algalope.cl', passwordHash: rivalHash, displayName: 'Rival', role: 'USER' },
  });

  // 5 cuentas de prueba adicionales para login rápido
  const extras = [
    { email: 'jorge@algalope.cl', displayName: 'Jorge', password: 'jorge123' },
    { email: 'maria@algalope.cl', displayName: 'María', password: 'maria123' },
    { email: 'pedro@algalope.cl', displayName: 'Pedro', password: 'pedro123' },
    { email: 'ana@algalope.cl', displayName: 'Ana', password: 'ana123' },
    { email: 'luis@algalope.cl', displayName: 'Luis', password: 'luis123' },
  ];
  const extraUsers: any[] = [];
  for (const u of extras) {
    const hash = await bcrypt.hash(u.password, 10);
    const created = await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: { email: u.email, passwordHash: hash, displayName: u.displayName, role: 'USER' },
    });
    extraUsers.push(created);
  }

  const programs = await prisma.program.findMany({
    include: { races: { include: { horses: { orderBy: { number: 'asc' } } } } },
    orderBy: { programDate: 'asc' },
  });
  if (programs.length === 0) {
    console.log('   • No hay programas. Corre `npm run seed` primero.');
    return;
  }

  // Demo picks horse #1 in every race; Rival picks #2
  for (const prog of programs) {
    for (const race of prog.races) {
      if (race.horses.length === 0) continue;
      await prisma.pick.upsert({
        where: { userId_raceId: { userId: demo.id, raceId: race.id } },
        update: { horseId: race.horses[0].id },
        create: { userId: demo.id, raceId: race.id, horseId: race.horses[0].id },
      });
      if (race.horses.length > 1) {
        await prisma.pick.upsert({
          where: { userId_raceId: { userId: rival.id, raceId: race.id } },
          update: { horseId: race.horses[1].id },
          create: { userId: rival.id, raceId: race.id, horseId: race.horses[1].id },
        });
      }
      // Cada usuario extra elige un caballo distinto (rotando)
      for (let idx = 0; idx < extraUsers.length; idx++) {
        const u = extraUsers[idx];
        const horse = race.horses[(idx + 2) % race.horses.length];
        await prisma.pick.upsert({
          where: { userId_raceId: { userId: u.id, raceId: race.id } },
          update: { horseId: horse.id },
          create: { userId: u.id, raceId: race.id, horseId: horse.id },
        });
      }
    }
  }
  console.log(`   ✔ Picks creados para Demo y Rival en ${programs.length} programas.`);

  // Settle first race of first program so Demo has some points
  const firstRace = programs[0]?.races[0];
  if (firstRace && firstRace.horses.length >= 3) {
    const [h1, h2, h3] = firstRace.horses;
    await settleRace(firstRace.id, {
      firstHorseId: h1.id,
      secondHorseId: h2.id,
      thirdHorseId: h3.id,
      winnerDividend: 12,
    });
    console.log('   ✔ Primera carrera resuelta (Demo gana con dividendo 12x).');
  }

  console.log('✅ Demo listo.');
  console.log('   Demo:  demo@algalope.cl  / demo123');
  console.log('   Rival: rival@algalope.cl / rival123');
  for (const u of extras) {
    console.log(`   ${u.displayName.padEnd(6)}: ${u.email} / ${u.password}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
