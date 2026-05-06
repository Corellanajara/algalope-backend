import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { settleRace } from '../services/scoring';

const router = Router();

async function rescoreIfSettled(raceId: number) {
  const result = await prisma.result.findUnique({ where: { raceId } });
  if (!result) return;
  await settleRace(raceId, {
    firstHorseId: result.firstHorseId,
    secondHorseId: result.secondHorseId,
    thirdHorseId: result.thirdHorseId,
    winnerDividend: result.winnerDividend,
  });
}

// GET /api/races/:id — single race detail (used by result form)
router.get('/:id', async (req, res, next) => {
  try {
    const race = await prisma.race.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        horses: { orderBy: { number: 'asc' } },
        reunion: { include: { racetrack: true } },
        result: true,
      },
    });
    if (!race) return res.status(404).json({ error: 'Carrera no existe' });
    res.json(race);
  } catch (e) {
    next(e);
  }
});

// Admin: set the favorite horse of a race (single favorite per race).
// A favorite is required; null is not accepted.
const favoriteSchema = z.object({ horseId: z.number().int() });

router.post('/:id/favorite', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const raceId = Number(req.params.id);
    const { horseId } = favoriteSchema.parse(req.body);
    const race = await prisma.race.findUnique({
      where: { id: raceId },
      include: { horses: true },
    });
    if (!race) return res.status(404).json({ error: 'Carrera no existe' });
    const target = race.horses.find((h) => h.id === horseId);
    if (!target) {
      return res.status(400).json({ error: 'El caballo no pertenece a la carrera' });
    }
    if (target.isScratched) {
      return res
        .status(400)
        .json({ error: 'No se puede marcar como favorito a un caballo dado de baja' });
    }
    await prisma.$transaction(async (tx) => {
      await tx.horse.updateMany({ where: { raceId }, data: { isFavorite: false } });
      await tx.horse.update({ where: { id: horseId }, data: { isFavorite: true } });
    });
    await rescoreIfSettled(raceId);
    const horses = await prisma.horse.findMany({
      where: { raceId },
      orderBy: { number: 'asc' },
    });
    res.json(horses);
  } catch (e) {
    next(e);
  }
});

// Admin: toggle scratched flag on a horse.
const scratchSchema = z.object({ scratched: z.boolean() });

router.post('/horses/:horseId/scratch', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const horseId = Number(req.params.horseId);
    const { scratched } = scratchSchema.parse(req.body);
    const horse = await prisma.horse.findUnique({ where: { id: horseId } });
    if (!horse) return res.status(404).json({ error: 'Caballo no existe' });
    if (scratched && horse.isFavorite) {
      return res.status(400).json({
        error: 'No se puede dar de baja al favorito. Marcá otro caballo como favorito primero.',
      });
    }
    const updated = await prisma.horse.update({
      where: { id: horseId },
      data: { isScratched: scratched },
    });
    await rescoreIfSettled(horse.raceId);
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

// Admin: set the total horse count of a race (adds or removes horses).
const horseCountSchema = z.object({ count: z.number().int().min(2).max(30) });

router.patch('/:id/horse-count', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const raceId = Number(req.params.id);
    const { count } = horseCountSchema.parse(req.body);
    const race = await prisma.race.findUnique({
      where: { id: raceId },
      include: { horses: { orderBy: { number: 'asc' } }, result: true },
    });
    if (!race) return res.status(404).json({ error: 'Carrera no existe' });

    const current = race.horses.length;
    if (count === current) {
      return res.json(race.horses);
    }

    if (count > current) {
      const existingNumbers = new Set(race.horses.map((h) => h.number));
      const toCreate: { raceId: number; number: number; name: string }[] = [];
      let n = 1;
      while (toCreate.length < count - current) {
        if (!existingNumbers.has(n)) {
          toCreate.push({ raceId, number: n, name: `Caballo ${n}` });
        }
        n++;
        if (n > 200) break;
      }
      await prisma.horse.createMany({ data: toCreate });
    } else {
      const toRemove = race.horses
        .slice()
        .sort((a, b) => b.number - a.number)
        .slice(0, current - count);

      const removeIds = toRemove.map((h) => h.id);

      if (toRemove.some((h) => h.isFavorite)) {
        return res.status(400).json({
          error: 'No se puede quitar al favorito. Cambiá el favorito antes de reducir caballos.',
        });
      }
      if (
        race.result &&
        [race.result.firstHorseId, race.result.secondHorseId, race.result.thirdHorseId].some((id) =>
          removeIds.includes(id),
        )
      ) {
        return res.status(400).json({
          error: 'No se puede quitar caballos que están en el resultado de la carrera.',
        });
      }
      const picks = await prisma.pick.count({ where: { horseId: { in: removeIds } } });
      if (picks > 0) {
        return res.status(400).json({
          error: 'No se puede quitar caballos con picks de usuarios. Eliminá los picks primero.',
        });
      }
      await prisma.horse.deleteMany({ where: { id: { in: removeIds } } });
    }

    const horses = await prisma.horse.findMany({
      where: { raceId },
      orderBy: { number: 'asc' },
    });
    res.json(horses);
  } catch (e) {
    next(e);
  }
});

export default router;
