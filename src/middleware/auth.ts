import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../db';

export type Role = 'SUPERADMIN' | 'ADMIN' | 'USER';

export interface AuthUser {
  id: number;
  email: string;
  role: Role;
  displayName: string;
  adminId: number | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

export function signToken(user: AuthUser) {
  return jwt.sign(user, JWT_SECRET, { expiresIn: '7d' });
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No autenticado' });
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as AuthUser;
    const user = await prisma.user.findUnique({ where: { id: payload.id } });
    if (!user) return res.status(401).json({ error: 'Usuario no existe' });
    req.user = {
      id: user.id,
      email: user.email,
      role: user.role as Role,
      displayName: user.displayName,
      adminId: (user as any).adminId ?? null,
    };
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido' });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const role = req.user?.role;
  if (role !== 'ADMIN' && role !== 'SUPERADMIN') {
    return res.status(403).json({ error: 'Requiere rol ADMIN' });
  }
  next();
}

export function requireSuperadmin(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== 'SUPERADMIN') {
    return res.status(403).json({ error: 'Requiere rol SUPERADMIN' });
  }
  next();
}

// Devuelve el adminId que define el "tenant" de la petición:
//   - ADMIN  → su propio id (es dueño del tenant).
//   - USER   → el id de su admin asignado.
//   - SUPERADMIN → null (ve todo o filtra por query param `?adminId=`).
//
// Las rutas usan esto para filtrar todas las queries por tenant.
export function getTenantAdminId(req: Request): number | null {
  const u = req.user;
  if (!u) return null;
  if (u.role === 'ADMIN') return u.id;
  if (u.role === 'USER') return u.adminId;
  // SUPERADMIN: opcionalmente puede mirar el tenant de un admin específico
  // mediante ?adminId= o header x-admin-id; si no, ve todo (null).
  const q = req.query.adminId ?? req.headers['x-admin-id'];
  if (q != null && q !== '') {
    const n = Number(q);
    if (Number.isFinite(n)) return n;
  }
  return null;
}
