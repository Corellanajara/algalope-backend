import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth, requireAdmin, getTenantAdminId } from '../middleware/auth';

const router = Router();

// Filtra por tenant. El SUPERADMIN sin ?adminId= ve todo; en otro caso se
// fuerza adminId === <tenant>.
function applyTenantFilter(where: any, req: any) {
  const role = req.user?.role;
  const adminId = getTenantAdminId(req);
  if (role === 'SUPERADMIN' && adminId == null) return where;
  where.adminId = adminId;
  return where;
}

// GET /api/reuniones?weekId=&current=1&racetrackId=
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const weekId = req.query.weekId ? Number(req.query.weekId) : undefined;
    const racetrackId = req.query.racetrackId ? Number(req.query.racetrackId) : undefined;
    const current = req.query.current === '1';

    const where: any = {};
    applyTenantFilter(where, req);

    if (weekId) where.weekId = weekId;
    else if (current) {
      const weekWhere: any = {};
      if (where.adminId !== undefined) weekWhere.adminId = where.adminId;
      const latestWeek = await prisma.raceWeek.findFirst({
        where: weekWhere,
        orderBy: [{ year: 'desc' }, { weekNumber: 'desc' }],
      });
      if (!latestWeek) return res.json([]);
      where.weekId = latestWeek.id;
    }
    if (racetrackId) where.racetrackId = racetrackId;

    const reuniones = await prisma.reunion.findMany({
      where,
      include: {
        racetrack: true,
        week: true,
        races: {
          include: {
            horses: { orderBy: { number: 'asc' } },
            result: true,
          },
          orderBy: { raceNumber: 'asc' },
        },
        document: { select: { filename: true, uploadedAt: true } },
      },
      orderBy: [{ reunionDate: 'asc' }],
    });

    const allRaceIds = reuniones.flatMap((r) => r.races.map((rc) => rc.id));
    const cartillasByReunion = new Map<number, number>();
    if (allRaceIds.length > 0) {
      const picks = await prisma.pick.findMany({
        where: { raceId: { in: allRaceIds } },
        select: { raceId: true, userId: true },
      });
      const raceToReunion = new Map<number, number>();
      for (const r of reuniones) for (const rc of r.races) raceToReunion.set(rc.id, r.id);
      const usersByReunion = new Map<number, Set<number>>();
      for (const p of picks) {
        const rid = raceToReunion.get(p.raceId)!;
        const set = usersByReunion.get(rid) ?? new Set<number>();
        set.add(p.userId);
        usersByReunion.set(rid, set);
      }
      for (const [rid, set] of usersByReunion) cartillasByReunion.set(rid, set.size);
    }

    res.json(
      reuniones.map((r) => ({ ...r, cartillasCount: cartillasByReunion.get(r.id) ?? 0 })),
    );
  } catch (e) {
    next(e);
  }
});

router.get('/weeks', requireAuth, async (req, res, next) => {
  try {
    const where: any = {};
    applyTenantFilter(where, req);
    const weeks = await prisma.raceWeek.findMany({
      where,
      orderBy: [{ year: 'desc' }, { weekNumber: 'desc' }],
    });
    res.json(weeks);
  } catch (e) {
    next(e);
  }
});

router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const reunion = await prisma.reunion.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        racetrack: true,
        week: true,
        races: {
          include: { horses: { orderBy: { number: 'asc' } }, result: true },
          orderBy: { raceNumber: 'asc' },
        },
        document: { select: { filename: true, uploadedAt: true } },
      },
    });
    if (!reunion) return res.status(404).json({ error: 'Reunión no existe' });
    if (req.user!.role !== 'SUPERADMIN') {
      const tenant = getTenantAdminId(req);
      if ((reunion as any).adminId !== tenant) {
        return res.status(404).json({ error: 'Reunión no existe' });
      }
    }
    res.json(reunion);
  } catch (e) {
    next(e);
  }
});

const weekSchema = z.object({
  year: z.number().int(),
  weekNumber: z.number().int().min(1).max(53),
  startDate: z.string(),
  endDate: z.string(),
});

router.post('/weeks', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const data = weekSchema.parse(req.body);
    const adminId = getTenantAdminId(req);
    if (adminId == null) {
      return res.status(400).json({ error: 'Falta tenant (?adminId=)' });
    }
    const week = await prisma.raceWeek.create({
      data: {
        year: data.year,
        weekNumber: data.weekNumber,
        startDate: new Date(data.startDate),
        endDate: new Date(data.endDate),
        adminId,
      },
    });
    res.status(201).json(week);
  } catch (e) {
    next(e);
  }
});

const createReunionSchema = z.object({
  racetrackId: z.number().int(),
  weekId: z.number().int().optional(),
  name: z.string().min(1).max(120),
  reunionDate: z.string(),
  deadline: z.string().optional(),
  races: z
    .array(
      z.object({
        raceNumber: z.number().int().min(1),
        horseCount: z.number().int().min(2).max(30).optional(),
        favoriteNumber: z.number().int().min(1),
        horses: z
          .array(
            z.object({
              number: z.number().int().min(1),
              name: z.string().optional(),
              odds: z.number().positive().optional().nullable(),
            }),
          )
          .min(2)
          .optional(),
      }),
    )
    .min(1)
    .refine(
      (rs) => rs.every((r) => r.horseCount != null || (r.horses && r.horses.length >= 2)),
      'Cada carrera debe tener horseCount o un arreglo de horses',
    )
    .refine(
      (rs) =>
        rs.every((r) => {
          const max = r.horseCount ?? r.horses?.length ?? 0;
          return r.favoriteNumber >= 1 && r.favoriteNumber <= max;
        }),
      'El número del favorito debe estar dentro de los caballos de la carrera',
    ),
});

const ONE_HOUR_MS = 60 * 60 * 1000;

function getISOWeek(d: Date): { year: number; week: number } {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year: date.getUTCFullYear(), week };
}

async function resolveWeekId(reunionDate: Date, adminId: number): Promise<number> {
  const { year, week } = getISOWeek(reunionDate);
  const startDate = new Date(reunionDate);
  startDate.setHours(0, 0, 0, 0);
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 7);
  const existing = await prisma.raceWeek.findFirst({
    where: { adminId, year, weekNumber: week },
  });
  if (existing) return existing.id;
  const created = await prisma.raceWeek.create({
    data: { adminId, year, weekNumber: week, startDate, endDate },
  });
  return created.id;
}

router.post('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const data = createReunionSchema.parse(req.body);
    const adminId = getTenantAdminId(req);
    if (adminId == null) {
      return res.status(400).json({ error: 'Falta tenant (?adminId=)' });
    }

    // Validar que el racetrack pertenezca al mismo tenant.
    const racetrack = await prisma.racetrack.findUnique({ where: { id: data.racetrackId } });
    if (!racetrack || (racetrack as any).adminId !== adminId) {
      return res.status(400).json({ error: 'El hipódromo no pertenece a tu tenant' });
    }

    const reunionDate = new Date(data.reunionDate);
    const deadline = data.deadline
      ? new Date(data.deadline)
      : new Date(reunionDate.getTime() - ONE_HOUR_MS);
    const weekId = data.weekId ?? (await resolveWeekId(reunionDate, adminId));

    // Si vino un weekId del cliente, validamos que sea de este tenant.
    if (data.weekId) {
      const w = await prisma.raceWeek.findUnique({ where: { id: data.weekId } });
      if (!w || (w as any).adminId !== adminId) {
        return res.status(400).json({ error: 'La semana no pertenece a tu tenant' });
      }
    }

    const reunion = await prisma.$transaction(async (tx) => {
      const r0 = await tx.reunion.create({
        data: {
          racetrackId: data.racetrackId,
          weekId,
          adminId,
          name: data.name,
          reunionDate,
          deadline,
        },
      });
      for (const r of data.races) {
        const race = await tx.race.create({
          data: { reunionId: r0.id, raceNumber: r.raceNumber },
        });
        const fav = r.favoriteNumber ?? null;
        const horses =
          r.horses && r.horses.length > 0
            ? r.horses.map((h) => ({
                raceId: race.id,
                number: h.number,
                name: h.name && h.name.trim() ? h.name.trim() : `Caballo ${h.number}`,
                odds: h.odds ?? null,
                isFavorite: fav != null && h.number === fav,
              }))
            : Array.from({ length: r.horseCount! }, (_, i) => ({
                raceId: race.id,
                number: i + 1,
                name: `Caballo ${i + 1}`,
                odds: null as number | null,
                isFavorite: fav != null && i + 1 === fav,
              }));
        await tx.horse.createMany({ data: horses });
      }
      return r0;
    });

    const full = await prisma.reunion.findUnique({
      where: { id: reunion.id },
      include: {
        racetrack: true,
        week: true,
        races: { include: { horses: true } },
      },
    });
    res.status(201).json(full);
  } catch (e) {
    next(e);
  }
});

async function assertReunionInTenant(reunionId: number, req: any): Promise<boolean> {
  if (req.user!.role === 'SUPERADMIN') return true;
  const r = await prisma.reunion.findUnique({ where: { id: reunionId } });
  if (!r) return false;
  return (r as any).adminId === getTenantAdminId(req);
}

router.delete('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!(await assertReunionInTenant(id, req))) {
      return res.status(404).json({ error: 'Reunión no existe' });
    }
    await prisma.reunion.delete({ where: { id } });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

const updateReunionSchema = z.object({
  name: z.string().optional(),
  reunionDate: z.string().optional(),
  deadline: z.string().optional(),
  status: z.enum(['OPEN', 'CLOSED', 'SETTLED']).optional(),
});

router.put('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!(await assertReunionInTenant(id, req))) {
      return res.status(404).json({ error: 'Reunión no existe' });
    }
    const data = updateReunionSchema.parse(req.body);
    const updateData: any = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.reunionDate) {
      const pd = new Date(data.reunionDate);
      updateData.reunionDate = pd;
      if (!data.deadline) updateData.deadline = new Date(pd.getTime() - ONE_HOUR_MS);
    }
    if (data.deadline) updateData.deadline = new Date(data.deadline);
    if (data.status) updateData.status = data.status;
    const r = await prisma.reunion.update({ where: { id }, data: updateData });
    res.json(r);
  } catch (e) {
    next(e);
  }
});

// GET /api/reuniones/:id/picks — visibles dentro del tenant
router.get('/:id/picks', requireAuth, async (req, res, next) => {
  try {
    const reunionId = Number(req.params.id);
    if (!(await assertReunionInTenant(reunionId, req))) {
      return res.status(404).json({ error: 'Reunión no existe' });
    }
    const reunion = await prisma.reunion.findUnique({
      where: { id: reunionId },
      include: { races: true },
    });
    if (!reunion) return res.status(404).json({ error: 'Reunión no existe' });

    const raceIds = reunion.races.map((r) => r.id);
    const picks = await prisma.pick.findMany({
      where: { raceId: { in: raceIds } },
      include: {
        horse: true,
        user: { select: { id: true, displayName: true, pseudonym: true, email: true } },
      },
      orderBy: [{ userId: 'asc' }, { raceId: 'asc' }],
    });

    const byUser = new Map<number, any>();
    for (const p of picks) {
      const entry = byUser.get(p.userId) ?? {
        user: p.user,
        picks: [] as any[],
      };
      entry.picks.push({
        raceId: p.raceId,
        horseId: p.horseId,
        horse: p.horse,
      });
      byUser.set(p.userId, entry);
    }
    res.json(Array.from(byUser.values()));
  } catch (e) {
    next(e);
  }
});

const batchPickSchema = z.object({
  picks: z
    .array(
      z.object({
        raceId: z.number().int(),
        horseId: z.number().int(),
      }),
    )
    .min(1),
});

router.post('/:id/picks', requireAuth, async (req, res, next) => {
  try {
    const reunionId = Number(req.params.id);
    const { picks } = batchPickSchema.parse(req.body);

    const reunion = await prisma.reunion.findUnique({
      where: { id: reunionId },
      include: {
        races: { include: { horses: true } },
      },
    });
    if (!reunion) return res.status(404).json({ error: 'Reunión no existe' });

    // El usuario solo puede jugar reuniones de su admin.
    const user = req.user!;
    if (user.role !== 'SUPERADMIN') {
      const tenant = user.role === 'ADMIN' ? user.id : user.adminId;
      if ((reunion as any).adminId !== tenant) {
        return res.status(403).json({ error: 'Reunión fuera de tu tenant' });
      }
    }
    if (new Date() > reunion.deadline) {
      return res.status(403).json({ error: 'Deadline de la reunión expirado' });
    }
    if (reunion.status !== 'OPEN') {
      return res.status(403).json({ error: 'Reunión cerrada' });
    }

    const racesById = new Map(reunion.races.map((r: any) => [r.id, r]));
    const racesSeen = new Set<number>();
    for (const p of picks) {
      const race = racesById.get(p.raceId);
      if (!race) {
        return res.status(400).json({ error: `Carrera ${p.raceId} no pertenece a la reunión` });
      }
      if (racesSeen.has(p.raceId)) {
        return res.status(400).json({ error: 'Picks duplicados en la misma carrera' });
      }
      racesSeen.add(p.raceId);
      if (!race.horses.some((h: any) => h.id === p.horseId)) {
        return res
          .status(400)
          .json({ error: `Caballo ${p.horseId} no pertenece a la carrera ${p.raceId}` });
      }
    }
    if (racesSeen.size !== reunion.races.length) {
      return res
        .status(400)
        .json({ error: 'Debes elegir un caballo por cada carrera de la reunión' });
    }

    const userId = user.id;
    await prisma.$transaction(async (tx) => {
      for (const p of picks) {
        await tx.pick.upsert({
          where: { userId_raceId: { userId, raceId: p.raceId } },
          update: { horseId: p.horseId },
          create: { userId, raceId: p.raceId, horseId: p.horseId },
        });
      }
    });

    const saved = await prisma.pick.findMany({
      where: { userId, raceId: { in: picks.map((p) => p.raceId) } },
      include: { horse: true },
    });
    res.json({ ok: true, picks: saved });
  } catch (e) {
    next(e);
  }
});

const uploadDocSchema = z.object({
  filename: z.string().min(1).max(255),
  dataBase64: z.string().min(1),
});

const MAX_PDF_BYTES = 20 * 1024 * 1024;

router.post('/:id/document', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const reunionId = Number(req.params.id);
    if (!(await assertReunionInTenant(reunionId, req))) {
      return res.status(404).json({ error: 'Reunión no existe' });
    }
    const { filename, dataBase64 } = uploadDocSchema.parse(req.body);
    const cleaned = dataBase64.replace(/^data:application\/pdf;base64,/, '');
    const buf = Buffer.from(cleaned, 'base64');
    if (buf.length === 0) return res.status(400).json({ error: 'PDF vacío o inválido' });
    if (buf.length > MAX_PDF_BYTES) {
      return res.status(413).json({ error: 'PDF supera 20 MB' });
    }
    if (buf.slice(0, 4).toString('utf8') !== '%PDF') {
      return res.status(400).json({ error: 'El archivo no es un PDF válido' });
    }
    const doc = await prisma.reunionDocument.upsert({
      where: { reunionId },
      update: { filename, data: buf, uploadedAt: new Date() },
      create: { reunionId, filename, data: buf },
      select: { filename: true, uploadedAt: true },
    });
    res.status(201).json(doc);
  } catch (e) {
    next(e);
  }
});

router.get('/:id/document', requireAuth, async (req, res, next) => {
  try {
    const reunionId = Number(req.params.id);
    if (!(await assertReunionInTenant(reunionId, req))) {
      return res.status(404).json({ error: 'No hay documento adjunto' });
    }
    const doc = await prisma.reunionDocument.findUnique({ where: { reunionId } });
    if (!doc) return res.status(404).json({ error: 'No hay documento adjunto' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(doc.filename)}"`,
    );
    res.send(doc.data);
  } catch (e) {
    next(e);
  }
});

router.delete('/:id/document', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const reunionId = Number(req.params.id);
    if (!(await assertReunionInTenant(reunionId, req))) {
      return res.status(404).json({ error: 'No hay documento adjunto' });
    }
    await prisma.reunionDocument.delete({ where: { reunionId } }).catch(() => null);
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

export default router;
