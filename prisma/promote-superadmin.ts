// Promueve un usuario existente a SUPERADMIN.
//
// Uso:
//   npm run promote:superadmin -- usuario@example.com
//
// El usuario debe existir (puede haberse registrado por la vía pública). El
// rol SUPERADMIN no pertenece a ningún tenant: adminId queda en NULL.

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    console.error('❌ Falta el email. Uso: npm run promote:superadmin -- email@dominio.com');
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`❌ No existe ningún usuario con email ${email}`);
    process.exit(1);
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { role: 'SUPERADMIN', adminId: null },
    select: { id: true, email: true, displayName: true, role: true },
  });

  console.log('👑 Usuario promovido a SUPERADMIN:', updated);
}

main()
  .catch((e) => {
    console.error('Falló la promoción:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
