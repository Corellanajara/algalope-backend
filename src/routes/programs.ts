import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth, requireAdmin } from '../middleware/auth';

const router = Router();

// GET /api/programs?weekId=&current=1&racetrackId=
router.get('/', async (req, res, next) => {
  try {
    const weekId = req.query.weekId ? Number(req.query.weekId) : undefined;
    const racetrackId = req.query.racetrackId ? Number(req.query.racetrackId) : undefined;
    const current = req.query.current === '1';

    const where: any = {};
    if (weekId) where.weekId = weekId;
    else if (current) {
      const latestWeek = await prisma.raceWeek.findFirst({
        orderBy: [{ year: 'desc' }, { weekNumber: 'desc' }],
      });
      if (!latestWeek) return res.json([]);
      where.weekId = latestWeek.id;
    }
    if (racetrackId) where.racetrackId = racetrackId;

    const programs = await prisma.program.findMany({
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
      },
      orderBy: [{ programDate: 'asc' }],
    });
    res.json(programs);
  } catch (e) {
    next(e);
  }
});

router.get('/weeks', async (_req, res, next) => {
  try {
    const weeks = await prisma.raceWeek.findMany({
      orderBy: [{ year: 'desc' }, { weekNumber: 'desc' }],
    });
    res.json(weeks);
  } catch (e) {
    next(e);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const program = await prisma.program.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        racetrack: true,
        week: true,
        races: {
          include: { horses: { orderBy: { number: 'asc' } }, result: true },
          orderBy: { raceNumber: 'asc' },
        },
      },
    });
    if (!program) return res.status(404).json({ error: 'Programa no existe' });
    res.json(program);
  } catch (e) {
    next(e);
  }
});

// Admin: create week (kept here for admin convenience)
const weekSchema = z.object({
  year: z.number().int(),
  weekNumber: z.number().int().min(1).max(53),
  startDate: z.string(),
  endDate: z.string(),
});

router.post('/weeks', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const data = weekSchema.parse(req.body);
    const week = await prisma.raceWeek.create({
      data: {
        year: data.year,
        weekNumber: data.weekNumber,
        startDate: new Date(data.startDate),
        endDate: new Date(data.endDate),
      },
    });
    res.status(201).json(week);
  } catch (e) {
    next(e);
  }
});

// Admin: create program + races + horses in one shot (stepper wizard)
const createProgramSchema = z.object({
  racetrackId: z.number().int(),
  weekId: z.number().int().optional(),
  name: z.string().min(1).max(120),
  programDate: z.string(),
  deadline: z.string(),
  races: z
    .array(
      z.object({
        raceNumber: z.number().int().min(1),
        horses: z
          .array(
            z.object({
              number: z.number().int().min(1),
              name: z.string().optional(),
              odds: z.number().positive().optional().nullable(),
            }),
          )
          .min(2),
      }),
    )
    .min(1),
});

function getISOWeek(d: Date): { year: number; week: number } {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year: date.getUTCFullYear(), week };
}

async function resolveWeekId(programDate: Date): Promise<number> {
  const { year, week } = getISOWeek(programDate);
  const startDate = new Date(programDate);
  startDate.setHours(0, 0, 0, 0);
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 7);
  const w = await prisma.raceWeek.upsert({
    where: { year_weekNumber: { year, weekNumber: week } },
    update: {},
    create: { year, weekNumber: week, startDate, endDate },
  });
  return w.id;
}

router.post('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const data = createProgramSchema.parse(req.body);
    const programDate = new Date(data.programDate);
    const weekId = data.weekId ?? (await resolveWeekId(programDate));
    const program = await prisma.$transaction(async (tx) => {
      const p = await tx.program.create({
        data: {
          racetrackId: data.racetrackId,
          weekId,
          name: data.name,
          programDate,
          deadline: new Date(data.deadline),
        },
      });
      for (const r of data.races) {
        const race = await tx.race.create({
          data: { programId: p.id, raceNumber: r.raceNumber },
        });
        await tx.horse.createMany({
          data: r.horses.map((h) => ({
            raceId: race.id,
            number: h.number,
            name: h.name && h.name.trim() ? h.name.trim() : `Caballo ${h.number}`,
            odds: h.odds ?? null,
          })),
        });
      }
      return p;
    });

    const full = await prisma.program.findUnique({
      where: { id: program.id },
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

router.delete('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    await prisma.program.delete({ where: { id: Number(req.params.id) } });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

// Admin: update deadline / name
const updateProgramSchema = z.object({
  name: z.string().optional(),
  programDate: z.string().optional(),
  deadline: z.string().optional(),
  status: z.enum(['OPEN', 'CLOSED', 'SETTLED']).optional(),
});

router.put('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const data = updateProgramSchema.parse(req.body);
    const updateData: any = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.programDate) updateData.programDate = new Date(data.programDate);
    if (data.deadline) updateData.deadline = new Date(data.deadline);
    if (data.status) updateData.status = data.status;
    const p = await prisma.program.update({
      where: { id: Number(req.params.id) },
      data: updateData,
    });
    res.json(p);
  } catch (e) {
    next(e);
  }
});

// GET /api/programs/:id/picks — public visibility of all users' cartillas for transparency
router.get('/:id/picks', requireAuth, async (req, res, next) => {
  try {
    const programId = Number(req.params.id);
    const program = await prisma.program.findUnique({
      where: { id: programId },
      include: { races: true },
    });
    if (!program) return res.status(404).json({ error: 'Programa no existe' });

    const raceIds = program.races.map((r) => r.id);
    const picks = await prisma.pick.findMany({
      where: { raceId: { in: raceIds } },
      include: {
        horse: true,
        user: { select: { id: true, displayName: true, email: true } },
      },
      orderBy: [{ userId: 'asc' }, { raceId: 'asc' }],
    });

    // Group by user
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

// Submit cartilla (batch picks) for a program
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
    const programId = Number(req.params.id);
    const { picks } = batchPickSchema.parse(req.body);

    const program = await prisma.program.findUnique({
      where: { id: programId },
      include: {
        races: { include: { horses: true } },
      },
    });
    if (!program) return res.status(404).json({ error: 'Programa no existe' });
    if (new Date() > program.deadline) {
      return res.status(403).json({ error: 'Deadline del programa expirado' });
    }
    if (program.status !== 'OPEN') {
      return res.status(403).json({ error: 'Programa cerrado' });
    }

    // Validate: one pick per race, all races covered, horse belongs to race
    const racesById = new Map(program.races.map((r: any) => [r.id, r]));
    const racesSeen = new Set<number>();
    for (const p of picks) {
      const race = racesById.get(p.raceId);
      if (!race) {
        return res.status(400).json({ error: `Carrera ${p.raceId} no pertenece al programa` });
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
    if (racesSeen.size !== program.races.length) {
      return res
        .status(400)
        .json({ error: 'Debes elegir un caballo por cada carrera del programa' });
    }

    const userId = req.user!.id;
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

export default router;
