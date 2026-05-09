import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../db';
import { signToken, requireAuth, Role } from '../middleware/auth';

const router = Router();

// Registro público — solo se permite cuando todavía no hay usuarios en la
// base. Sirve únicamente para crear el primer usuario, que después se promueve
// a SUPERADMIN con `npm run promote:superadmin -- email`. A partir de ese
// momento los nuevos usuarios deben crearse desde el panel correspondiente
// (SUPERADMIN crea ADMINs, ADMIN crea sus USERs).
const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  displayName: z.string().min(2).max(50),
  pseudonym: z.string().min(2).max(50).optional(),
});

router.post('/register', async (req, res, next) => {
  try {
    const data = registerSchema.parse(req.body);
    const userCount = await prisma.user.count();
    if (userCount > 0) {
      return res
        .status(403)
        .json({ error: 'El registro público está deshabilitado. Pedí una cuenta a tu administrador.' });
    }

    const passwordHash = await bcrypt.hash(data.password, 10);
    const user = await prisma.user.create({
      data: {
        email: data.email,
        passwordHash,
        displayName: data.displayName,
        pseudonym: data.pseudonym?.trim() || null,
        // El primer usuario arranca como ADMIN; debe promoverse a SUPERADMIN
        // manualmente con el script CLI.
        role: 'ADMIN',
      },
    });
    const token = signToken({
      id: user.id,
      email: user.email,
      role: user.role as Role,
      displayName: user.displayName,
      adminId: (user as any).adminId ?? null,
    });
    res.status(201).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        displayName: user.displayName,
        pseudonym: user.pseudonym,
        adminId: (user as any).adminId ?? null,
      },
    });
  } catch (e) {
    next(e);
  }
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post('/login', async (req, res, next) => {
  try {
    const data = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: data.email } });
    if (!user) return res.status(401).json({ error: 'Credenciales inválidas' });
    const ok = await bcrypt.compare(data.password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Credenciales inválidas' });
    const token = signToken({
      id: user.id,
      email: user.email,
      role: user.role as Role,
      displayName: user.displayName,
      adminId: (user as any).adminId ?? null,
    });
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        displayName: user.displayName,
        pseudonym: user.pseudonym,
        adminId: (user as any).adminId ?? null,
      },
    });
  } catch (e) {
    next(e);
  }
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const u = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: {
        id: true,
        email: true,
        role: true,
        displayName: true,
        pseudonym: true,
        adminId: true,
      },
    });
    if (!u) return res.status(404).json({ error: 'Usuario no existe' });
    res.json({ user: u });
  } catch (e) {
    next(e);
  }
});

export default router;
