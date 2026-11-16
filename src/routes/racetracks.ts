import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth, requireSuperadmin } from '../middleware/auth';

const router = Router();

// Los clubes hípicos son un catálogo global (adminId null): todos los ADMIN,
// USER y el SUPERADMIN ven siempre la misma lista.
router.get('/', requireAuth, async (_req, res, next) => {
  try {
    const list = await prisma.racetrack.findMany({
      where: { adminId: null },
      orderBy: { name: 'asc' },
    });
    res.json(list);
  } catch (e) {
    next(e);
  }
});

const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  city: z.string().trim().min(2).max(120),
});

// Solo el SUPERADMIN modifica el catálogo, porque afecta a todos los tenants.
router.post('/', requireAuth, requireSuperadmin, async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const existing = await prisma.racetrack.findFirst({
      where: { name: data.name, adminId: null },
    });
    if (existing) return res.status(409).json({ error: 'El club hípico ya existe' });
    const created = await prisma.racetrack.create({
      data: { name: data.name, city: data.city, adminId: null },
    });
    res.status(201).json(created);
  } catch (e) {
    next(e);
  }
});

router.delete('/:id', requireAuth, requireSuperadmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const r = await prisma.racetrack.findUnique({ where: { id } });
    if (!r) return res.status(404).json({ error: 'Club hípico no existe' });
    const inUse = await prisma.reunion.count({ where: { racetrackId: id } });
    if (inUse > 0) {
      return res
        .status(400)
        .json({ error: 'No se puede eliminar: hay reuniones asociadas a este club' });
    }
    await prisma.racetrack.delete({ where: { id } });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

export default router;
