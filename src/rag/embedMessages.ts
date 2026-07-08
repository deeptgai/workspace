import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { createEmbeddings } from "../embeddings/client.js";
import type { EmbeddingsConfig } from "../embeddings/config.js";
import { hashText } from "../embeddings/hash.js";
import { toPgVectorLiteral } from "../embeddings/vector.js";

export type EmbedMessagesOptions = {
  sourceId: string;
  limit: number;
};

export type EmbedMessagesResult = {
  embedded: number;
  skipped: number;
  model: string;
};

export async function embedMessages(
  prisma: PrismaClient,
  config: EmbeddingsConfig,
  options: EmbedMessagesOptions,
): Promise<EmbedMessagesResult> {
  const messages = await prisma.contentItem.findMany({
    where: {
      sourceId: options.sourceId,
      text: {
        not: null,
      },
      embeddings: {
        none: {
          model: config.model,
        },
      },
    },
    orderBy: {
      publishedAt: "asc",
    },
    take: options.limit,
    select: {
      id: true,
      text: true,
    },
  });

  let embedded = 0;
  let skipped = 0;

  for (let index = 0; index < messages.length; index += config.batchSize) {
    const batch = messages.slice(index, index + config.batchSize);
    const records = batch
      .map((message) => ({
        message,
        text: message.text?.trim() ?? "",
      }))
      .filter((record) => record.text.length > 0);
    const inputs = records.map((record) => record.text);

    if (records.length !== batch.length) {
      skipped += batch.length - records.length;
    }

    if (inputs.length === 0) {
      continue;
    }

    const embeddings = await createEmbeddings(config, inputs);

    for (const [embeddingIndex, embedding] of embeddings.entries()) {
      const { message, text } = records[embeddingIndex];

      await prisma.$executeRawUnsafe(
        `
          insert into "ContentEmbedding" ("id", "itemId", "model", "dimensions", "textHash", "embedding", "createdAt", "updatedAt")
          values ($1, $2, $3, $4, $5, $6::vector, now(), now())
          on conflict ("itemId", "model") do update set
            "dimensions" = excluded."dimensions",
            "textHash" = excluded."textHash",
            "embedding" = excluded."embedding",
            "updatedAt" = now()
        `,
        randomUUID(),
        message.id,
        config.model,
        embedding.length,
        hashText(text),
        toPgVectorLiteral(embedding),
      );

      embedded += 1;
    }

    console.log(`Embedded ${embedded}/${messages.length} messages with ${config.model}`);
  }

  return {
    embedded,
    skipped,
    model: config.model,
  };
}
