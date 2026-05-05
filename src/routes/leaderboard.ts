import { Router } from 'express';
import { prisma } from '../db';

const router = Router();

// GET /api/leaderboard?weekId=&reunionId=  (omit both for overall)
// reunionId takes precedence over weekId.
router.get('/', async (req, res, next) => {
  try {
    const weekId = req.query.weekId ? Number(req.query.weekId) : undefined;
    const reunionId = req.query.reunionId ? Number(req.query.reunionId) : undefined;

    const where: any = reunionId
      ? { race: { reunionId } }
      : weekId
      ? { race: { reunion: { weekId } } }
      : {};

    const scores = await prisma.score.findMany({
      where,
      include: {
        user: { select: { id: true, displayName: true, pseudonym: true, email: true } },
      },
    });

    const map = new Map<number, { user: any; points: number; races: number }>();
    for (const s of scores as any[]) {
      const cur = map.get(s.userId) || { user: s.user, points: 0, races: 0 };
      cur.points += s.points;
      cur.races += 1;
      map.set(s.userId, cur);
    }

    const ranking = Array.from(map.values())
      .sort((a, b) => b.points - a.points)
      .map((r, i) => ({ rank: i + 1, ...r }));

    res.json(ranking);
  } catch (e) {
    next(e);
  }
});

export default router;
