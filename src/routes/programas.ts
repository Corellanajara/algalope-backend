import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth, requireAdmin } from '../middleware/auth';

const router = Router();

// GET /api/programas?weekId=
router.get('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const weekId = req.query.weekId ? Number(req.query.weekId) : undefined;
    const where: any = {};
    if (weekId) where.weekId = weekId;
    const list = await prisma.programa.findMany({
      where,
      include: {
        user: { select: { id: true, displayName: true, email: true } },
        week: true,
      },
      orderBy: [{ weekId: 'desc' }, { id: 'asc' }],
    });
    res.json(list);
  } catch (e) {
    next(e);
  }
});

const upsertSchema = z.object({
  userId: z.number().int(),
  weekId: z.number().int(),
  paid: z.boolean().optional(),
  note: z.string().nullable().optional(),
});

router.post('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const data = upsertSchema.parse(req.body);
    const paid = data.paid ?? false;
    const programa = await prisma.programa.upsert({
      where: { userId_weekId: { userId: data.userId, weekId: data.weekId } },
      update: {
        paid,
        paidAt: paid ? new Date() : null,
        note: data.note ?? null,
      },
      create: {
        userId: data.userId,
        weekId: data.weekId,
        paid,
        paidAt: paid ? new Date() : null,
        note: data.note ?? null,
      },
      include: {
        user: { select: { id: true, displayName: true, email: true } },
        week: true,
      },
    });
    res.status(201).json(programa);
  } catch (e) {
    next(e);
  }
});

const updateSchema = z.object({
  paid: z.boolean().optional(),
  note: z.string().nullable().optional(),
});

router.patch('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const data = updateSchema.parse(req.body);
    const updateData: any = {};
    if (data.paid !== undefined) {
      updateData.paid = data.paid;
      updateData.paidAt = data.paid ? new Date() : null;
    }
    if (data.note !== undefined) updateData.note = data.note;
    const programa = await prisma.programa.update({
      where: { id },
      data: updateData,
      include: {
        user: { select: { id: true, displayName: true, email: true } },
        week: true,
      },
    });
    res.json(programa);
  } catch (e) {
    next(e);
  }
});

router.delete('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    await prisma.programa.delete({ where: { id: Number(req.params.id) } });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

export default router;
