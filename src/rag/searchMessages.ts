import type { PrismaClient } from "@prisma/client";
import { createEmbeddings } from "../embeddings/client.js";
import type { EmbeddingsConfig } from "../embeddings/config.js";
import { toPgVectorLiteral } from "../embeddings/vector.js";

export type SearchMessagesOptions = {
  sourceId: string;
  query: string;
  limit: number;
  minEngagementScore?: number;
  createdAtGt?: Date | null;
  createdAtLte?: Date | null;
  publishedAtGte?: Date | null;
};

export type SearchMessageResult = {
  itemId: string;
  externalId: string;
  publishedAt: Date;
  text: string | null;
  views: number | null;
  forwards: number | null;
  reactionsTotal: number;
  repliesCount: number;
  engagementScore: number;
  similarity: number;
};

export async function searchMessages(
  prisma: PrismaClient,
  config: EmbeddingsConfig,
  options: SearchMessagesOptions,
): Promise<SearchMessageResult[]> {
  const [queryEmbedding] = await createEmbeddings(config, [options.query]);
  const minEngagementScore = options.minEngagementScore ?? 0;
  const params: unknown[] = [
    toPgVectorLiteral(queryEmbedding),
    options.sourceId,
    config.model,
    minEngagementScore,
  ];
  const whereClauses = [
    `m."sourceId" = $2`,
    `e."model" = $3`,
    `m."engagementScore" >= $4`,
  ];
  const windowClauses: string[] = [];

  if (options.createdAtLte) {
    params.push(options.createdAtLte);
    whereClauses.push(`m."createdAt" <= $${params.length}`);
  }

  if (options.createdAtGt) {
    params.push(options.createdAtGt);
    windowClauses.push(`m."createdAt" > $${params.length}`);
  }

  if (options.publishedAtGte) {
    params.push(options.publishedAtGte);
    windowClauses.push(`m."publishedAt" >= $${params.length}`);
  }

  if (windowClauses.length) {
    whereClauses.push(`(${windowClauses.join(" or ")})`);
  }

  params.push(options.limit);

  return prisma.$queryRawUnsafe<SearchMessageResult[]>(
    `
      select
        m."id" as "itemId",
        m."externalId" as "externalId",
        m."publishedAt" as "publishedAt",
        m."text" as "text",
        m."views" as "views",
        m."forwards" as "forwards",
        m."reactionsTotal" as "reactionsTotal",
        m."repliesCount" as "repliesCount",
        m."engagementScore" as "engagementScore",
        1 - (e."embedding" <=> $1::vector) as "similarity"
      from "ContentEmbedding" e
      join "ContentItem" m on m."id" = e."itemId"
      where ${whereClauses.join("\n        and ")}
      order by e."embedding" <=> $1::vector
      limit $${params.length}
    `,
    ...params,
  );
}
