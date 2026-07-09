import type { getSnapshot } from "../data";

type Snapshot = NonNullable<Awaited<ReturnType<typeof getSnapshot>>>;

export function getSnapshotEvidenceMessages(snapshot: Snapshot) {
  return snapshot.evidenceMessages.map((message) => ({
    externalId: message.externalId,
    kind: message.kind,
    publishedAt: message.publishedAt.toISOString(),
    text: message.text,
    formattedText: message.formats[0]?.formattedText ?? null,
    views: message.views,
    forwards: message.forwards,
    reactionsTotal: message.reactionsTotal,
    repliesCount: message.repliesCount,
    engagementScore: message.engagementScore,
    user: message.user ? {
      externalId: message.user.externalId,
      username: message.user.username,
      firstName: message.user.firstName,
      lastName: message.user.lastName,
    } : null,
  }));
}

export function getSnapshotPeople(snapshot: Snapshot) {
  return snapshot.topPeople.map((person) => ({
    user: person.user ? {
      externalId: person.user.externalId,
      username: person.user.username,
      firstName: person.user.firstName,
      lastName: person.user.lastName,
      photo: person.user.photo,
    } : null,
    comments: person.comments,
    reactions: person.reactions,
    replies: person.replies,
    avgEngagement: person.avgEngagement,
    lastCommentAt: person.lastCommentAt?.toISOString() ?? null,
    examples: person.examples.map((message) => ({
      externalId: message.externalId,
      text: message.text,
      publishedAt: message.publishedAt.toISOString(),
      parent: message.parent ? {
        externalId: message.parent.externalId,
        text: message.parent.text,
        publishedAt: message.parent.publishedAt.toISOString(),
      } : null,
    })),
  }));
}
