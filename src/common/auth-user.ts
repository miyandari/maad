import { Role } from '@prisma/client';

/** What the JWT strategy attaches to req.user (always re-read from the DB). */
export interface AuthUser {
  id: string;
  role: Role;
  universityId: string | null;
  dormitoryId: string | null;
  mustChangePassword?: boolean;
  permissions?: string[];
}
