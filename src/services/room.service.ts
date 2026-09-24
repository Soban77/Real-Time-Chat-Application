import { Prisma } from '@prisma/client';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function roomLookup(roomId: string): Prisma.RoomWhereInput {
  return UUID_PATTERN.test(roomId)
    ? { OR: [{ id: roomId }, { slug: roomId }] }
    : { slug: roomId };
}
