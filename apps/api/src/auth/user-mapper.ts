import type { UserDto } from '@food/shared';
import type { Prisma } from '../generated/prisma/client.js';

export const USER_DTO_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
} as const satisfies Prisma.UserSelect;

export function toUserDto(user: UserDto): UserDto {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}
