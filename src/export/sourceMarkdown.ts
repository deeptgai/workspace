import type { PrismaClient } from "@prisma/client";

type ExportSourceMarkdownOptions = {
  sourceId: string;
};

function formatDate(value: Date | string | null | undefined) {
  if (!value) {
    return "-";
  }

  return new Date(value).toISOString();
}

function text(value: string | null | undefined) {
  return value?.trim() || "-";
}

function oneLine(value: string | null | undefined) {
  return text(value).replace(/\s+/g, " ");
}

function frontmatterValue(value: string | number | null | undefined) {
  if (value === null || value === undefined) {
    return "null";
  }

  return JSON.stringify(value);
}

function metricLine(label: string, value: string | number | null | undefined) {
  return `- ${label}: ${value ?? 0}`;
}

function actorName(actor: { username: string | null; displayName: string | null; firstName: string | null; lastName: string | null; externalId: string } | null) {
  if (!actor) {
    return "-";
  }

  return actor.username
    ? `@${actor.username}`
    : actor.displayName || [actor.firstName, actor.lastName].filter(Boolean).join(" ") || actor.externalId;
}

export function sourceMarkdownFileName(source: { title: string; username: string | null; externalId: string }) {
  const base = (source.username || source.externalId || source.title)
    .replace(/^@/, "")
    .toLowerCase()
    .replace(/[^a-z0-9а-яё_-]+/giu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "source";

  return `${base}-context.md`;
}

export async function exportSourceMarkdown(
  prisma: PrismaClient,
  options: ExportSourceMarkdownOptions,
) {
  const source = await prisma.source.findUnique({
    where: {
      id: options.sourceId,
    },
    include: {
      importStates: {
        orderBy: {
          updatedAt: "desc",
        },
      },
    },
  });

  if (!source) {
    throw new Error(`Source not found: ${options.sourceId}`);
  }

  const [aggregate, embeddingCount, actorGroups, items] = await Promise.all([
    prisma.contentItem.aggregate({
      where: {
        sourceId: source.id,
      },
      _count: {
        _all: true,
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
        publishedAt: true,
      },
      _min: {
        publishedAt: true,
      },
    }),
    prisma.contentEmbedding.count({
      where: {
        item: {
          sourceId: source.id,
        },
      },
    }),
    prisma.contentItem.groupBy({
      by: ["actorId"],
      where: {
        sourceId: source.id,
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
      _max: {
        publishedAt: true,
      },
      orderBy: {
        _count: {
          actorId: "desc",
        },
      },
      take: 500,
    }),
    prisma.contentItem.findMany({
      where: {
        sourceId: source.id,
      },
      orderBy: [
        {
          publishedAt: "asc",
        },
        {
          externalId: "asc",
        },
      ],
      include: {
        actor: {
          select: {
            externalId: true,
            username: true,
            displayName: true,
            firstName: true,
            lastName: true,
            url: true,
            isBot: true,
          },
        },
        parent: {
          select: {
            externalId: true,
            publishedAt: true,
            text: true,
          },
        },
        embeddings: {
          select: {
            model: true,
            dimensions: true,
            createdAt: true,
          },
        },
      },
    }),
  ]);

  const actors = await prisma.actor.findMany({
    where: {
      id: {
        in: actorGroups.flatMap((group) => group.actorId ? [group.actorId] : []),
      },
    },
    select: {
      id: true,
      externalId: true,
      username: true,
      displayName: true,
      firstName: true,
      lastName: true,
      url: true,
      isBot: true,
    },
  });
  const actorById = new Map(actors.map((actor) => [actor.id, actor]));

  const lines: string[] = [
    "---",
    `sourceId: ${frontmatterValue(source.id)}`,
    `provider: ${frontmatterValue(source.provider)}`,
    `externalId: ${frontmatterValue(source.externalId)}`,
    `type: ${frontmatterValue(source.type)}`,
    `title: ${frontmatterValue(source.title)}`,
    `username: ${frontmatterValue(source.username)}`,
    `exportedAt: ${frontmatterValue(new Date().toISOString())}`,
    "---",
    "",
    `# ${source.title}`,
    "",
    source.username ? `Source: [@${source.username}](https://t.me/${source.username})` : `Source external id: ${source.externalId}`,
    "",
    "## Source",
    "",
    metricLine("Provider", source.provider),
    metricLine("Type", source.type),
    metricLine("Audience count", source.audienceCount),
    metricLine("URL", source.url),
    metricLine("Created at", formatDate(source.createdAt)),
    metricLine("Updated at", formatDate(source.updatedAt)),
    metricLine("Last import at", formatDate(source.lastImportAt)),
    "",
    "## Aggregate",
    "",
    metricLine("Items", aggregate._count._all),
    metricLine("Embeddings", embeddingCount),
    metricLine("Views", aggregate._sum.views),
    metricLine("Average views", Math.round(aggregate._avg.views ?? 0)),
    metricLine("Forwards", aggregate._sum.forwards),
    metricLine("Reactions", aggregate._sum.reactionsTotal),
    metricLine("Replies/comments", aggregate._sum.repliesCount),
    metricLine("Average engagement score", Number((aggregate._avg.engagementScore ?? 0).toFixed(2))),
    metricLine("Max engagement score", Number((aggregate._max.engagementScore ?? 0).toFixed(2))),
    metricLine("Oldest item", formatDate(aggregate._min.publishedAt)),
    metricLine("Newest item", formatDate(aggregate._max.publishedAt)),
    "",
    "## Import States",
    "",
  ];

  if (source.importStates.length === 0) {
    lines.push("- No import states.", "");
  } else {
    for (const state of source.importStates) {
      lines.push(
        `### ${state.scope}`,
        "",
        metricLine("Provider", state.provider),
        metricLine("Oldest external id", state.oldestExternalId),
        metricLine("Newest external id", state.newestExternalId),
        metricLine("Last import at", formatDate(state.lastImportAt)),
        "",
      );
    }
  }

  lines.push("## Actors", "");
  if (actorGroups.length === 0) {
    lines.push("- No actors.", "");
  } else {
    for (const group of actorGroups) {
      const actor = group.actorId ? actorById.get(group.actorId) ?? null : null;

      lines.push(
        `### ${actorName(actor ?? null)}`,
        "",
        metricLine("External id", actor?.externalId),
        metricLine("Username", actor?.username ? `@${actor.username}` : null),
        metricLine("URL", actor?.url),
        metricLine("Items/comments", group._count._all),
        metricLine("Reactions", group._sum.reactionsTotal),
        metricLine("Replies", group._sum.repliesCount),
        metricLine("Last seen", formatDate(group._max.publishedAt)),
        "",
      );
    }
  }

  const commentsByParentId = new Map<string, typeof items>();

  for (const item of items) {
    if (!item.parentId) {
      continue;
    }

    commentsByParentId.set(item.parentId, [
      ...(commentsByParentId.get(item.parentId) ?? []),
      item,
    ]);
  }

  const posts = items.filter((item) => !item.parentId && item.kind === "post");

  lines.push("## Raw Messages With Comments", "");
  if (posts.length === 0) {
    lines.push("- No posts.", "");
  } else {
    for (const post of posts) {
      const comments = commentsByParentId.get(post.id) ?? [];

      lines.push(
        `### Post #${post.externalId}`,
        "",
        metricLine("Content item id", post.id),
        metricLine("External id", post.externalId),
        metricLine("Published at", formatDate(post.publishedAt)),
        metricLine("Author", actorName(post.actor)),
        metricLine("Views", post.views),
        metricLine("Forwards", post.forwards),
        metricLine("Reactions", post.reactionsTotal),
        metricLine("Replies/comments", post.repliesCount),
        metricLine("Engagement score", Number(post.engagementScore.toFixed(2))),
        "",
        "Message text:",
        "",
        post.text?.trim() || "<no text>",
        "",
      );

      if (comments.length) {
        lines.push(`#### Comments for post #${post.externalId}`, "");

        for (const comment of comments) {
          lines.push(
            `##### Comment #${comment.externalId}`,
            "",
            metricLine("Content item id", comment.id),
            metricLine("External id", comment.externalId),
            metricLine("Published at", formatDate(comment.publishedAt)),
            metricLine("Author", actorName(comment.actor)),
            metricLine("Reactions", comment.reactionsTotal),
            metricLine("Replies", comment.repliesCount),
            metricLine("Engagement score", Number(comment.engagementScore.toFixed(2))),
            "",
            "Comment text:",
            "",
            comment.text?.trim() || "<no text>",
            "",
          );
        }
      } else {
        lines.push("- No imported comments for this post.", "");
      }
    }
  }

  const orphanItems = items.filter((item) => item.kind !== "post" && !item.parentId);

  if (orphanItems.length) {
    lines.push("## Raw Ungrouped Items", "");

    for (const item of orphanItems) {
      lines.push(
        `### ${item.kind} #${item.externalId}`,
        "",
        metricLine("Content item id", item.id),
        metricLine("Published at", formatDate(item.publishedAt)),
        metricLine("Author", actorName(item.actor)),
        "",
        item.text?.trim() || "<no text>",
        "",
        "",
      );
    }
  }

  lines.push("## Content Items Index", "");
  if (items.length === 0) {
    lines.push("- No content items.", "");
  } else {
    for (const item of items) {
      lines.push(
        `### ${item.kind} #${item.externalId}`,
        "",
        metricLine("ID", item.id),
        metricLine("Published at", formatDate(item.publishedAt)),
        metricLine("Author", actorName(item.actor)),
        metricLine("URL", item.url),
        metricLine("Parent external id", item.parent?.externalId),
        metricLine("Views", item.views),
        metricLine("Forwards", item.forwards),
        metricLine("Reactions", item.reactionsTotal),
        metricLine("Replies/comments", item.repliesCount),
        metricLine("Engagement score", Number(item.engagementScore.toFixed(2))),
        metricLine("Embeddings", item.embeddings.map((embedding) => `${embedding.model} (${embedding.dimensions})`).join(", ") || null),
        "",
      );

      if (item.parent) {
        lines.push(
          "Parent context:",
          "",
          `> ${oneLine(item.parent.text)}`,
          "",
        );
      }

      lines.push(
        "Text:",
        "",
        item.text?.trim() || "<no text>",
        "",
      );
    }
  }

  return {
    source,
    fileName: sourceMarkdownFileName(source),
    markdown: `${lines.join("\n").replace(/\n{3,}/g, "\n\n")}\n`,
  };
}
