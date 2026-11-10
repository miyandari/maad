import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const username = process.env.SEED_ADMIN_USERNAME;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!username || !password || password.length < 6) {
    throw new Error('Set SEED_ADMIN_USERNAME and SEED_ADMIN_PASSWORD (min 6 chars) in .env');
  }
  await prisma.user.upsert({
    where: { username },
    update: {},
    create: {
      username,
      passwordHash: await bcrypt.hash(password, 12),
      firstName: 'مدیرکل',
      lastName: 'سیستم',
      role: Role.SUPER_ADMIN,
      permissions: ['sms.send'],
    },
  });
  console.log(`Super admin "${username}" is ready.`);
}

main().finally(() => prisma.$disconnect());
