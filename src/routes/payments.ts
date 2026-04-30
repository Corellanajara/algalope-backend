import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth, requireAdmin } from '../middleware/auth';

const router = Router();

// GET /api/payments?weekId=
router.get('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const weekId = req.query.weekId ? Number(req.query.weekId) : undefined;
    const where: any = {};
    if (weekId) where.weekId = weekId;
    const payments = await prisma.payment.findMany({
      where,
      include: { user: true, week: true },
    });
    res.json(payments);
  } catch (e) {
    next(e);
  }
});

// User's own payments
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const payments = await prisma.payment.findMany({
      where: { userId: req.user!.id },
      include: { week: true },
      orderBy: { week: { startDate: 'desc' } },
    });
    res.json(payments);
  } catch (e) {
    next(e);
  }
});

const paymentSchema = z.object({
  paid: z.boolean(),
  note: z.string().max(500).optional().nullable(),
});

router.put('/:userId/:weekId', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const userId = Number(req.params.userId);
    const weekId = Number(req.params.weekId);
    const data = paymentSchema.parse(req.body);
    const payment = await prisma.payment.upsert({
      where: { userId_weekId: { userId, weekId } },
      update: {
        paid: data.paid,
        paidAt: data.paid ? new Date() : null,
        note: data.note ?? null,
      },
      create: {
        userId,
        weekId,
        paid: data.paid,
        paidAt: data.paid ? new Date() : null,
        note: data.note ?? null,
      },
    });
    res.json(payment);
  } catch (e) {
    next(e);
  }
});

export default router;
