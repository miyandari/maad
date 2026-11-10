import { SetMetadata } from '@nestjs/common';
export const ALLOW_PW_CHANGE = 'allowPasswordChange';
/** Routes reachable while the account still has to change its initial password. */
export const AllowPasswordChange = () => SetMetadata(ALLOW_PW_CHANGE, true);
