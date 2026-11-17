import { SetMetadata } from '@nestjs/common';
export const ALLOW_STUDENT = 'allowStudent';
/** Opens a route without @Roles to student sessions too (students are denied everywhere else). */
export const AllowStudent = () => SetMetadata(ALLOW_STUDENT, true);
