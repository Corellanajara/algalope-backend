import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../db';
import { signToken, requireAuth } from '../middleware/auth';

const router = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  displayName: z.string().min(2).max(50),
});

router.post('/register', async (req, res, next) => {
  try {
    const data = registerSchema.parse(req.body);
    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing) return res.status(409).json({ error: 'Email ya registrado' });

    const passwordHash = await bcrypt.hash(data.password, 10);
    const userCount = await prisma.user.count();
    const user = await prisma.user.create({
      data: {
        email: data.email,
        passwordHash,
        displayName: data.displayName,
        role: userCount === 0 ? 'ADMIN' : 'USER',
      },
    });
    const token = signToken({
      id: user.id,
      email: user.email,
      role: user.role,
      displayName: user.displayName,
    });
    res.status(201).json({
      token,
      user: { id: user.id, email: user.email, role: user.role, displayName: user.displayName },
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
      role: user.role,
      displayName: user.displayName,
    });
    res.json({
      token,
      user: { id: user.id, email: user.email, role: user.role, displayName: user.displayName },
    });
  } catch (e) {
    next(e);
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

export default router;
