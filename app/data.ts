import { prisma } from "../src/db/prisma";
import {
  CHANNEL_SNAPSHOT_SCHEMA_VERSION,
  type ChannelSnapshotDocument,
  type ChannelSnapshotHeroTheme,
  type SnapshotGeneratedImage,
  type SnapshotSignal,
} from "../src/snapshots/sourceSnapshotSchema";
import { sourceSlug } from "./sourceSlug";

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

  const document = await buildSnapshotReadModel(snapshot);

  const evidenceIds = collectEvidenceMessageIds(document);
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
          formats: {
            where: {
              model: process.env.AI_MODEL || "unknown",
            },
            take: 1,
          },
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
    document,
    chat: snapshot.source,
    evidenceMessages: evidenceItems.map((message) => ({
      ...message,
      user: message.actor,
    })),
    topPeople,
  };
}

async function findSourceBySlug(slug: string) {
  const normalizedSlug = slug.trim().toLowerCase();
  const sources = await prisma.source.findMany({
    select: {
      id: true,
      provider: true,
      externalId: true,
      type: true,
      title: true,
      username: true,
      url: true,
      audienceCount: true,
      metadata: true,
      createdAt: true,
      updatedAt: true,
      lastImportAt: true,
    },
  });

  return sources.find((source) => sourceSlug(source.username || source.title) === normalizedSlug) ??
    sources.find((source) => source.id === slug) ??
    null;
}

async function sourceSignalsAsDocumentSignals(sourceId: string): Promise<SnapshotSignal[]> {
  const rows = await prisma.sourceSignal.findMany({
    where: {
      sourceId,
      status: "active",
    },
    include: {
      evidence: {
        orderBy: {
          createdAt: "asc",
        },
      },
    },
    orderBy: [
      {
        lastEvidenceAt: "desc",
      },
      {
        updatedAt: "desc",
      },
    ],
  });

  return rows.map((row) => {
    const metadata = recordObject(row.metadata);
    const person = jsonObjectValue<SnapshotSignal["person"]>(metadata.person);
    const metrics = jsonObjectValue<SnapshotSignal["metrics"]>(metadata.metrics);
    const timeline = jsonObjectValue<SnapshotSignal["timeline"]>(metadata.timeline) ?? {
      firstEvidenceAt: row.firstEvidenceAt?.toISOString(),
      lastEvidenceAt: row.lastEvidenceAt?.toISOString(),
      primaryEvidenceItemId: row.evidence[0]?.itemExternalId,
    };

    return {
      id: row.id,
      kind: row.kind as SnapshotSignal["kind"],
      title: row.title,
      summary: row.summary,
      tags: Array.isArray(row.tags) ? row.tags.filter((tag): tag is string => typeof tag === "string") : [],
      priority: row.score >= 8 ? "high" : row.score >= 5 ? "medium" : "low",
      score: row.score ? String(row.score) : undefined,
      confidence: row.confidence ?? undefined,
      metrics: Array.isArray(metrics) ? metrics : undefined,
      evidence: row.evidence.map((item) => ({
        itemId: item.itemExternalId,
        quote: item.quote ?? undefined,
        reason: item.reason ?? undefined,
      })),
      person,
      previewImage: jsonObjectValue<SnapshotSignal["previewImage"]>(row.previewImage),
      timeline,
    };
  });
}

async function buildSourceReadModel(source: Awaited<ReturnType<typeof findSourceBySlug>>): Promise<ChannelSnapshotDocument | null> {
  if (!source) {
    return null;
  }

  const [signals, latestSnapshot] = await Promise.all([
    sourceSignalsAsDocumentSignals(source.id),
    prisma.sourceSnapshot.findFirst({
      where: {
        sourceId: source.id,
        status: "completed",
      },
      orderBy: {
        completedAt: "desc",
      },
      select: {
        createdAt: true,
        periodFrom: true,
        periodTo: true,
        summary: true,
        heroTheme: true,
        coverImage: true,
      },
    }),
  ]);

  if (!signals.length) {
    return null;
  }

  return {
    schemaVersion: CHANNEL_SNAPSHOT_SCHEMA_VERSION,
    snapshotType: "channel",
    title: `${source.title} — карта сигналов`,
    sourceId: source.id,
    chatTitle: source.title,
    summary: latestSnapshot?.summary ?? null,
    generatedAt: (latestSnapshot?.createdAt ?? new Date()).toISOString(),
    period: {
      from: latestSnapshot?.periodFrom?.toISOString() ?? null,
      to: latestSnapshot?.periodTo?.toISOString() ?? null,
    },
    heroTheme: jsonObjectValue<ChannelSnapshotHeroTheme>(latestSnapshot?.heroTheme),
    coverImage: jsonObjectValue<SnapshotGeneratedImage>(latestSnapshot?.coverImage),
    signals,
  };
}

async function buildSourceView(source: Awaited<ReturnType<typeof findSourceBySlug>>, document: ChannelSnapshotDocument) {
  if (!source) {
    return null;
  }

  const evidenceIds = collectEvidenceMessageIds(document);
  const evidenceItems = evidenceIds.length === 0
    ? []
    : await prisma.contentItem.findMany({
        where: {
          sourceId: source.id,
          externalId: {
            in: evidenceIds,
          },
        },
        include: {
          actor: true,
          formats: {
            where: {
              model: process.env.AI_MODEL || "unknown",
            },
            take: 1,
          },
        },
      });
  const peopleMessageKind = source.type === "group" ? "post" : "comment";
  const topPeopleGroups = await prisma.contentItem.groupBy({
    by: ["actorId"],
    where: {
      sourceId: source.id,
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
            sourceId: source.id,
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
    id: source.id,
    sourceId: source.id,
    title: document.title,
    status: "completed",
    document,
    chat: source,
    evidenceMessages: evidenceItems.map((message) => ({
      ...message,
      user: message.actor,
    })),
    topPeople,
  };
}

export async function getSourceSignalMap(slug: string) {
  const source = await findSourceBySlug(slug);
  const document = await buildSourceReadModel(source);

  if (!source || !document) {
    return null;
  }

  return buildSourceView(source, document);
}

type SnapshotReadRecord = {
  id: string;
  sourceId: string;
  title: string;
  document: unknown;
  periodFrom?: Date | null;
  periodTo?: Date | null;
  summary?: string | null;
  heroTheme?: unknown;
  coverImage?: unknown;
  createdAt: Date;
  source?: {
    title: string;
  } | null;
};

function recordObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function jsonObjectValue<T>(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as T : undefined;
}

async function snapshotSignalsAsDocumentSignals(snapshotId: string): Promise<SnapshotSignal[]> {
  const rows = await prisma.snapshotSignal.findMany({
    where: {
      snapshotId,
    },
    include: {
      evidence: {
        orderBy: {
          position: "asc",
        },
      },
    },
    orderBy: [
      {
        sortAt: "desc",
      },
      {
        createdAt: "asc",
      },
    ],
  });

  return rows.map((row) => ({
    id: row.externalSignalId,
    kind: row.kind as SnapshotSignal["kind"],
    title: row.title,
    summary: row.summary,
    tags: Array.isArray(row.tags) ? row.tags.filter((tag): tag is string => typeof tag === "string") : [],
    priority: row.priority as SnapshotSignal["priority"],
    score: row.score ?? undefined,
    confidence: row.confidence ?? undefined,
    metrics: Array.isArray(row.metrics) ? row.metrics as SnapshotSignal["metrics"] : undefined,
    evidence: row.evidence.map((item) => ({
      itemId: item.itemExternalId,
      quote: item.quote ?? undefined,
      reason: item.reason ?? undefined,
    })),
    url: row.url ?? undefined,
    person: jsonObjectValue<SnapshotSignal["person"]>(row.person),
    previewImage: jsonObjectValue<SnapshotSignal["previewImage"]>(row.previewImage),
    timeline: jsonObjectValue<SnapshotSignal["timeline"]>(row.timeline),
  }));
}

async function buildSnapshotReadModel(snapshot: SnapshotReadRecord): Promise<ChannelSnapshotDocument | null> {
  const signals = await snapshotSignalsAsDocumentSignals(snapshot.id);

  if (!signals.length) {
    return null;
  }

  const metadata = recordObject(snapshot.document);
  const period = recordObject(metadata.period);

  return {
    schemaVersion: CHANNEL_SNAPSHOT_SCHEMA_VERSION,
    snapshotType: "channel",
    title: stringValue(metadata.title) ?? snapshot.title,
    sourceId: stringValue(metadata.sourceId) ?? snapshot.sourceId,
    chatTitle: stringValue(metadata.chatTitle) ?? snapshot.source?.title ?? snapshot.title.replace(/^Снимок по каналу:\s*/i, ""),
    summary: stringValue(metadata.summary) ?? snapshot.summary ?? null,
    generatedAt: stringValue(metadata.generatedAt) ?? snapshot.createdAt.toISOString(),
    period: {
      from: snapshot.periodFrom?.toISOString() ?? stringValue(period.from) ?? null,
      to: snapshot.periodTo?.toISOString() ?? stringValue(period.to) ?? null,
    },
    heroTheme: jsonObjectValue<ChannelSnapshotHeroTheme>(snapshot.heroTheme) ?? jsonObjectValue<ChannelSnapshotHeroTheme>(metadata.heroTheme),
    coverImage: jsonObjectValue<SnapshotGeneratedImage>(snapshot.coverImage) ?? jsonObjectValue<SnapshotGeneratedImage>(metadata.coverImage),
    signals,
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
