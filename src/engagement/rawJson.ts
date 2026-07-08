import { Prisma, type PrismaClient } from "@prisma/client";

type JsonObject = Record<string, unknown>;

export type RawEngagementData = {
  reactionsTotal: number;
  reactionCounts: Prisma.InputJsonValue;
  repliesCount: number;
  hasComments: boolean;
  commentsPeerId: string | null;
  engagementScore: number;
};

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function getReactionKey(reaction: unknown): string {
  if (!isObject(reaction)) {
    return "unknown";
  }

  const emoticon = reaction.emoticon;

  if (typeof emoticon === "string" && emoticon.length > 0) {
    return emoticon;
  }

  const documentId = reaction.documentId;

  if (typeof documentId === "string" || typeof documentId === "number") {
    return String(documentId);
  }

  const className = reaction.className;

  if (className === "ReactionPaid") {
    return "paid";
  }

  return "unknown";
}

export function extractEngagementFromRawJson(rawJson: unknown): RawEngagementData {
  const raw = isObject(rawJson) ? rawJson : {};
  const reactions = isObject(raw.reactions) ? raw.reactions : {};
  const reactionResults = Array.isArray(reactions.results) ? reactions.results : [];
  const reactionCounts: Record<string, number> = {};

  for (const reactionResult of reactionResults) {
    if (!isObject(reactionResult)) {
      continue;
    }

    const key = getReactionKey(reactionResult.reaction);
    reactionCounts[key] = (reactionCounts[key] ?? 0) + getNumber(reactionResult.count);
  }

  const replies = isObject(raw.replies) ? raw.replies : {};
  const views = getNumber(raw.views);
  const forwards = getNumber(raw.forwards);
  const reactionsTotal = Object.values(reactionCounts).reduce((sum, count) => sum + count, 0);
  const repliesCount = getNumber(replies.replies);
  const hasComments = replies.comments === true;
  const channelId = replies.channelId;
  const commentsPeerId = typeof channelId === "string" || typeof channelId === "number"
    ? String(channelId)
    : null;

  return {
    reactionsTotal,
    reactionCounts,
    repliesCount,
    hasComments,
    commentsPeerId,
    engagementScore: reactionsTotal + forwards * 2 + repliesCount * 3 + views * 0.01,
  };
}

export async function backfillEngagementFromRawJson(prisma: PrismaClient): Promise<number> {
  const messages = await prisma.contentItem.findMany({
    select: {
      id: true,
      rawJson: true,
    },
  });

  for (const message of messages) {
    const engagement = extractEngagementFromRawJson(message.rawJson);

    await prisma.contentItem.update({
      where: {
        id: message.id,
      },
      data: engagement,
    });
  }

  return messages.length;
}
