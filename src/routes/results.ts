import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../middleware/auth';
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
    const data = resultSchema.parse(req.body);
    const result = await settleRace(raceId, data);
    res.json(result);
  } catch (e) {
    next(e);
  }
});

export default router;
