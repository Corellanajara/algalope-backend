import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth, requireSuperadmin } from '../middleware/auth';

const router = Router();

router.use(requireAuth, requireSuperadmin);

router.get('/', async (_req, res, next) => {
  try {
    const admins = await prisma.user.findMany({
      where: { role: 'ADMIN' },
      select: {
        id: true,
        email: true,
        displayName: true,
        pseudonym: true,
        role: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    // Conteo de USERs por admin (tenant size).
    const counts = await prisma.user.groupBy({
      by: ['adminId'],
      where: { role: 'USER' },
      _count: { _all: true },
    });
    const byAdmin = new Map<number, number>();
    for (const c of counts as any[]) {
      if (c.adminId != null) byAdmin.set(c.adminId, c._count._all);
    }

    res.json(admins.map((a) => ({ ...a, usersCount: byAdmin.get(a.id) ?? 0 })));
  } catch (e) {
    next(e);
  }
});

const createSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  displayName: z.string().min(2).max(50),
  pseudonym: z.string().min(2).max(50).optional(),
});

router.post('/', async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing) return res.status(409).json({ error: 'Email ya registrado' });
    const passwordHash = await bcrypt.hash(data.password, 10);
    const admin = await prisma.user.create({
      data: {
        email: data.email,
        passwordHash,
        displayName: data.displayName,
        pseudonym: data.pseudonym?.trim() || null,
        role: 'ADMIN',
        adminId: null,
      },
      select: {
        id: true,
        email: true,
        displayName: true,
        pseudonym: true,
        role: true,
        createdAt: true,
      },
    });
    res.status(201).json(admin);
  } catch (e) {
    next(e);
  }
});

const updateSchema = z.object({
  displayName: z.string().min(2).max(50).optional(),
  pseudonym: z.string().max(50).nullable().optional(),
  password: z.string().min(6).optional(),
});

router.patch('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target || target.role !== 'ADMIN') {
      return res.status(404).json({ error: 'Admin no existe' });
    }
    const data = updateSchema.parse(req.body);
    const updateData: any = {};
    if (data.displayName !== undefined) updateData.displayName = data.displayName;
    if (data.pseudonym !== undefined) {
      const trimmed = data.pseudonym?.trim();
      updateData.pseudonym = trimmed ? trimmed : null;
    }
    if (data.password !== undefined) updateData.passwordHash = await bcrypt.hash(data.password, 10);
    const admin = await prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        email: true,
        displayName: true,
        pseudonym: true,
        role: true,
        createdAt: true,
      },
    });
    res.json(admin);
  } catch (e) {
    next(e);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (id === req.user!.id) {
      return res.status(400).json({ error: 'No puedes eliminarte a vos mismo' });
    }
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target || target.role !== 'ADMIN') {
      return res.status(404).json({ error: 'Admin no existe' });
    }
    // Borrar el admin elimina sus USERs (User.onDelete = SetNull deja huérfanos);
    // los borramos explícitamente junto con sus reuniones, racetracks y weeks.
    await prisma.$transaction(async (tx) => {
      await tx.user.deleteMany({ where: { adminId: id, role: 'USER' } });
      await tx.reunion.deleteMany({ where: { adminId: id } });
      await tx.raceWeek.deleteMany({ where: { adminId: id } });
      await tx.racetrack.deleteMany({ where: { adminId: id } });
      await tx.user.delete({ where: { id } });
    });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

export default router;
