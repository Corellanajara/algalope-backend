import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth, requireAdmin, getTenantAdminId } from '../middleware/auth';

const router = Router();

// Lista de usuarios visibles para un ADMIN: solo los suyos (rol USER cuyo
// adminId == admin.id). El SUPERADMIN sin ?adminId= ve todo.
router.get('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const role = req.user!.role;
    const tenant = getTenantAdminId(req);
    const where: any = {};
    if (role === 'ADMIN') {
      where.adminId = req.user!.id;
      where.role = 'USER';
    } else if (role === 'SUPERADMIN' && tenant != null) {
      where.adminId = tenant;
    }
    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        displayName: true,
        pseudonym: true,
        role: true,
        adminId: true,
        createdAt: true,
      },
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
});

// ADMIN crea siempre USERs en su propio tenant. SUPERADMIN puede crear un
// USER en un tenant arbitrario indicando ?adminId=. Para crear ADMINs hay un
// endpoint dedicado en /api/admins.
router.post('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const data = createUserSchema.parse(req.body);
    const role = req.user!.role;
    let adminId: number | null;
    if (role === 'ADMIN') {
      adminId = req.user!.id;
    } else {
      adminId = getTenantAdminId(req);
      if (adminId == null) {
        return res
          .status(400)
          .json({ error: 'Falta tenant. SUPERADMIN debe especificar ?adminId=' });
      }
    }
    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing) return res.status(409).json({ error: 'Email ya registrado' });
    const passwordHash = await bcrypt.hash(data.password, 10);
    const user = await prisma.user.create({
      data: {
        email: data.email,
        passwordHash,
        displayName: data.displayName,
        pseudonym: data.pseudonym?.trim() || null,
        role: 'USER',
        adminId,
      },
      select: {
        id: true,
        email: true,
        displayName: true,
        pseudonym: true,
        role: true,
        adminId: true,
        createdAt: true,
      },
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
  password: z.string().min(6).optional(),
});

async function assertUserManageable(targetId: number, req: any): Promise<string | null> {
  const role = req.user!.role;
  if (role === 'SUPERADMIN') return null;
  const target = await prisma.user.findUnique({ where: { id: targetId } });
  if (!target) return 'Usuario no existe';
  if (role === 'ADMIN') {
    // El admin solo puede gestionar USERs propios.
    if (target.role !== 'USER' || (target as any).adminId !== req.user!.id) {
      return 'Usuario fuera de tu tenant';
    }
    return null;
  }
  return 'Sin permisos';
}

router.patch('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'ID inválido' });
    const err = await assertUserManageable(id, req);
    if (err) return res.status(403).json({ error: err });

    const data = updateUserSchema.parse(req.body);
    const updateData: any = {};
    if (data.displayName !== undefined) updateData.displayName = data.displayName;
    if (data.pseudonym !== undefined) {
      const trimmed = data.pseudonym?.trim();
      updateData.pseudonym = trimmed ? trimmed : null;
    }
    if (data.password !== undefined) updateData.passwordHash = await bcrypt.hash(data.password, 10);

    const user = await prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        email: true,
        displayName: true,
        pseudonym: true,
        role: true,
        adminId: true,
        createdAt: true,
      },
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
    const err = await assertUserManageable(id, req);
    if (err) return res.status(403).json({ error: err });
    await prisma.user.delete({ where: { id } });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

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
            reunion: { include: { racetrack: true, week: true } },
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
