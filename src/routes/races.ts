import { Router } from 'express';
import { prisma } from '../db';

const router = Router();

// GET /api/races/:id — single race detail (used by result form)
router.get('/:id', async (req, res, next) => {
  try {
    const race = await prisma.race.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        horses: { orderBy: { number: 'asc' } },
        program: { include: { racetrack: true } },
        result: true,
      },
    });
    if (!race) return res.status(404).json({ error: 'Carrera no existe' });
    res.json(race);
  } catch (e) {
    next(e);
  }
});

export default router;
