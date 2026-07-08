import type { PrismaClient } from "@prisma/client";

export async function findStoredSource(prisma: PrismaClient, chat: string) {
  const normalizedChat = chat.trim().replace(/^@/, "").toLowerCase();

  return prisma.source.findFirst({
    where: {
      OR: [
        { id: chat },
        { externalId: chat },
        { username: { equals: normalizedChat, mode: "insensitive" } },
        { title: { equals: chat, mode: "insensitive" } },
      ],
    },
  });
}
