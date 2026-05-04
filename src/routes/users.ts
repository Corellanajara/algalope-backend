import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth, requireAdmin } from '../middleware/auth';

const router = Router();

router.get('/', requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, email: true, displayName: true, pseudonym: true, role: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    res.json(users);
  } catch (e) {
    next(e);
  }
});

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  displayName: z.string().min(2).max(50),
  pseudonym: z.string().min(2).max(50).optional(),
  role: z.enum(['USER', 'ADMIN']).optional(),
});

router.post('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const data = createUserSchema.parse(req.body);
    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing) return res.status(409).json({ error: 'Email ya registrado' });
    const passwordHash = await bcrypt.hash(data.password, 10);
    const user = await prisma.user.create({
      data: {
        email: data.email,
        passwordHash,
        displayName: data.displayName,
        pseudonym: data.pseudonym?.trim() || null,
        role: data.role ?? 'USER',
      },
      select: { id: true, email: true, displayName: true, pseudonym: true, role: true, createdAt: true },
    });
    res.status(201).json(user);
  } catch (e) {
    next(e);
  }
});

const updateMeSchema = z.object({
  displayName: z.string().min(2).max(50).optional(),
  pseudonym: z.string().max(50).nullable().optional(),
});

router.patch('/me', requireAuth, async (req, res, next) => {
  try {
    const data = updateMeSchema.parse(req.body);
    const updateData: any = {};
    if (data.displayName !== undefined) updateData.displayName = data.displayName;
    if (data.pseudonym !== undefined) {
      const trimmed = data.pseudonym?.trim();
      updateData.pseudonym = trimmed ? trimmed : null;
    }
    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: updateData,
      select: { id: true, email: true, displayName: true, pseudonym: true, role: true },
    });
    res.json(user);
  } catch (e) {
    next(e);
  }
});

const updateUserSchema = z.object({
  displayName: z.string().min(2).max(50).optional(),
  pseudonym: z.string().max(50).nullable().optional(),
  role: z.enum(['USER', 'ADMIN']).optional(),
  password: z.string().min(6).optional(),
});

router.patch('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'ID inválido' });
    const data = updateUserSchema.parse(req.body);
    const updateData: any = {};
    if (data.displayName !== undefined) updateData.displayName = data.displayName;
    if (data.pseudonym !== undefined) {
      const trimmed = data.pseudonym?.trim();
      updateData.pseudonym = trimmed ? trimmed : null;
    }
    if (data.role !== undefined) updateData.role = data.role;
    if (data.password !== undefined) updateData.passwordHash = await bcrypt.hash(data.password, 10);

    if (data.role === 'USER' && id === req.user!.id) {
      return res.status(400).json({ error: 'No puedes quitarte tu propio rol ADMIN' });
    }

    const user = await prisma.user.update({
      where: { id },
      data: updateData,
      select: { id: true, email: true, displayName: true, pseudonym: true, role: true, createdAt: true },
    });
    res.json(user);
  } catch (e) {
    next(e);
  }
});

router.delete('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'ID inválido' });
    if (id === req.user!.id) return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta' });
    await prisma.user.delete({ where: { id } });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// Current user's history grouped by program
router.get('/me/history', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const picks = await prisma.pick.findMany({
      where: { userId },
      include: {
        horse: true,
        race: {
          include: {
            horses: true,
            result: true,
            program: { include: { racetrack: true, week: true } },
          },
        },
      },
    });

    const scores = await prisma.score.findMany({ where: { userId } });
    const scoreByRace = new Map(scores.map((s: { raceId: number }) => [s.raceId, s]));
    const totalPoints = scores.reduce((a: number, s: { points: number }) => a + s.points, 0);

    const items = picks.map((p: any) => ({
      race: p.race,
      pick: { id: p.id, horse: p.horse },
      score: scoreByRace.get(p.raceId) || null,
    }));

    res.json({ totalPoints, items });
  } catch (e) {
    next(e);
  }
});

export default router;
