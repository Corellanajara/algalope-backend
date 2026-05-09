import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth, requireAdmin, getTenantAdminId } from '../middleware/auth';

const router = Router();

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const adminId = getTenantAdminId(req);
    const where: any = {};
    if (req.user!.role !== 'SUPERADMIN' || adminId != null) {
      where.adminId = adminId;
    }
    const list = await prisma.racetrack.findMany({
      where,
      orderBy: { name: 'asc' },
    });
    res.json(list);
  } catch (e) {
    next(e);
  }
});

const createSchema = z.object({
  name: z.string().min(2).max(120),
  city: z.string().min(2).max(120),
});

router.post('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const adminId = getTenantAdminId(req);
    if (adminId == null) {
      return res
        .status(400)
        .json({ error: 'Falta el tenant. SUPERADMIN debe especificar ?adminId=' });
    }
    const created = await prisma.racetrack.create({
      data: { name: data.name, city: data.city, adminId },
    });
    res.status(201).json(created);
  } catch (e) {
    next(e);
  }
});

router.delete('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const adminId = getTenantAdminId(req);
    const r = await prisma.racetrack.findUnique({ where: { id } });
    if (!r) return res.status(404).json({ error: 'Hipódromo no existe' });
    if (req.user!.role !== 'SUPERADMIN' && r.adminId !== adminId) {
      return res.status(403).json({ error: 'No pertenece a tu tenant' });
    }
    await prisma.racetrack.delete({ where: { id } });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

export default router;
