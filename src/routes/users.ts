import { Router } from 'express';
import { prisma } from '../db';
import { requireAuth, requireAdmin } from '../middleware/auth';

const router = Router();

router.get('/', requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, email: true, displayName: true, role: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    res.json(users);
  } catch (e) {
    next(e);
  }
});

// Current user's history grouped by program
router.get('/me/history', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const picks = await prisma.pick.findMany({
      where: { userId },
      include: {
        horse: true,
        race: {
          include: {
            horses: true,
            result: true,
            program: { include: { racetrack: true, week: true } },
          },
        },
      },
    });

    const scores = await prisma.score.findMany({ where: { userId } });
    const scoreByRace = new Map(scores.map((s: { raceId: number }) => [s.raceId, s]));
    const totalPoints = scores.reduce((a: number, s: { points: number }) => a + s.points, 0);

    const items = picks.map((p: any) => ({
      race: p.race,
      pick: { id: p.id, horse: p.horse },
      score: scoreByRace.get(p.raceId) || null,
    }));

    res.json({ totalPoints, items });
  } catch (e) {
    next(e);
  }
});

export default router;
