import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { AiConfig } from "../ai/config.js";
import { createChatCompletion } from "../ai/chatClient.js";

type FormatContentOptions = {
  itemId: string;
  skipExisting?: boolean;
};

type FormatContentBatchOptions = {
  sourceId: string;
  limit: number;
  kind?: "post" | "comment";
  skipExisting?: boolean;
};

type FormatContentItemsByExternalIdsOptions = {
  sourceId: string;
  externalIds: string[];
  skipExisting?: boolean;
};

type FormatterResponse = {
  formattedText?: string;
  changed?: boolean;
  confidence?: number;
  notes?: string[];
};

const SYSTEM_PROMPT = [
  "Ты аккуратный редактор-форматтер русскоязычных постов и комментариев.",
  "Твоя задача: улучшить читаемость текста, не переписывая автора.",
  "Правила:",
  "- Не добавляй факты, выводы, ссылки, эмодзи или примеры.",
  "- Не удаляй важные фразы и не меняй смысл.",
  "- Сохраняй авторский тон и порядок мыслей.",
  "- Исправляй только визуальный хаос: абзацы, списки, цитаты, акценты.",
  "- Длинные перечисления превращай в Markdown-списки.",
  "- Ключевые слова и короткие смысловые акценты выделяй через **жирный**.",
  "- Не добавляй новые заголовки; Markdown-заголовок допустим только если заголовок уже явно был в оригинале.",
  "- Если текст уже хорошо оформлен, верни его почти без изменений и changed=false.",
  "- Ссылки, @username, хэштеги и числа сохраняй как в оригинале.",
  "Верни только JSON: {\"formattedText\":\"markdown\",\"changed\":true,\"confidence\":0.9,\"notes\":[\"...\"]}.",
].join("\n");

function textHash(text: string) {
  return createHash("sha256").update(text).digest("hex");
}

function extractJson(value: string) {
  const trimmed = value.trim();

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const match = trimmed.match(/\{[\s\S]*\}/);

  if (!match) {
    throw new Error("Formatter response did not contain JSON.");
  }

  return match[0];
}

function parseFormatterResponse(value: string): Required<Pick<FormatterResponse, "formattedText" | "changed">> & FormatterResponse {
  const parsed = JSON.parse(extractJson(value)) as FormatterResponse;
  const formattedText = typeof parsed.formattedText === "string" ? parsed.formattedText.trim() : "";

  if (!formattedText) {
    throw new Error("Formatter returned empty formattedText.");
  }

  return {
    formattedText,
    changed: Boolean(parsed.changed),
    confidence: typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : undefined,
    notes: Array.isArray(parsed.notes)
      ? parsed.notes.filter((note): note is string => typeof note === "string" && note.trim().length > 0).slice(0, 8)
      : undefined,
  };
}

export async function formatContentItem(
  prisma: PrismaClient,
  aiConfig: AiConfig,
  options: FormatContentOptions,
) {
  const item = await prisma.contentItem.findUnique({
    where: {
      id: options.itemId,
    },
    include: {
      formats: {
        where: {
          model: aiConfig.model,
        },
        take: 1,
      },
    },
  });

  if (!item) {
    throw new Error(`Content item not found: ${options.itemId}`);
  }

  const originalText = item.text?.trim();

  if (!originalText) {
    return {
      status: "skipped" as const,
      reason: "empty-text",
      itemId: item.id,
      externalId: item.externalId,
    };
  }

  const hash = textHash(originalText);
  const existing = item.formats[0];

  if (options.skipExisting !== false && existing?.textHash === hash) {
    return {
      status: "skipped" as const,
      reason: "already-formatted",
      itemId: item.id,
      externalId: item.externalId,
    };
  }

  const content = await createChatCompletion(aiConfig, [
    {
      role: "system",
      content: SYSTEM_PROMPT,
    },
    {
      role: "user",
      content: [
        `Тип материала: ${item.kind === "comment" ? "комментарий" : "пост"}`,
        `Дата: ${item.publishedAt.toISOString()}`,
        "Оригинальный текст:",
        originalText,
      ].join("\n\n"),
    },
  ], { json: true });
  const formatted = parseFormatterResponse(content);

  await prisma.contentItemFormat.upsert({
    where: {
      itemId_model: {
        itemId: item.id,
        model: aiConfig.model,
      },
    },
    create: {
      itemId: item.id,
      model: aiConfig.model,
      textHash: hash,
      formattedText: formatted.formattedText,
      changed: formatted.changed,
      confidence: formatted.confidence,
      notes: formatted.notes ?? [],
    },
    update: {
      textHash: hash,
      formattedText: formatted.formattedText,
      changed: formatted.changed,
      confidence: formatted.confidence,
      notes: formatted.notes ?? [],
    },
  });

  return {
    status: "formatted" as const,
    itemId: item.id,
    externalId: item.externalId,
    changed: formatted.changed,
  };
}

export async function formatContentBatch(
  prisma: PrismaClient,
  aiConfig: AiConfig,
  options: FormatContentBatchOptions,
) {
  const items = await prisma.contentItem.findMany({
    where: {
      sourceId: options.sourceId,
      kind: options.kind,
      text: {
        not: null,
      },
      ...(options.skipExisting === false
        ? {}
        : {
            formats: {
              none: {
                model: aiConfig.model,
              },
            },
          }),
    },
    orderBy: {
      publishedAt: "desc",
    },
    take: options.limit,
    select: {
      id: true,
    },
  });

  let formatted = 0;
  let skipped = 0;

  for (const item of items) {
    const result = await formatContentItem(prisma, aiConfig, {
      itemId: item.id,
      skipExisting: options.skipExisting,
    });

    if (result.status === "formatted") {
      formatted += 1;
    } else {
      skipped += 1;
    }
  }

  return {
    selected: items.length,
    formatted,
    skipped,
    model: aiConfig.model,
  };
}

export async function formatContentItemsByExternalIds(
  prisma: PrismaClient,
  aiConfig: AiConfig,
  options: FormatContentItemsByExternalIdsOptions,
) {
  const externalIds = [...new Set(options.externalIds.map((id) => id.trim()).filter(Boolean))];

  if (!externalIds.length) {
    return {
      selected: 0,
      formatted: 0,
      skipped: 0,
      missing: 0,
      model: aiConfig.model,
    };
  }

  const items = await prisma.contentItem.findMany({
    where: {
      sourceId: options.sourceId,
      externalId: {
        in: externalIds,
      },
      text: {
        not: null,
      },
      ...(options.skipExisting === false
        ? {}
        : {
            formats: {
              none: {
                model: aiConfig.model,
              },
            },
          }),
    },
    select: {
      id: true,
      externalId: true,
    },
  });
  const foundExternalIds = new Set(items.map((item) => item.externalId));
  let formatted = 0;
  let skipped = 0;

  for (const item of items) {
    const result = await formatContentItem(prisma, aiConfig, {
      itemId: item.id,
      skipExisting: options.skipExisting,
    });

    if (result.status === "formatted") {
      formatted += 1;
    } else {
      skipped += 1;
    }
  }

  return {
    selected: items.length,
    formatted,
    skipped,
    missing: externalIds.filter((id) => !foundExternalIds.has(id)).length,
    model: aiConfig.model,
  };
}
