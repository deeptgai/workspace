import { prisma } from "../src/db/prisma";

export async function getSourcesOverview() {
  const chats = await prisma.source.findMany({
    orderBy: {
      updatedAt: "desc",
    },
    include: {
      _count: {
        select: {
          items: true,
          snapshots: true,
        },
      },
      snapshots: {
        orderBy: {
          createdAt: "desc",
        },
        take: 1,
      },
    },
  });
  const embeddingCounts = await prisma.$queryRaw<Array<{ sourceId: string; count: bigint }>>`
    select m."sourceId" as "sourceId", count(distinct e."itemId") as "count"
    from "ContentEmbedding" e
    join "ContentItem" m on m."id" = e."itemId"
    group by m."sourceId"
  `;
  const embeddingCountBySource = new Map(
    embeddingCounts.map((item) => [item.sourceId, Number(item.count)]),
  );

  return Promise.all(
    chats.map(async (chat) => {
      const aggregate = await prisma.contentItem.aggregate({
        where: {
          sourceId: chat.id,
        },
        _sum: {
          views: true,
          forwards: true,
          reactionsTotal: true,
          repliesCount: true,
        },
        _avg: {
          engagementScore: true,
        },
      });

      return {
        ...chat,
        _count: {
          items: chat._count.items,
          snapshots: chat._count.snapshots,
        },
        aggregate,
        embeddedCount: embeddingCountBySource.get(chat.id) ?? 0,
        latestSnapshot: chat.snapshots[0] ?? null,
      };
    }),
  );
}

export async function getSourceDetail(sourceId: string) {
  const chat = await prisma.source.findUnique({
    where: {
      id: sourceId,
    },
    include: {
      snapshots: {
        orderBy: {
          createdAt: "desc",
        },
        include: {
          sections: {
            orderBy: {
              createdAt: "asc",
            },
            select: {
              sectionId: true,
              title: true,
              agent: true,
              status: true,
              error: true,
            },
          },
        },
      },
      items: {
        orderBy: {
          engagementScore: "desc",
        },
        take: 20,
        select: {
          id: true,
          externalId: true,
          publishedAt: true,
          text: true,
          views: true,
          forwards: true,
          reactionsTotal: true,
          repliesCount: true,
          engagementScore: true,
        },
      },
      _count: {
        select: {
          items: true,
          snapshots: true,
        },
      },
    },
  });

  if (!chat) {
    return null;
  }

  const peopleMessageKind = chat.type === "group" ? "post" : "comment";
  const [aggregate, embeddingCount, commentCount, commentUserCount] = await Promise.all([
    prisma.contentItem.aggregate({
      where: {
        sourceId,
      },
      _sum: {
        views: true,
        forwards: true,
        reactionsTotal: true,
        repliesCount: true,
      },
      _avg: {
        views: true,
        engagementScore: true,
      },
      _max: {
        engagementScore: true,
      },
    }),
    prisma.contentEmbedding.count({
      where: {
        item: {
          sourceId,
        },
      },
    }),
    prisma.contentItem.count({
      where: {
        sourceId,
        kind: "comment",
      },
    }),
    prisma.contentItem.groupBy({
      by: ["actorId"],
      where: {
        sourceId,
        kind: peopleMessageKind,
        actorId: {
          not: null,
        },
      },
    }).then((rows) => rows.length),
  ]);

  return {
    chat: {
      ...chat,
      items: chat.items,
      _count: {
        items: chat._count.items,
        snapshots: chat._count.snapshots,
      },
    },
    aggregate,
    embeddingCount,
    commentCount,
    commentUserCount,
  };
}

export async function getSnapshot(snapshotId: string) {
  const snapshot = await prisma.sourceSnapshot.findUnique({
    where: {
      id: snapshotId,
    },
    include: {
      source: true,
    },
  });

  if (!snapshot) {
    return null;
  }

  const evidenceIds = collectEvidenceMessageIds(snapshot.document);
  const evidenceItems = evidenceIds.length === 0
    ? []
    : await prisma.contentItem.findMany({
        where: {
          sourceId: snapshot.sourceId,
          externalId: {
            in: evidenceIds,
          },
        },
        include: {
          actor: true,
        },
      });
  const peopleMessageKind = snapshot.source.type === "group" ? "post" : "comment";

  const topPeopleGroups = await prisma.contentItem.groupBy({
    by: ["actorId"],
    where: {
      sourceId: snapshot.sourceId,
      kind: peopleMessageKind,
      actorId: {
        not: null,
      },
    },
    _count: {
      _all: true,
    },
    _sum: {
      reactionsTotal: true,
      repliesCount: true,
    },
    _avg: {
      engagementScore: true,
    },
    _max: {
      publishedAt: true,
    },
    orderBy: {
      _count: {
        actorId: "desc",
      },
    },
    take: 500,
  });
  const actorIds = topPeopleGroups.flatMap((group) => group.actorId ? [group.actorId] : []);
  const [actors, exampleMessages] = await Promise.all([
    actorIds.length
      ? prisma.actor.findMany({
          where: {
            id: {
              in: actorIds,
            },
          },
          select: {
            id: true,
            externalId: true,
            username: true,
            firstName: true,
            lastName: true,
            photo: true,
          },
        })
      : [],
    actorIds.length
      ? prisma.contentItem.findMany({
          where: {
            sourceId: snapshot.sourceId,
            kind: peopleMessageKind,
            actorId: {
              in: actorIds,
            },
            text: {
              not: null,
            },
          },
          orderBy: {
            engagementScore: "desc",
          },
          take: actorIds.length * 4,
          select: {
            actorId: true,
            externalId: true,
            text: true,
            publishedAt: true,
            parent: {
              select: {
                externalId: true,
                text: true,
                publishedAt: true,
              },
            },
          },
        })
      : [],
  ]);
  const actorById = new Map(actors.map((actor) => [actor.id, actor]));
  const examplesByActorId = new Map<string, typeof exampleMessages>();

  for (const message of exampleMessages) {
    if (!message.actorId) {
      continue;
    }

    const examples = examplesByActorId.get(message.actorId) ?? [];

    if (examples.length >= 2) {
      continue;
    }

    examples.push(message);
    examplesByActorId.set(message.actorId, examples);
  }

  const topPeople = topPeopleGroups.flatMap((group) => {
    if (!group.actorId) {
      return [];
    }

    return [{
      user: actorById.get(group.actorId) ?? null,
      comments: group._count._all,
      reactions: group._sum.reactionsTotal ?? 0,
      replies: group._sum.repliesCount ?? 0,
      avgEngagement: group._avg.engagementScore ?? 0,
      lastCommentAt: group._max.publishedAt,
      examples: examplesByActorId.get(group.actorId) ?? [],
    }];
  });

  return {
    ...snapshot,
    chat: snapshot.source,
    evidenceMessages: evidenceItems.map((message) => ({
      ...message,
      user: message.actor,
    })),
    topPeople,
  };
}

function collectEvidenceMessageIds(value: unknown): string[] {
  const ids = new Set<string>();

  function visit(node: unknown) {
    if (!node || typeof node !== "object") {
      return;
    }

    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item);
      }
      return;
    }

    const record = node as Record<string, unknown>;

    if (typeof record.itemId === "string" && record.itemId.trim()) {
      ids.add(record.itemId.trim());
    } else if (typeof record.externalId === "string" && record.externalId.trim()) {
      ids.add(record.externalId.trim());
    } else if (Number.isInteger(record.itemId)) {
      ids.add(String(record.itemId));
    }

    for (const item of Object.values(record)) {
      visit(item);
    }
  }

  visit(value);

  return [...ids];
}

export async function getMessageDetail(sourceId: string, externalId: string) {
  const item = await prisma.contentItem.findFirst({
    where: {
      sourceId,
      externalId,
    },
    orderBy: {
      kind: "desc",
    },
    include: {
      source: true,
      actor: true,
      embeddings: {
        select: {
          model: true,
          dimensions: true,
          createdAt: true,
        },
      },
    },
  });

  return item ? {
    ...item,
    chat: item.source,
    user: item.actor,
    replyTo: item.replyToExternalId,
  } : null;
}

export function formatNumber(value: number | null | undefined) {
  return new Intl.NumberFormat("en-US").format(value ?? 0);
}

export function formatDateTime(value: Date | string | null | undefined) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatDate(value: Date | string | null | undefined) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date(value));
}

export function compactText(text: string | null | undefined, maxLength = 120) {
  const value = (text ?? "<no text>").replace(/\s+/g, " ").trim();
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}
