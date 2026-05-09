import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth, requireAdmin, getTenantAdminId } from '../middleware/auth';

const router = Router();

router.get('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const reunionId = req.query.reunionId ? Number(req.query.reunionId) : undefined;
    const adminId = getTenantAdminId(req);
    const where: any = {};
    if (reunionId) where.reunionId = reunionId;
    if (req.user!.role !== 'SUPERADMIN' || adminId != null) {
      // Filtra por reuniones del tenant.
      where.reunion = { adminId };
    }
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

async function assertSameTenant(userId: number, reunionId: number, req: any): Promise<string | null> {
  if (req.user!.role === 'SUPERADMIN') return null;
  const tenant = getTenantAdminId(req);
  const [u, r] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.reunion.findUnique({ where: { id: reunionId } }),
  ]);
  if (!u) return 'Usuario no existe';
  if (!r) return 'Reunión no existe';
  if ((u as any).adminId !== tenant) return 'El usuario no pertenece a tu tenant';
  if ((r as any).adminId !== tenant) return 'La reunión no pertenece a tu tenant';
  return null;
}

router.post('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const data = upsertSchema.parse(req.body);
    const err = await assertSameTenant(data.userId, data.reunionId, req);
    if (err) return res.status(400).json({ error: err });
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

async function assertProgramaInTenant(id: number, req: any): Promise<boolean> {
  if (req.user!.role === 'SUPERADMIN') return true;
  const tenant = getTenantAdminId(req);
  const p = await prisma.programa.findUnique({
    where: { id },
    include: { reunion: true },
  });
  if (!p) return false;
  return (p.reunion as any).adminId === tenant;
}

router.patch('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!(await assertProgramaInTenant(id, req))) {
      return res.status(404).json({ error: 'Programa no existe' });
    }
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
    const id = Number(req.params.id);
    if (!(await assertProgramaInTenant(id, req))) {
      return res.status(404).json({ error: 'Programa no existe' });
    }
    await prisma.programa.delete({ where: { id } });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

export default router;
