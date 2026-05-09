import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth, requireAdmin, getTenantAdminId } from '../middleware/auth';
import { settleRace } from '../services/scoring';

const router = Router();

const resultSchema = z.object({
  firstHorseId: z.number().int(),
  secondHorseId: z.number().int(),
  thirdHorseId: z.number().int(),
  winnerDividend: z.number().min(0),
});

router.post('/:raceId', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const raceId = Number(req.params.raceId);

    if (req.user!.role !== 'SUPERADMIN') {
      const race = await prisma.race.findUnique({
        where: { id: raceId },
        include: { reunion: true },
      });
      if (!race) return res.status(404).json({ error: 'Carrera no existe' });
      if ((race.reunion as any).adminId !== getTenantAdminId(req)) {
        return res.status(404).json({ error: 'Carrera no existe' });
      }
    }

    const data = resultSchema.parse(req.body);
    const result = await settleRace(raceId, data);
    res.json(result);
  } catch (e) {
    next(e);
  }
});

export default router;
