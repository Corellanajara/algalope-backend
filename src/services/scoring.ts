import { prisma } from '../db';

export interface ResultInput {
  firstHorseId: number;
  secondHorseId: number;
  thirdHorseId: number;
  winnerDividend: number;
}

export async function settleRace(raceId: number, input: ResultInput) {
  const race = await prisma.race.findUnique({
    where: { id: raceId },
    include: { horses: true, picks: true },
  });
  if (!race) throw Object.assign(new Error('Carrera no existe'), { status: 404 });

  const horseIds = new Set(race.horses.map((h) => h.id));
  for (const id of [input.firstHorseId, input.secondHorseId, input.thirdHorseId]) {
    if (!horseIds.has(id)) {
      throw Object.assign(new Error('Caballo no pertenece a esta carrera'), { status: 400 });
    }
  }

  // Count winners (for "único" bonus: only 1 pick on winning horse across all users)
  const winnerPickCount = race.picks.filter((p) => p.horseId === input.firstHorseId).length;

  const results = await prisma.$transaction(async (tx) => {
    // Upsert Result
    const result = await tx.result.upsert({
      where: { raceId },
      update: {
        firstHorseId: input.firstHorseId,
        secondHorseId: input.secondHorseId,
        thirdHorseId: input.thirdHorseId,
        winnerDividend: input.winnerDividend,
        settledAt: new Date(),
      },
      create: {
        raceId,
        firstHorseId: input.firstHorseId,
        secondHorseId: input.secondHorseId,
        thirdHorseId: input.thirdHorseId,
        winnerDividend: input.winnerDividend,
      },
    });

    await tx.race.update({ where: { id: raceId }, data: { status: 'SETTLED' } });

    // Clear previous scores for this race (in case we re-enter results)
    await tx.score.deleteMany({ where: { raceId } });

    for (const pick of race.picks) {
      let points = 0;
      const breakdown: string[] = [];
      if (pick.horseId === input.firstHorseId) {
        points += 10;
        breakdown.push('1° lugar: +10');
        if (input.winnerDividend > 10) {
          points += 5;
          breakdown.push(`Dividendo ${input.winnerDividend}x (>10): +5`);
        }
        if (winnerPickCount === 1) {
          points += 5;
          breakdown.push('Único que eligió al ganador: +5');
        }
      } else if (pick.horseId === input.secondHorseId) {
        points += 5;
        breakdown.push('2° lugar: +5');
      } else if (pick.horseId === input.thirdHorseId) {
        points += 1;
        breakdown.push('3° lugar: +1');
      } else {
        breakdown.push('Sin puntos');
      }

      await tx.score.create({
        data: {
          userId: pick.userId,
          raceId,
          points,
          breakdown: JSON.stringify(breakdown),
        },
      });
    }

    return result;
  });

  return results;
}
