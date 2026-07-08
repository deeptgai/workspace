import type { PrismaClient } from "@prisma/client";
import { createEmbeddings } from "../embeddings/client.js";
import type { EmbeddingsConfig } from "../embeddings/config.js";
import { toPgVectorLiteral } from "../embeddings/vector.js";

export type SearchMessagesOptions = {
  sourceId: string;
  query: string;
  limit: number;
  minEngagementScore?: number;
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
      where
        m."sourceId" = $2
        and e."model" = $3
        and m."engagementScore" >= $4
      order by e."embedding" <=> $1::vector
      limit $5
    `,
    toPgVectorLiteral(queryEmbedding),
    options.sourceId,
    config.model,
    minEngagementScore,
    options.limit,
  );
}
