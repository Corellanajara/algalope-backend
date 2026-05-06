import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth, requireAdmin } from '../middleware/auth';

const router = Router();

// GET /api/programas?reunionId=
router.get('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const reunionId = req.query.reunionId ? Number(req.query.reunionId) : undefined;
    const where: any = {};
    if (reunionId) where.reunionId = reunionId;
    const list = await prisma.programa.findMany({
      where,
      include: {
        user: { select: { id: true, displayName: true, email: true } },
        reunion: { include: { racetrack: true } },
      },
      orderBy: [{ reunionId: 'desc' }, { id: 'asc' }],
    });
    res.json(list);
  } catch (e) {
    next(e);
  }
});

const upsertSchema = z.object({
  userId: z.number().int(),
  reunionId: z.number().int(),
  paid: z.boolean().optional(),
  note: z.string().nullable().optional(),
});

router.post('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const data = upsertSchema.parse(req.body);
    const paid = data.paid ?? false;
    const programa = await prisma.programa.upsert({
      where: { userId_reunionId: { userId: data.userId, reunionId: data.reunionId } },
      update: {
        paid,
        paidAt: paid ? new Date() : null,
        note: data.note ?? null,
      },
      create: {
        userId: data.userId,
        reunionId: data.reunionId,
        paid,
        paidAt: paid ? new Date() : null,
        note: data.note ?? null,
      },
      include: {
        user: { select: { id: true, displayName: true, email: true } },
        reunion: { include: { racetrack: true } },
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
        reunion: { include: { racetrack: true } },
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
