import { Router } from 'express';
import { prisma } from '../db';

const router = Router();

router.get('/', async (_req, res, next) => {
  try {
    const list = await prisma.racetrack.findMany({ orderBy: { name: 'asc' } });
    res.json(list);
  } catch (e) {
    next(e);
  }
});

export default router;
