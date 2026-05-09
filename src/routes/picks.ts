import { Router } from 'express';
import { prisma } from '../db';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const picks = await prisma.pick.findMany({
      where: { userId: req.user!.id },
      include: {
        horse: true,
        race: {
          include: {
            reunion: { include: { racetrack: true, week: true } },
            result: true,
          },
        },
      },
    });
    res.json(picks);
  } catch (e) {
    next(e);
  }
});

export default router;
