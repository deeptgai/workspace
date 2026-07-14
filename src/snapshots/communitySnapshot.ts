import { Prisma, type Source, type PrismaClient } from "@prisma/client";
import { createChatCompletion } from "../ai/chatClient.js";
import type { AiConfig } from "../ai/config.js";
import { loadEmbeddingsConfig } from "../embeddings/config.js";
import { searchMessages, type SearchMessageResult } from "../rag/searchMessages.js";
import { enqueueContentFormattingJob, enqueueSnapshotCoverImageJob, enqueueSourceSignalCurationJob } from "../queue/enqueue.js";
import {
  CHANNEL_SNAPSHOT_SCHEMA_VERSION,
  type ChannelSnapshotDocument,
  type ChannelSnapshotHeroTheme,
  type ChannelSnapshotItem,
  type ChannelSnapshotSection,
  type ChannelSnapshotSectionId,
  type SnapshotSignal,
  type SnapshotSignalKind,
  type SnapshotItemPriority,
  type SnapshotItemTag,
  type SnapshotEvidenceRef,
  type SnapshotGeneratedImage,
} from "./sourceSnapshotSchema.js";
import { enrichSignalsWithTimeline } from "./signalTimeline.js";
import { sortSignalsDescending } from "./signalOrdering.js";
import { replaceSnapshotSignals } from "../signals/snapshotSignals.js";
import { snapshotSignalsAsDocumentSignals } from "../signals/snapshotSignals.js";
import { enrichSignalsWithWikipedia } from "../signals/wikipediaEnrichment.js";
import { patchSnapshotPipeline } from "./pipeline.js";
import {
  contentWhereForAnalysisWindow,
  nestedContentWhereForAnalysisWindow,
  planSnapshotAnalysisWindow,
  readSnapshotAnalysisWindow,
  snapshotAnalysisWindowFromPipeline,
  snapshotAnalysisWindowToJson,
  type SnapshotAnalysisWindow,
} from "./analysisState.js";
import { JSON_REPAIR_SYSTEM_PROMPT } from "../prompts/jsonRepair.js";
import {
  CHANNEL_SUMMARY_SYSTEM_PROMPT,
  HERO_THEME_SYSTEM_PROMPT,
  SIGNAL_AGENTS,
  buildSectionAgentSystemPrompt,
  buildSignalSearchPlannerSystemPrompt,
  type SignalAgentDefinition,
} from "../prompts/snapshotAgents.js";

export type GenerateCommunitySnapshotOptions = {
  chat: Source;
  snapshotId?: string;
  onLog?: (message: string, meta?: Record<string, unknown>) => void;
  onProgress?: (progress: number) => Promise<void> | void;
};

export type GenerateCommunitySnapshotResult = {
  snapshotId: string;
  title: string;
  model: string;
  signalJobs: Array<{
    signalGroupId: ChannelSnapshotSectionId;
    agent: string;
  }>;
};

type SectionAgentOutput = {
  summary?: string;
  items?: Array<Partial<ChannelSnapshotItem>>;
};

type SectionAgentSearchPlan = {
  enoughEvidence?: boolean;
  reason?: string;
  queries?: Array<{
    query?: string;
    reason?: string;
  }>;
};

type ConversationWindowItem = {
  id: string;
  externalId: string;
  kind: string;
  text: string | null;
  publishedAt: Date;
  engagementScore: number;
  actor: {
    externalId: string;
    username: string | null;
    firstName: string | null;
    lastName: string | null;
  } | null;
};

type ConversationWindow = {
  anchorExternalId: string;
  items: Array<ConversationWindowItem & { isAnchor: boolean }>;
};

type ThreadEvidenceItem = {
  externalId: string;
  text: string | null;
  publishedAt: Date;
  replyToExternalId: string | null;
};

type ChannelSummaryAgentOutput = {
  summary?: string;
};

type HeroThemeAgentOutput = Partial<ChannelSnapshotHeroTheme>;

const ALLOWED_PRIORITIES = new Set<SnapshotItemPriority>(["high", "medium", "low"]);
const HERO_PALETTES = ["emerald", "indigo", "amber", "rose", "slate", "cyan"] as const;
const HERO_MOTIFS = ["network", "notes", "city", "market", "studio", "landscape"] as const;
const SNAPSHOT_SUMMARY_MAX_LENGTH = 240;
const CHANNEL_SUMMARY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: {
      type: "string",
    },
  },
  required: ["summary"],
};
const HERO_THEME_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    palette: {
      type: "string",
      enum: HERO_PALETTES,
    },
    motif: {
      type: "string",
      enum: HERO_MOTIFS,
    },
    mood: {
      type: "string",
    },
    concept: {
      type: "string",
    },
    imagePrompt: {
      type: "string",
    },
  },
  required: ["palette", "motif", "mood", "concept", "imagePrompt"],
};
const SECTION_SEARCH_PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    enoughEvidence: {
      type: "boolean",
    },
    reason: {
      type: "string",
    },
    queries: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: {
            type: "string",
          },
          reason: {
            type: "string",
          },
        },
        required: ["query", "reason"],
      },
    },
  },
  required: ["enoughEvidence", "reason", "queries"],
};
const SECTION_AGENT_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: {
      type: "string",
    },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: {
            type: "string",
          },
          description: {
            type: "string",
          },
          url: {
            type: "string",
          },
          actorExternalId: {
            type: "string",
          },
          personUsername: {
            type: "string",
          },
          personName: {
            type: "string",
          },
          score: {
            type: "string",
          },
          priority: {
            type: "string",
            enum: ["high", "medium", "low", ""],
          },
          tags: {
            type: "array",
            items: {
              type: "string",
            },
          },
          confidence: {
            type: "number",
            minimum: 0,
            maximum: 1,
          },
          metrics: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                key: {
                  type: "string",
                },
                label: {
                  type: "string",
                },
                value: {
                  type: "string",
                },
              },
              required: ["key", "label", "value"],
            },
          },
          evidence: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                itemId: {
                  type: "string",
                },
                quote: {
                  type: "string",
                },
                reason: {
                  type: "string",
                },
              },
              required: ["itemId", "quote", "reason"],
            },
          },
        },
        required: [
          "title",
          "description",
          "url",
          "actorExternalId",
          "personUsername",
          "personName",
          "score",
          "priority",
          "tags",
          "confidence",
          "metrics",
          "evidence",
        ],
      },
    },
  },
  required: ["summary", "items"],
};
const STRUCTURAL_DISPLAY_TAGS = new Set([
  "идея",
  "идеи",
  "боль",
  "боли",
  "риск",
  "риски",
  "гипотеза",
  "гипотезы",
  "инсайт",
  "инсайты",
  "тренд",
  "тренды",
  "событие",
  "события",
  "материал",
  "материалы",
  "инструмент",
  "инструменты",
  "место",
  "места",
  "человек",
  "люди",
  "профиль",
  "profile",
  "peer",
  "idea",
  "pain",
  "risk",
  "hypothesis",
  "insight",
  "trend",
  "event",
  "material",
  "tool",
  "place",
  "person",
]);
const ALLOWED_METRIC_KEYS = new Set([
  "profile",
  "pain",
  "lead_signal",
  "offer",
  "outreach_reason",
  "intro_reason",
  "helper_signal",
  "question_signal",
  "solution_need",
  "contractor_need",
  "similarity_reason",
  "impact",
  "effort",
  "priority_reason",
  "topic_strength",
  "demand_signal",
  "commercial_potential",
  "content_pattern",
  "recommendation_type",
  "recommendation_source",
  "recommended_action",
  "mention_type",
  "mentioned_entity",
  "why_it_matters",
  "source_context",
  "time_window",
  "digest_signal",
  "learning_type",
  "learning_asset",
  "positioning_angle",
  "author_thesis",
  "audience_fit",
  "discussion_prompt",
  "tg_post_idea",
]);

type SnapshotAggregate = {
  _count: {
    _all: number;
  };
  _sum: {
    views: number | null;
    forwards: number | null;
    reactionsTotal: number | null;
    repliesCount: number | null;
  };
  _avg: {
    views: number | null;
    engagementScore: number | null;
  };
};

type SnapshotContext = {
  chat: Source;
  aggregate: SnapshotAggregate;
  topMessages: Array<{
    externalId: string;
    publishedAt: Date;
    text: string | null;
    views: number | null;
    forwards: number | null;
    reactionsTotal: number;
    repliesCount: number;
    engagementScore: number;
  }>;
  topCommenters: Array<{
    actorId: string;
    externalId: string;
    username: string | null;
    firstName: string | null;
    lastName: string | null;
    messages: number;
    reactions: number;
    replies: number;
    avgEngagement: number;
    examples: Array<{
      externalId: string;
      text: string | null;
      publishedAt: Date;
    }>;
  }>;
  messageCount: number;
  embeddingCount: number;
  oldestMessageDate: Date | null;
  newestMessageDate: Date | null;
  analysisWindow: SnapshotAnalysisWindow;
};

const SNAPSHOT_KIND = "channel_structured_snapshot";

const SECTION_ORDER: ChannelSnapshotSectionId[] = [
  ...SIGNAL_AGENTS.map((signalGroup) => signalGroup.id),
];

function logAgent(options: Pick<GenerateCommunitySnapshotOptions, "onLog">, message: string, meta?: Record<string, unknown>) {
  options.onLog?.(message, meta);
}

async function progressAgent(options: GenerateCommunitySnapshotOptions, progress: number) {
  await options.onProgress?.(progress);
}

function compactText(text: string | null, maxLength = 420): string {
  return (text ?? "<no text>").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeSnapshotSummary(text: string | null | undefined): string | null {
  const cleaned = typeof text === "string"
    ? text.replace(/\s+/g, " ").trim()
    : "";

  if (!cleaned) {
    return null;
  }

  const sentences = cleaned
    .match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g)
    ?.map((sentence) => sentence.trim())
    .filter(Boolean) ?? [cleaned];
  const summaryText = sentences.slice(0, 2).join(" ").replace(/\s+/g, " ").trim();

  if (summaryText.length <= SNAPSHOT_SUMMARY_MAX_LENGTH) {
    return summaryText;
  }

  return `${summaryText.slice(0, SNAPSHOT_SUMMARY_MAX_LENGTH - 1).trimEnd()}…`;
}

function fallbackSnapshotSummary(context: SnapshotContext, sections: ChannelSnapshotSection[]): string {
  const activeSectionTitles = sections
    .filter((section) => section.items.length > 0)
    .slice(0, 3)
    .map((section) => section.title.toLowerCase());
  const focus = activeSectionTitles.length
    ? `В фокусе: ${activeSectionTitles.join(", ")}.`
    : "Карта помогает быстро увидеть практические сигналы из постов и обсуждений.";

  return normalizeSnapshotSummary(`Канал ${context.chat.title} собран в карту сигналов для быстрого понимания пользы и контекста. ${focus}`)
    ?? `Карта сигналов канала ${context.chat.title}.`;
}

function jsonObject(value: Prisma.JsonValue | null): Prisma.JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Prisma.JsonObject
    : {};
}

function jsonObjectValue<T>(value: unknown): T | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as T : undefined;
}

function minDate(...values: Array<Date | null | undefined>) {
  const dates = values.filter((value): value is Date => Boolean(value));

  return dates.length ? new Date(Math.min(...dates.map((value) => value.getTime()))) : null;
}

function maxDate(...values: Array<Date | null | undefined>) {
  const dates = values.filter((value): value is Date => Boolean(value));

  return dates.length ? new Date(Math.max(...dates.map((value) => value.getTime()))) : null;
}

function formatMessageEvidence(messages: SearchMessageResult[]): string {
  return messages
    .map((message) => [
      `- id=${message.externalId}`,
      `publishedAt=${message.publishedAt.toISOString().slice(0, 10)}`,
      `similarity=${message.similarity.toFixed(4)}`,
      `engagement=${message.engagementScore.toFixed(2)}`,
      `views=${message.views ?? 0}`,
      `reactions=${message.reactionsTotal}`,
      `replies=${message.repliesCount}`,
      `text="${compactText(message.text)}"`,
    ].join(" | "))
    .join("\n");
}

function actorLabel(actor: ConversationWindowItem["actor"]) {
  if (!actor) {
    return "unknown";
  }

  return actor.username
    ? `@${actor.username}`
    : [actor.firstName, actor.lastName].filter(Boolean).join(" ") || actor.externalId;
}

function formatConversationWindows(windows: ConversationWindow[]) {
  if (!windows.length) {
    return "";
  }

  return windows
    .map((window, index) => [
      `Window ${index + 1}; anchor=${window.anchorExternalId}`,
      ...window.items.map((item) => [
        `- id=${item.externalId}`,
        item.isAnchor ? "anchor=true" : null,
        `publishedAt=${item.publishedAt.toISOString()}`,
        `kind=${item.kind}`,
        `actor=${actorLabel(item.actor)}`,
        `engagement=${item.engagementScore.toFixed(2)}`,
        `text="${compactText(item.text)}"`,
      ].filter(Boolean).join(" | ")),
    ].join("\n"))
    .join("\n\n");
}

function formatTopMessages(context: SnapshotContext): string {
  return context.topMessages
    .map((message) => [
      `- id=${message.externalId}`,
      `publishedAt=${message.publishedAt.toISOString().slice(0, 10)}`,
      `engagement=${message.engagementScore.toFixed(2)}`,
      `views=${message.views ?? 0}`,
      `forwards=${message.forwards ?? 0}`,
      `reactions=${message.reactionsTotal}`,
      `replies=${message.repliesCount}`,
      `text="${compactText(message.text)}"`,
    ].join(" | "))
    .join("\n");
}

function formatPeopleSignals(context: SnapshotContext): string {
  if (context.topCommenters.length === 0) {
    return "- no imported comments with users";
  }

  return context.topCommenters
    .map((person) => {
      const name = person.username
        ? [person.firstName, person.lastName].filter(Boolean).join(" ") || `@${person.username}`
        : [person.firstName, person.lastName].filter(Boolean).join(" ") || "пользователь без username";
      const examples = person.examples
        .map((message) => `#${message.externalId}: "${compactText(message.text, 180)}"`)
        .join(" / ");

      return [
        `- actorExternalId=${person.externalId}`,
        person.username ? `personUsername=${person.username}` : null,
        `personName=${name}`,
        person.username ? `profile=https://t.me/${person.username}` : null,
        `comments=${person.messages}`,
        `reactions=${person.reactions}`,
        `replies=${person.replies}`,
        `avgEngagement=${person.avgEngagement.toFixed(2)}`,
        `examples=${examples || "-"}`,
      ].filter(Boolean).join(" | ");
    })
    .join("\n");
}

function sectionAgentContextBlock(context: SnapshotContext) {
  return [
    "Контекст канала:",
    JSON.stringify({
      chatTitle: context.chat.title,
      username: context.chat.username ? `@${context.chat.username}` : null,
      type: context.chat.type,
      messages: context.aggregate._count._all,
      views: context.aggregate._sum.views ?? 0,
      avgViews: Math.round(context.aggregate._avg.views ?? 0),
      forwards: context.aggregate._sum.forwards ?? 0,
      reactions: context.aggregate._sum.reactionsTotal ?? 0,
      replies: context.aggregate._sum.repliesCount ?? 0,
      avgEngagement: Number((context.aggregate._avg.engagementScore ?? 0).toFixed(2)),
    }, null, 2),
    "",
    "Top messages by engagement:",
    formatTopMessages(context) || "- none",
    "",
    "People/commenter signals:",
    formatPeopleSignals(context),
  ].join("\n");
}

function uniqueSearchQueries(params: {
  definition: SignalAgentDefinition;
  plan: SectionAgentSearchPlan;
  usedQueries: Set<string>;
  includeBaseQuery: boolean;
  remaining: number;
}) {
  const candidates = [
    ...(params.includeBaseQuery ? [params.definition.query] : []),
    ...(params.plan.queries ?? []).flatMap((item) => {
      const query = item.query?.trim();

      return query ? [query] : [];
    }),
  ];
  const seen = new Set(params.usedQueries);

  return candidates.flatMap((query) => {
    const normalized = query.toLowerCase().replace(/\s+/g, " ").trim();

    if (!normalized || seen.has(normalized)) {
      return [];
    }

    seen.add(normalized);
    return [query.trim()];
  }).slice(0, Math.max(0, params.remaining));
}

function mergeEvidence(results: SearchMessageResult[][]) {
  const byItemId = new Map<string, SearchMessageResult>();

  for (const result of results.flat()) {
    const current = byItemId.get(result.itemId);

    if (!current || result.similarity > current.similarity) {
      byItemId.set(result.itemId, result);
    }
  }

  return [...byItemId.values()]
    .sort((left, right) => {
      const scoreDelta = (right.similarity + right.engagementScore / 1000) -
        (left.similarity + left.engagementScore / 1000);

      return scoreDelta || right.publishedAt.getTime() - left.publishedAt.getTime();
    })
    .slice(0, Number(process.env.SNAPSHOT_SECTION_AGENT_EVIDENCE_LIMIT || "24"));
}

async function buildConversationWindows(
  prisma: PrismaClient,
  context: SnapshotContext,
  evidence: SearchMessageResult[],
): Promise<ConversationWindow[]> {
  if (context.chat.type !== "group") {
    return [];
  }

  const windowCount = Number(process.env.SNAPSHOT_RAG_CONTEXT_WINDOWS || "8");
  const beforeCount = Number(process.env.SNAPSHOT_RAG_CONTEXT_BEFORE || "4");
  const afterCount = Number(process.env.SNAPSHOT_RAG_CONTEXT_AFTER || "4");
  const anchors = evidence.slice(0, windowCount);
  const select = {
    id: true,
    externalId: true,
    kind: true,
    text: true,
    publishedAt: true,
    engagementScore: true,
    actor: {
      select: {
        externalId: true,
        username: true,
        firstName: true,
        lastName: true,
      },
    },
  } satisfies Prisma.ContentItemSelect;
  const windows: ConversationWindow[] = [];

  for (const anchorEvidence of anchors) {
    const anchor = await prisma.contentItem.findUnique({
      where: {
        id: anchorEvidence.itemId,
      },
      select,
    });

    if (!anchor) {
      continue;
    }

    const [before, after] = await Promise.all([
      prisma.contentItem.findMany({
        where: contentWhereForAnalysisWindow(context.analysisWindow, {
          publishedAt: {
            lt: anchor.publishedAt,
          },
        }),
        orderBy: [
          {
            publishedAt: "desc",
          },
          {
            externalId: "desc",
          },
        ],
        take: beforeCount,
        select,
      }),
      prisma.contentItem.findMany({
        where: contentWhereForAnalysisWindow(context.analysisWindow, {
          publishedAt: {
            gt: anchor.publishedAt,
          },
        }),
        orderBy: [
          {
            publishedAt: "asc",
          },
          {
            externalId: "asc",
          },
        ],
        take: afterCount,
        select,
      }),
    ]);

    const items = [...before.reverse(), anchor, ...after].map((item) => ({
      ...item,
      isAnchor: item.id === anchor.id,
    }));

    windows.push({
      anchorExternalId: anchor.externalId,
      items,
    });
  }

  return windows;
}

function extractJsonObject(content: string) {
  const trimmed = content.trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");

  if (start < 0 || end < start) {
    throw new Error(`Agent returned non-JSON content: ${content.slice(0, 160)}`);
  }

  return trimmed.slice(start, end + 1);
}

async function parseJsonObject<T>(
  aiConfig: AiConfig,
  content: string,
  onRepair?: (error: unknown) => void,
): Promise<T> {
  const jsonText = extractJsonObject(content);

  try {
    return JSON.parse(jsonText) as T;
  } catch (error) {
    onRepair?.(error);
    const repaired = await createChatCompletion(aiConfig, [
      {
        role: "system",
        content: JSON_REPAIR_SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: jsonText,
      },
    ], { json: true });

    try {
      return JSON.parse(extractJsonObject(repaired)) as T;
    } catch {
      throw error;
    }
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<T>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function normalizeEvidence(value: unknown): SnapshotEvidenceRef[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }

    const evidence = item as Partial<SnapshotEvidenceRef>;
    const itemId = typeof evidence.itemId === "string" && evidence.itemId.trim()
      ? evidence.itemId.trim()
      : Number.isInteger(evidence.itemId)
        ? String(evidence.itemId)
        : null;

    if (!itemId) {
      return [];
    }

    return [{
      itemId,
      quote: typeof evidence.quote === "string" ? evidence.quote.slice(0, 220) : undefined,
      reason: typeof evidence.reason === "string" ? evidence.reason.slice(0, 220) : undefined,
    }];
  });
}

function normalizePriority(value: unknown): SnapshotItemPriority | undefined {
  return typeof value === "string" && ALLOWED_PRIORITIES.has(value as SnapshotItemPriority)
    ? value as SnapshotItemPriority
    : undefined;
}

function normalizeTags(value: unknown): SnapshotItemTag[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const seen = new Set<string>();
  const tags: SnapshotItemTag[] = [];

  for (const rawTag of value) {
    if (typeof rawTag !== "string") {
      continue;
    }

    const tag = rawTag.replace(/\s+/g, " ").trim();
    const normalized = tag.toLowerCase();

    if (
      !tag ||
      tag.length > 24 ||
      tag.split(/\s+/).length > 3 ||
      tag.includes("_") ||
      /^\d+$/.test(tag) ||
      STRUCTURAL_DISPLAY_TAGS.has(normalized) ||
      seen.has(normalized)
    ) {
      continue;
    }

    seen.add(normalized);
    tags.push(tag);

    if (tags.length >= 5) {
      break;
    }
  }

  return tags.length ? tags : undefined;
}

function normalizeMetricKey(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const key = value.trim();

  return ALLOWED_METRIC_KEYS.has(key) ? key : null;
}

function normalizeSectionOutput(definition: SignalAgentDefinition, output: SectionAgentOutput): ChannelSnapshotSection {
  const seenPeople = new Set<string>();
  const items = (output.items ?? []).flatMap((item) => {
    const actorExternalId = typeof item.actorExternalId === "string" ? item.actorExternalId.trim() : undefined;
    const personUsername = typeof item.personUsername === "string" ? item.personUsername.trim().replace(/^@/, "") : undefined;
    const personName = typeof item.personName === "string" ? item.personName.trim() : undefined;

    if (definition.id === "people") {
      const personKey = actorExternalId || (personUsername ? `username:${personUsername.toLowerCase()}` : null);

      if (!personKey || seenPeople.has(personKey)) {
        return [];
      }

      seenPeople.add(personKey);
    }

    return [{
      title: typeof item.title === "string" ? item.title : personName || "Без названия",
      description: typeof item.description === "string" ? item.description : "",
      url: typeof item.url === "string" && /^https?:\/\//i.test(item.url.trim()) ? item.url.trim() : undefined,
      actorExternalId,
      personUsername,
      personName,
      score: typeof item.score === "string" ? item.score : undefined,
      priority: normalizePriority(item.priority),
      tags: normalizeTags(item.tags),
      confidence: typeof item.confidence === "number" ? Math.max(0, Math.min(1, item.confidence)) : undefined,
      metrics: Array.isArray(item.metrics)
        ? item.metrics.flatMap((metric) => {
            if (!metric || typeof metric !== "object") {
              return [];
            }

            const candidate = metric as { key?: unknown; label?: unknown; value?: unknown };
            const key = normalizeMetricKey(candidate.key);

            return key && typeof candidate.value === "string"
              ? [{
                  key,
                  label: typeof candidate.label === "string" ? candidate.label : key,
                  value: candidate.value,
                }]
              : [];
          })
        : undefined,
      evidence: normalizeEvidence(item.evidence),
    }];
  }).slice(0, definition.maxItems);

  return {
    id: definition.id,
    title: definition.title,
    agent: definition.agent,
    summary: typeof output.summary === "string" ? output.summary : "",
    items,
  };
}

function getSectionDefinition(sectionId: string): SignalAgentDefinition {
  const definition = SIGNAL_AGENTS.find((signalGroup) => signalGroup.id === sectionId);

  if (!definition) {
    throw new Error(`Unknown snapshot section: ${sectionId}`);
  }

  return definition;
}

function sectionToDbData(snapshotId: string, section: ChannelSnapshotSection, status: string) {
  return {
    snapshotId,
    sectionId: section.id,
    title: section.title,
    agent: section.agent,
    status,
    summary: section.summary,
    items: section.items as Prisma.InputJsonValue,
    error: null,
    completedAt: status === "completed" ? new Date() : null,
  };
}

function sectionFromDbRow(row: {
  sectionId: string;
  title: string;
  agent: string;
  summary: string | null;
  items: Prisma.JsonValue | null;
}): ChannelSnapshotSection {
  return {
    id: row.sectionId as ChannelSnapshotSectionId,
    title: row.title,
    agent: row.agent,
    summary: row.summary ?? "",
    items: Array.isArray(row.items) ? row.items as ChannelSnapshotItem[] : [],
  };
}

function slugifySignalPart(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-zа-я0-9]+/giu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "signal";
}

function sectionSignalKind(sectionId: ChannelSnapshotSectionId): SnapshotSignalKind | null {
  if (sectionId === "ideas") {
    return "idea";
  }

  if (sectionId === "pains") {
    return "pain";
  }

  if (sectionId === "risks") {
    return "risk";
  }

  if (sectionId === "hypotheses") {
    return "hypothesis";
  }

  if (sectionId === "insights") {
    return "insight";
  }

  if (sectionId === "trends") {
    return "trend";
  }

  if (sectionId === "events") {
    return "event";
  }

  if (sectionId === "materials") {
    return "material";
  }

  if (sectionId === "tools") {
    return "tool";
  }

  if (sectionId === "places") {
    return "place";
  }

  if (sectionId === "people") {
    return "person";
  }

  return null;
}

function signalTags(section: ChannelSnapshotSection, item: ChannelSnapshotItem, kind: SnapshotSignalKind) {
  const tags = (item.tags ?? []).map((tag) => tag.trim()).filter((tag) => {
    if (!tag) {
      return false;
    }

    const normalized = tag.toLowerCase();

    return !STRUCTURAL_DISPLAY_TAGS.has(normalized) &&
      normalized !== section.title.toLowerCase() &&
      normalized !== kind &&
      !tag.includes("_");
  }).filter((tag) => tag.length <= 24 && tag.split(/\s+/).length <= 3);

  return [...new Set(tags)].slice(0, 7);
}

function buildSnapshotSignals(sections: ChannelSnapshotSection[]): SnapshotSignal[] {
  return sections.flatMap((section) => {
    const kind = sectionSignalKind(section.id);

    if (!kind) {
      return [];
    }

    return section.items.map((item, index) => ({
      id: `${kind}-${slugifySignalPart(item.title)}-${index + 1}`,
      kind,
      title: item.personName || item.title,
      summary: item.description,
      tags: signalTags(section, item, kind),
      priority: item.priority,
      score: item.score,
      confidence: item.confidence,
      metrics: item.metrics,
      evidence: item.evidence,
      url: item.url ?? (item.personUsername ? `https://t.me/${item.personUsername}` : undefined),
      person: kind === "person"
        ? {
            actorExternalId: item.actorExternalId,
            username: item.personUsername,
            name: item.personName || item.title,
          }
        : undefined,
    }));
  });
}

function mergeSignalEvidence(
  evidence: SnapshotEvidenceRef[] | undefined,
  additions: SnapshotEvidenceRef[],
) {
  const seen = new Set<string>();

  return [...(evidence ?? []), ...additions].flatMap((item) => {
    if (!item.itemId || seen.has(item.itemId)) {
      return [];
    }

    seen.add(item.itemId);
    return [item];
  });
}

async function threadEvidenceForSignal(
  prisma: PrismaClient,
  context: SnapshotContext,
  signal: SnapshotSignal,
): Promise<SnapshotEvidenceRef[]> {
  const anchorIds = [...new Set((signal.evidence ?? []).map((item) => item.itemId).filter(Boolean))];

  if (!anchorIds.length) {
    return [];
  }

  const maxItems = Number(process.env.SNAPSHOT_SIGNAL_THREAD_EVIDENCE_LIMIT || "12");
  const maxRounds = Number(process.env.SNAPSHOT_SIGNAL_THREAD_EVIDENCE_ROUNDS || "4");
  const itemsByExternalId = new Map<string, ThreadEvidenceItem>();
  let frontier = new Set(anchorIds);

  for (let round = 0; round < maxRounds && frontier.size && itemsByExternalId.size < maxItems; round += 1) {
    const ids = [...frontier];
    frontier = new Set<string>();

    const items = await prisma.contentItem.findMany({
      where: contentWhereForAnalysisWindow(context.analysisWindow, {
        OR: [
          {
            externalId: {
              in: ids,
            },
          },
          {
            replyToExternalId: {
              in: ids,
            },
          },
        ],
      }),
      orderBy: [
        {
          publishedAt: "asc",
        },
        {
          externalId: "asc",
        },
      ],
      take: Math.max(maxItems * 2, ids.length),
      select: {
        externalId: true,
        text: true,
        publishedAt: true,
        replyToExternalId: true,
      },
    });

    for (const item of items) {
      const isNewItem = !itemsByExternalId.has(item.externalId);

      if (!itemsByExternalId.has(item.externalId) && itemsByExternalId.size < maxItems) {
        itemsByExternalId.set(item.externalId, item);
      }

      if (item.replyToExternalId && !itemsByExternalId.has(item.replyToExternalId)) {
        frontier.add(item.replyToExternalId);
      }

      if (isNewItem && !ids.includes(item.externalId)) {
        frontier.add(item.externalId);
      }
    }
  }

  return [...itemsByExternalId.values()]
    .sort((left, right) => left.publishedAt.getTime() - right.publishedAt.getTime() || left.externalId.localeCompare(right.externalId))
    .map((item) => ({
      itemId: item.externalId,
      quote: compactText(item.text, 220),
      reason: anchorIds.includes(item.externalId) ? "anchor evidence" : "reply-thread context",
    }));
}

async function expandGroupThreadEvidence(
  prisma: PrismaClient,
  context: SnapshotContext,
  signals: SnapshotSignal[],
) {
  if (context.chat.type !== "group") {
    return signals;
  }

  return Promise.all(signals.map(async (signal) => ({
    ...signal,
    evidence: mergeSignalEvidence(signal.evidence, await threadEvidenceForSignal(prisma, context, signal)),
  })));
}

function stableIndex(value: string, modulo: number) {
  let hash = 0;

  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }

  return hash % modulo;
}

function fallbackHeroTheme(context: SnapshotContext): ChannelSnapshotHeroTheme {
  const seed = `${context.chat.id}:${context.chat.username ?? ""}:${context.chat.title}`;
  const palette = HERO_PALETTES[stableIndex(seed, HERO_PALETTES.length)];
  const motif = HERO_MOTIFS[stableIndex(`${seed}:motif`, HERO_MOTIFS.length)];

  return {
    palette,
    motif,
    mood: "ясный, собранный, полезный",
    concept: `Визуальная карта сигналов канала ${context.chat.title}`,
    imagePrompt: [
      "Editorial hero background for a Telegram channel insight map.",
      `Channel: ${context.chat.title}.`,
      "Mood: clear, premium, analytical.",
      `Motif: ${motif}. Palette: ${palette}.`,
      "No text, no logos, no UI, no people portraits.",
    ].join(" "),
  };
}

function normalizeHeroTheme(value: HeroThemeAgentOutput, context: SnapshotContext): ChannelSnapshotHeroTheme {
  const fallback = fallbackHeroTheme(context);
  const palette = typeof value.palette === "string" && (HERO_PALETTES as readonly string[]).includes(value.palette)
    ? value.palette as ChannelSnapshotHeroTheme["palette"]
    : fallback.palette;
  const motif = typeof value.motif === "string" && (HERO_MOTIFS as readonly string[]).includes(value.motif)
    ? value.motif as ChannelSnapshotHeroTheme["motif"]
    : fallback.motif;
  const mood = typeof value.mood === "string" && value.mood.trim()
    ? value.mood.trim().slice(0, 140)
    : fallback.mood;
  const concept = typeof value.concept === "string" && value.concept.trim()
    ? value.concept.trim().slice(0, 180)
    : fallback.concept;
  const imagePrompt = typeof value.imagePrompt === "string" && value.imagePrompt.trim()
    ? value.imagePrompt.trim().slice(0, 700)
    : fallback.imagePrompt;

  return {
    palette,
    motif,
    mood,
    concept,
    imagePrompt,
  };
}

async function runChannelSummaryAgent(
  aiConfig: AiConfig,
  context: SnapshotContext,
  sections: ChannelSnapshotSection[],
  signals: SnapshotSignal[],
  options?: Pick<GenerateCommunitySnapshotOptions, "onLog">,
): Promise<string | null> {
  logAgent(options ?? {}, "tool:channelSummaryAgent:start", {
    sourceId: context.chat.id,
    title: context.chat.title,
  });

  try {
    const content = await createChatCompletion(aiConfig, [
      {
        role: "system",
        content: CHANNEL_SUMMARY_SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: [
          "Канал:",
          JSON.stringify({
            title: context.chat.title,
            username: context.chat.username ? `@${context.chat.username}` : null,
            type: context.chat.type,
            messages: context.messageCount,
            views: context.aggregate._sum.views ?? 0,
            avgViews: Math.round(context.aggregate._avg.views ?? 0),
            forwards: context.aggregate._sum.forwards ?? 0,
            reactions: context.aggregate._sum.reactionsTotal ?? 0,
            replies: context.aggregate._sum.repliesCount ?? 0,
          }, null, 2),
          "",
          "Самые важные сигналы:",
          signals.slice(0, 12).map((signal) => [
            `- ${signal.kind}: ${signal.title}`,
            signal.summary,
            signal.tags.length ? `tags: ${signal.tags.join(", ")}` : "",
          ].filter(Boolean).join(" | ")).join("\n") || "- none",
          "",
          "Сводки секций, только как контекст:",
          sections.map((section) => `- ${section.title}: ${compactText(section.summary, 160)}`).join("\n") || "- none",
        ].join("\n"),
      },
    ], {
      schema: {
        name: "channel_summary",
        schema: CHANNEL_SUMMARY_SCHEMA,
      },
    });
    const output = await parseJsonObject<ChannelSummaryAgentOutput>(aiConfig, content, (error) => {
      logAgent(options ?? {}, "tool:channelSummaryAgent.repairJson:start", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
    const summary = normalizeSnapshotSummary(output.summary);

    logAgent(options ?? {}, "tool:channelSummaryAgent:complete", {
      chars: summary?.length ?? 0,
    });

    return summary;
  } catch (error) {
    logAgent(options ?? {}, "tool:channelSummaryAgent:failed", {
      error: error instanceof Error ? error.message : String(error),
    });

    return null;
  }
}

async function generateHeroTheme(
  aiConfig: AiConfig,
  context: SnapshotContext,
  sections: ChannelSnapshotSection[],
  signals: SnapshotSignal[],
  options?: Pick<GenerateCommunitySnapshotOptions, "onLog">,
): Promise<ChannelSnapshotHeroTheme> {
  logAgent(options ?? {}, "tool:heroThemeAgent:start", {
    sourceId: context.chat.id,
    title: context.chat.title,
  });

  try {
    const content = await createChatCompletion(aiConfig, [
      {
        role: "system",
        content: HERO_THEME_SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: [
          "Канал:",
          JSON.stringify({
            title: context.chat.title,
            username: context.chat.username ? `@${context.chat.username}` : null,
            type: context.chat.type,
            messages: context.messageCount,
            views: context.aggregate._sum.views ?? 0,
            reactions: context.aggregate._sum.reactionsTotal ?? 0,
            replies: context.aggregate._sum.repliesCount ?? 0,
          }, null, 2),
          "",
          "Самые важные сигналы:",
          signals.slice(0, 16).map((signal) => [
            `- ${signal.kind}: ${signal.title}`,
            signal.summary,
            signal.tags.length ? `tags: ${signal.tags.join(", ")}` : "",
          ].filter(Boolean).join(" | ")).join("\n") || "- none",
          "",
          "Сводки секций:",
          sections.map((section) => `- ${section.title}: ${compactText(section.summary, 220)}`).join("\n"),
        ].join("\n"),
      },
    ], {
      schema: {
        name: "hero_theme",
        schema: HERO_THEME_SCHEMA,
      },
    });
    const rawTheme = await parseJsonObject<HeroThemeAgentOutput>(aiConfig, content, (error) => {
      logAgent(options ?? {}, "tool:heroThemeAgent.repairJson:start", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
    const theme = normalizeHeroTheme(rawTheme, context);

    logAgent(options ?? {}, "tool:heroThemeAgent:complete", {
      palette: theme.palette,
      motif: theme.motif,
    });

    return theme;
  } catch (error) {
    const theme = fallbackHeroTheme(context);

    logAgent(options ?? {}, "tool:heroThemeAgent:fallback", {
      error: error instanceof Error ? error.message : String(error),
      palette: theme.palette,
      motif: theme.motif,
    });

    return theme;
  }
}

export async function generateAndStoreSnapshotSummary(
  prisma: PrismaClient,
  aiConfig: AiConfig,
  snapshotId: string,
  options?: Pick<GenerateCommunitySnapshotOptions, "onLog">,
): Promise<{
  snapshotId: string;
  sourceId: string;
  sourceTitle: string;
  summary: string;
  previousSummary: string | null;
}> {
  const snapshot = await prisma.sourceSnapshot.findUnique({
    where: {
      id: snapshotId,
    },
    include: {
      source: true,
      sections: true,
    },
  });

  if (!snapshot) {
    throw new Error(`Snapshot not found: ${snapshotId}`);
  }

  const sections = SECTION_ORDER.flatMap((sectionId) => {
    const section = snapshot.sections.find((candidate) => candidate.sectionId === sectionId);
    return section ? [sectionFromDbRow(section)] : [];
  });

  if (!sections.length) {
    throw new Error(`Snapshot sections not found: ${snapshotId}`);
  }

  const embeddingsConfig = loadEmbeddingsConfig();
  const [context, storedSignals] = await Promise.all([
    buildSnapshotContext(prisma, snapshot.source, embeddingsConfig.model),
    snapshotSignalsAsDocumentSignals(prisma, snapshotId),
  ]);
  const signals = storedSignals.length ? storedSignals : buildSnapshotSignals(sections);
  const summary = await runChannelSummaryAgent(aiConfig, context, sections, signals, options)
    ?? fallbackSnapshotSummary(context, sections);
  const document = {
    ...jsonObject(snapshot.document),
    summary,
  } satisfies Prisma.InputJsonValue;

  await prisma.sourceSnapshot.update({
    where: {
      id: snapshotId,
    },
    data: {
      summary,
      document,
    },
  });

  return {
    snapshotId,
    sourceId: snapshot.sourceId,
    sourceTitle: snapshot.source.title,
    summary,
    previousSummary: snapshot.summary,
  };
}

function fullSnapshotAnalysisWindow(sourceId: string): SnapshotAnalysisWindow {
  return {
    mode: "initial",
    sourceId,
    previousContentCreatedAt: null,
    previousPublishedAt: null,
    toContentCreatedAt: null,
    toPublishedAt: null,
    overlapPublishedAt: null,
    newContentCount: 0,
    contentCount: 0,
  };
}

function searchWindowOptions(window: SnapshotAnalysisWindow) {
  return {
    createdAtLte: window.toContentCreatedAt,
    createdAtGt: window.mode === "incremental" ? window.previousContentCreatedAt : null,
    publishedAtGte: window.mode === "incremental" ? window.overlapPublishedAt : null,
  };
}

async function buildSnapshotContext(
  prisma: PrismaClient,
  chat: Source,
  embeddingsModel: string,
  analysisWindow: SnapshotAnalysisWindow = fullSnapshotAnalysisWindow(chat.id),
): Promise<SnapshotContext> {
  const peopleMessageKind = chat.type === "group" ? "post" : "comment";
  const baseWhere = contentWhereForAnalysisWindow(analysisWindow);
  const [aggregate, topMessages, messageCount, embeddingCount, dateRange, topCommenterGroups] = await Promise.all([
    prisma.contentItem.aggregate({
      where: baseWhere,
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
    }),
    prisma.contentItem.findMany({
      where: contentWhereForAnalysisWindow(analysisWindow, {
        text: {
          not: null,
        },
      }),
      orderBy: {
        engagementScore: "desc",
      },
      take: 12,
      select: {
        externalId: true,
        publishedAt: true,
        text: true,
        views: true,
        forwards: true,
        reactionsTotal: true,
        repliesCount: true,
        engagementScore: true,
      },
    }),
    prisma.contentItem.count({
      where: baseWhere,
    }),
    prisma.contentEmbedding.count({
      where: {
        item: baseWhere,
        model: embeddingsModel,
      },
    }),
    prisma.contentItem.aggregate({
      where: baseWhere,
      _min: {
        publishedAt: true,
      },
      _max: {
        publishedAt: true,
      },
    }),
    prisma.contentItem.groupBy({
      by: ["actorId"],
      where: contentWhereForAnalysisWindow(analysisWindow, {
        kind: peopleMessageKind,
        actorId: {
          not: null,
        },
      }),
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
      orderBy: {
        _count: {
          actorId: "desc",
        },
      },
      take: Number(process.env.SNAPSHOT_PEOPLE_CONTEXT_LIMIT || "30"),
    }),
  ]);
  const topCommenters = await Promise.all(
    topCommenterGroups.flatMap((group) => group.actorId ? [group] : []).map(async (group) => {
      const [user, examples] = await Promise.all([
        prisma.actor.findUnique({
          where: {
            id: group.actorId as string,
          },
          select: {
            id: true,
            externalId: true,
            username: true,
            firstName: true,
            lastName: true,
          },
        }),
        prisma.contentItem.findMany({
          where: contentWhereForAnalysisWindow(analysisWindow, {
            kind: peopleMessageKind,
            actorId: group.actorId,
            text: {
              not: null,
            },
          }),
          orderBy: {
            engagementScore: "desc",
          },
          take: 3,
          select: {
            externalId: true,
            text: true,
            publishedAt: true,
          },
        }),
      ]);

      return {
        actorId: user?.id ?? group.actorId as string,
        externalId: user?.externalId ?? "",
        username: user?.username ?? null,
        firstName: user?.firstName ?? null,
        lastName: user?.lastName ?? null,
        messages: group._count._all,
        reactions: group._sum.reactionsTotal ?? 0,
        replies: group._sum.repliesCount ?? 0,
        avgEngagement: group._avg.engagementScore ?? 0,
        examples,
      };
    }),
  );
  return {
    chat,
    aggregate: aggregate as SnapshotAggregate,
    topMessages,
    topCommenters,
    messageCount,
    embeddingCount,
    oldestMessageDate: dateRange._min.publishedAt,
    newestMessageDate: dateRange._max.publishedAt,
    analysisWindow,
  };
}

async function runSectionAgent(
  prisma: PrismaClient,
  aiConfig: AiConfig,
  context: SnapshotContext,
  definition: SignalAgentDefinition,
  embeddingsConfig: ReturnType<typeof loadEmbeddingsConfig>,
  options: GenerateCommunitySnapshotOptions,
): Promise<ChannelSnapshotSection> {
  const maxRounds = Number(process.env.SNAPSHOT_SECTION_AGENT_MAX_ROUNDS || "2");
  const maxSearches = Number(process.env.SNAPSHOT_SECTION_AGENT_MAX_SEARCHES || "6");
  const maxSearchesPerRound = Number(process.env.SNAPSHOT_SECTION_AGENT_MAX_SEARCHES_PER_ROUND || "3");
  const evidenceResults: SearchMessageResult[][] = [];
  const ragLimit = Number(process.env.SNAPSHOT_SECTION_AGENT_RAG_LIMIT || "10");
  const usedQueries = new Set<string>();
  const queries: string[] = [];
  let evidence: SearchMessageResult[] = [];
  let conversationWindows: ConversationWindow[] = [];
  let stopReason = "max_rounds";

  for (let round = 1; round <= maxRounds && queries.length < maxSearches; round += 1) {
    conversationWindows = await buildConversationWindows(prisma, context, evidence);
    logAgent(options, "agent:section.plan:start", {
      agent: definition.agent,
      round,
      maxRounds,
      searchesUsed: queries.length,
      maxSearches,
      maxSearchesPerRound,
      evidence: evidence.length,
      conversationWindows: conversationWindows.length,
      model: aiConfig.model,
    });
    const planContent = await createChatCompletion(aiConfig, [
      {
        role: "system",
        content: buildSignalSearchPlannerSystemPrompt(definition),
      },
      {
        role: "user",
        content: [
          `Группа сигналов: ${definition.title}`,
          `Задача: ${definition.instruction}`,
          `Базовый query: ${definition.query}`,
          `Раунд: ${round}/${maxRounds}`,
          `Осталось поисков: ${maxSearches - queries.length}`,
          "",
          "Уже выполненные RAG queries:",
          queries.length ? queries.map((query, index) => `${index + 1}. ${query}`).join("\n") : "- none",
          "",
          sectionAgentContextBlock(context),
          "",
          "Current RAG hits:",
          formatMessageEvidence(evidence) || "- none yet",
          "",
          context.chat.type === "group"
            ? [
                "Current conversation windows:",
                formatConversationWindows(conversationWindows) || "- none yet",
              ].join("\n")
            : "",
        ].join("\n"),
      },
    ], {
      schema: {
        name: "section_search_plan",
        schema: SECTION_SEARCH_PLAN_SCHEMA,
      },
    });
    const plan = await parseJsonObject<SectionAgentSearchPlan>(aiConfig, planContent, (error) => {
      logAgent(options, "agent:section.plan.repairJson:start", {
        agent: definition.agent,
        round,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    const roundQueries = uniqueSearchQueries({
      definition,
      plan,
      usedQueries,
      includeBaseQuery: round === 1,
      remaining: Math.min(maxSearches - queries.length, maxSearchesPerRound),
    });
    logAgent(options, "agent:section.plan:complete", {
      agent: definition.agent,
      round,
      enoughEvidence: Boolean(plan.enoughEvidence),
      reason: plan.reason,
      queries: roundQueries,
    });

    if (plan.enoughEvidence && evidence.length > 0) {
      stopReason = "enough_evidence";
      break;
    }

    if (!roundQueries.length) {
      stopReason = "no_more_queries";
      break;
    }

    for (const query of roundQueries) {
      const normalized = query.toLowerCase().replace(/\s+/g, " ").trim();
      usedQueries.add(normalized);
      queries.push(query);
      logAgent(options, "tool:rag.searchMessages:start", {
        agent: definition.agent,
        round,
        query,
        index: queries.length,
        maxSearches,
        limit: ragLimit,
      });
      const result = await searchMessages(prisma, embeddingsConfig, {
        sourceId: context.chat.id,
        query,
        limit: ragLimit,
        ...searchWindowOptions(context.analysisWindow),
      });
      evidenceResults.push(result);
      evidence = mergeEvidence(evidenceResults);
      logAgent(options, "tool:rag.searchMessages:complete", {
        agent: definition.agent,
        round,
        query,
        results: result.length,
        mergedEvidence: evidence.length,
        topIds: result.slice(0, 5).map((message) => message.externalId),
      });
    }
  }

  conversationWindows = await buildConversationWindows(prisma, context, evidence);
  logAgent(options, "agent:section.evidence:complete", {
    agent: definition.agent,
    queries: queries.length,
    evidence: evidence.length,
    conversationWindows: conversationWindows.length,
    stopReason,
    topIds: evidence.slice(0, 8).map((message) => message.externalId),
  });

  logAgent(options, "agent:section.extract:start", {
    agent: definition.agent,
    model: aiConfig.model,
  });
  const content = await createChatCompletion(aiConfig, [
    {
      role: "system",
      content: buildSectionAgentSystemPrompt(definition),
    },
    {
      role: "user",
      content: [
        `Группа сигналов: ${definition.title}`,
        `Задача: ${definition.instruction}`,
        `Максимум items: ${definition.maxItems}`,
        "",
        "RAG search plan:",
        queries.map((query, index) => `${index + 1}. ${query}`).join("\n"),
        `RAG stop reason: ${stopReason}`,
        "",
        sectionAgentContextBlock(context),
        "",
        "RAG hits:",
        formatMessageEvidence(evidence) || "- none",
        "",
        context.chat.type === "group"
          ? [
              "Conversation windows around RAG hits:",
              "Use these chronological windows to understand message order, replies, and local context. Cite concrete item ids from the windows/evidence.",
              formatConversationWindows(conversationWindows) || "- no windows",
            ].join("\n")
          : "",
      ].join("\n"),
    },
  ], {
    schema: {
      name: "section_agent_output",
      schema: SECTION_AGENT_OUTPUT_SCHEMA,
    },
  });
  logAgent(options, "agent:section.extract:complete", {
    agent: definition.agent,
    chars: content.length,
  });

  return normalizeSectionOutput(
    definition,
    await parseJsonObject<SectionAgentOutput>(aiConfig, content, (error) => {
      logAgent(options, "tool:llm.repairJson:start", {
        agent: definition.agent,
        error: error instanceof Error ? error.message : String(error),
      });
    }),
  );
}

export async function generateCommunitySnapshot(
  prisma: PrismaClient,
  aiConfig: AiConfig,
  options: GenerateCommunitySnapshotOptions,
): Promise<GenerateCommunitySnapshotResult> {
  const startedAt = Date.now();
  logAgent(options, "agent:start", {
    agent: "ChannelSnapshotCoordinator",
    sourceId: options.chat.id,
    snapshotId: options.snapshotId,
    title: options.chat.title,
  });
  await progressAgent(options, 5);

  const embeddingsConfig = loadEmbeddingsConfig();
  logAgent(options, "tool:loadEmbeddingsConfig", {
    model: embeddingsConfig.model,
    batchSize: embeddingsConfig.batchSize,
  });
  const analysisWindow = await planSnapshotAnalysisWindow(prisma, options.chat);
  logAgent(options, "tool:planSnapshotAnalysisWindow", {
    mode: analysisWindow.mode,
    newContentCount: analysisWindow.newContentCount,
    contentCount: analysisWindow.contentCount,
    previousContentCreatedAt: analysisWindow.previousContentCreatedAt?.toISOString() ?? null,
    previousPublishedAt: analysisWindow.previousPublishedAt?.toISOString() ?? null,
    toContentCreatedAt: analysisWindow.toContentCreatedAt?.toISOString() ?? null,
    toPublishedAt: analysisWindow.toPublishedAt?.toISOString() ?? null,
    overlapPublishedAt: analysisWindow.overlapPublishedAt?.toISOString() ?? null,
  });

  const title = `Снимок по каналу: ${options.chat.title}`;
  const snapshotStartedAt = new Date();
  const initialPipeline = {
    status: "running",
    updatedAt: snapshotStartedAt.toISOString(),
    snapshot: {
      status: "running",
      startedAt: snapshotStartedAt.toISOString(),
    },
    sections: {
      status: "pending",
      total: SIGNAL_AGENTS.length,
      completed: 0,
      failed: 0,
    },
    analysis: {
      status: "running",
      window: snapshotAnalysisWindowToJson(analysisWindow),
    },
    curation: {
      status: "pending",
      processed: 0,
    },
    formatting: {
      status: "pending",
    },
    images: {
      status: "pending",
      previewsTotal: 0,
      previewsCompleted: 0,
    },
  } satisfies Prisma.InputJsonValue;
  const snapshot = options.snapshotId
    ? await prisma.sourceSnapshot.update({
        where: {
          id: options.snapshotId,
        },
        data: {
          title,
          status: "running",
          startedAt: snapshotStartedAt,
          completedAt: null,
          error: null,
          model: aiConfig.model,
          pipeline: initialPipeline,
        },
      })
    : await prisma.sourceSnapshot.create({
        data: {
          sourceId: options.chat.id,
          kind: SNAPSHOT_KIND,
          title,
          status: "running",
          startedAt: snapshotStartedAt,
          model: aiConfig.model,
          pipeline: initialPipeline,
        },
      });
  if (analysisWindow.mode === "incremental" && analysisWindow.newContentCount === 0) {
    const completedAt = new Date();

    await prisma.sourceSnapshot.update({
      where: {
        id: snapshot.id,
      },
      data: {
        status: "skipped",
        completedAt,
        periodFrom: analysisWindow.previousPublishedAt,
        periodTo: analysisWindow.previousPublishedAt,
      },
    });
    await patchSnapshotPipeline(prisma, snapshot.id, {
      status: "skipped",
      analysis: {
        status: "skipped",
        reason: "no_new_content",
        completedAt: completedAt.toISOString(),
      },
      sections: {
        status: "skipped",
        total: 0,
        completed: 0,
        failed: 0,
      },
      curation: {
        status: "skipped",
        reason: "no_new_content",
      },
      formatting: {
        status: "skipped",
      },
      images: {
        status: "skipped",
      },
    });
    logAgent(options, "agent:skipped", {
      snapshotId: snapshot.id,
      reason: "no_new_content",
    });
    await progressAgent(options, 100);

    return {
      snapshotId: snapshot.id,
      title: snapshot.title,
      model: snapshot.model,
      signalJobs: [],
    };
  }
  logAgent(options, "tool:updateSnapshotStatus", {
    snapshotId: snapshot.id,
    status: "running",
  });

  logAgent(options, "tool:getSnapshotContext:start");
  const context = await buildSnapshotContext(prisma, options.chat, embeddingsConfig.model, analysisWindow);
  logAgent(options, "tool:getSnapshotContext:complete", {
    messages: context.messageCount,
    embeddings: context.embeddingCount,
    topMessages: context.topMessages.length,
    views: context.aggregate._sum.views ?? 0,
    reactions: context.aggregate._sum.reactionsTotal ?? 0,
    replies: context.aggregate._sum.repliesCount ?? 0,
  });
  await progressAgent(options, 12);

  if (context.messageCount === 0) {
    throw new Error(`Cannot generate snapshot for ${options.chat.title}: no imported messages.`);
  }

  if (context.embeddingCount === 0) {
    throw new Error(`Cannot generate snapshot for ${options.chat.title}: no embeddings found for ${embeddingsConfig.model}.`);
  }

  logAgent(options, "tool:initSnapshotSections:start", {
    snapshotId: snapshot.id,
    sections: SECTION_ORDER.length,
  });
  await prisma.sourceSnapshotSection.deleteMany({
    where: {
      snapshotId: snapshot.id,
    },
  });
  await prisma.sourceSnapshotSection.createMany({
    data: SIGNAL_AGENTS.map((section) => ({
        snapshotId: snapshot.id,
        sectionId: section.id,
        title: section.title,
        agent: section.agent,
        status: "pending",
      })),
  });
  await patchSnapshotPipeline(prisma, snapshot.id, {
    status: "running",
    sections: {
      status: "running",
      total: SIGNAL_AGENTS.length,
      completed: 0,
      failed: 0,
      startedAt: new Date().toISOString(),
    },
  });
  logAgent(options, "tool:initSnapshotSections:complete", {
    snapshotId: snapshot.id,
    signalJobs: SIGNAL_AGENTS.length,
  });
  await progressAgent(options, 100);
  logAgent(options, "agent:complete", {
    snapshotId: snapshot.id,
    elapsedMs: Date.now() - startedAt,
  });

  return {
    snapshotId: snapshot.id,
    title: snapshot.title,
    model: snapshot.model,
    signalJobs: SIGNAL_AGENTS.map((section) => ({
      signalGroupId: section.id,
      agent: section.agent,
    })),
  };
}

export async function generateCommunitySnapshotSection(
  prisma: PrismaClient,
  aiConfig: AiConfig,
  options: GenerateCommunitySnapshotOptions & { sectionId: string },
): Promise<ChannelSnapshotSection> {
  const startedAt = Date.now();
  const snapshotId = options.snapshotId;

  if (!snapshotId) {
    throw new Error("Missing snapshotId for section job.");
  }

  const definition = getSectionDefinition(options.sectionId);
  const embeddingsConfig = loadEmbeddingsConfig();
  const sectionAgentTimeoutMs = Number(process.env.SNAPSHOT_SECTION_AGENT_TIMEOUT_MS || "600000");

  logAgent(options, "agent:section:start", {
    agent: definition.agent,
    snapshotId,
    section: definition.id,
  });

  await prisma.sourceSnapshotSection.update({
    where: {
      snapshotId_sectionId: {
        snapshotId,
        sectionId: definition.id,
      },
    },
    data: {
      status: "running",
      startedAt: new Date(),
      completedAt: null,
      error: null,
    },
  });

  try {
    const analysisWindow = await readSnapshotAnalysisWindow(prisma, snapshotId, options.chat.id)
      ?? fullSnapshotAnalysisWindow(options.chat.id);
    const context = await buildSnapshotContext(prisma, options.chat, embeddingsConfig.model, analysisWindow);
    const section = await withTimeout(
      runSectionAgent(
        prisma,
        aiConfig,
        context,
        definition,
        embeddingsConfig,
        options,
      ),
      sectionAgentTimeoutMs,
      `${definition.agent} section`,
    );

    await prisma.sourceSnapshotSection.update({
      where: {
        snapshotId_sectionId: {
          snapshotId,
          sectionId: definition.id,
        },
      },
      data: {
        status: "completed",
        summary: section.summary,
        items: section.items as Prisma.InputJsonValue,
        completedAt: new Date(),
      },
    });
    const counts = await prisma.sourceSnapshotSection.groupBy({
      by: ["status"],
      where: {
        snapshotId,
      },
      _count: {
        _all: true,
      },
    });
    const completed = counts.find((item) => item.status === "completed")?._count._all ?? 0;
    const failed = counts.find((item) => item.status === "failed")?._count._all ?? 0;
    const running = counts.find((item) => item.status === "running")?._count._all ?? 0;
    const pending = counts.find((item) => item.status === "pending")?._count._all ?? 0;

    await patchSnapshotPipeline(prisma, snapshotId, {
      sections: {
        status: failed > 0 ? "failed" : pending + running > 0 ? "running" : "completed",
        total: counts.reduce((sum, item) => sum + item._count._all, 0),
        completed,
        failed,
        running,
        pending,
        lastCompletedSectionId: definition.id,
        error: null,
        failedSectionId: null,
      },
    });

    await completeSnapshotIfReady(prisma, aiConfig, options.chat, snapshotId, embeddingsConfig.model, options);
    logAgent(options, "agent:section:complete", {
      agent: definition.agent,
      section: definition.id,
      elapsedMs: Date.now() - startedAt,
    });

    return section;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.sourceSnapshotSection.update({
      where: {
        snapshotId_sectionId: {
          snapshotId,
          sectionId: definition.id,
        },
      },
      data: {
        status: "failed",
        error: message,
        completedAt: new Date(),
      },
    });
    await prisma.sourceSnapshot.update({
      where: {
        id: snapshotId,
      },
      data: {
        status: "failed",
        error: `${definition.agent}: ${message}`,
        completedAt: new Date(),
      },
    });
    await patchSnapshotPipeline(prisma, snapshotId, {
      status: "failed",
      sections: {
        status: "failed",
        failedSectionId: definition.id,
        error: message,
      },
      errors: [{
        stage: "sections",
        sectionId: definition.id,
        message,
        at: new Date().toISOString(),
      }],
    });

    throw error;
  }
}

async function completeSnapshotIfReady(
  prisma: PrismaClient,
  aiConfig: AiConfig,
  chat: Source,
  snapshotId: string,
  embeddingsModel: string,
  options?: Pick<GenerateCommunitySnapshotOptions, "onLog">,
) {
  const sections = await prisma.sourceSnapshotSection.findMany({
    where: {
      snapshotId,
    },
  });
  const hasFailed = sections.some((section) => section.status === "failed");
  const hasOpen = sections.some((section) => section.status === "pending" || section.status === "running");

  if (hasFailed || hasOpen) {
    return;
  }

  logAgent(options ?? {}, "tool:completeSnapshotIfReady:start", {
    snapshotId,
    sections: sections.length,
  });
  const storedSnapshot = await prisma.sourceSnapshot.findUnique({
    where: {
      id: snapshotId,
    },
    select: {
      document: true,
      pipeline: true,
    },
  });
  const previousCompletedSnapshot = await prisma.sourceSnapshot.findFirst({
    where: {
      sourceId: chat.id,
      status: "completed",
      id: {
        not: snapshotId,
      },
    },
    orderBy: [
      {
        completedAt: "desc",
      },
      {
        createdAt: "desc",
      },
    ],
    select: {
      periodFrom: true,
      periodTo: true,
      summary: true,
      heroTheme: true,
      coverImage: true,
    },
  });
  const previousDocument = storedSnapshot?.document &&
    typeof storedSnapshot.document === "object" &&
    !Array.isArray(storedSnapshot.document) &&
    storedSnapshot.document.snapshotType === "channel"
    ? storedSnapshot.document as Partial<ChannelSnapshotDocument>
    : null;
  const previousTableSignals = await snapshotSignalsAsDocumentSignals(prisma, snapshotId);
  const previousSignalsById = new Map(previousTableSignals.map((signal) => [signal.id, signal]));
  const analysisWindow = snapshotAnalysisWindowFromPipeline(storedSnapshot?.pipeline, chat.id)
    ?? fullSnapshotAnalysisWindow(chat.id);
  const context = await buildSnapshotContext(prisma, chat, embeddingsModel, analysisWindow);
  const orderedSections = SECTION_ORDER.flatMap((sectionId) => {
    const section = sections.find((candidate) => candidate.sectionId === sectionId);
    return section ? [sectionFromDbRow(section)] : [];
  });
  const extractedSignals = await expandGroupThreadEvidence(prisma, context, buildSnapshotSignals(orderedSections));
  const timelineSignals = await enrichSignalsWithTimeline(prisma, chat.id, extractedSignals);
  const externalContextSignals = await enrichSignalsWithWikipedia(aiConfig, timelineSignals, (progress) => {
    logAgent(options ?? {}, "agent:signal.wikipedia:progress", progress);
  });
  const signals = sortSignalsDescending(externalContextSignals.map((signal) => {
    const previousSignal = previousSignalsById.get(signal.id);

    return {
      ...signal,
      previewImage: signal.previewImage ?? previousSignal?.previewImage,
      externalContext: signal.externalContext ?? previousSignal?.externalContext,
    };
  }));
  const previousHeroTheme = jsonObjectValue<ChannelSnapshotHeroTheme>(previousCompletedSnapshot?.heroTheme);
  const previousCoverImage = jsonObjectValue<SnapshotGeneratedImage>(previousCompletedSnapshot?.coverImage);
  const [generatedHeroTheme, generatedSnapshotSummary] = analysisWindow.mode === "incremental" && previousCompletedSnapshot
    ? [previousHeroTheme, previousCompletedSnapshot.summary]
    : await Promise.all([
        generateHeroTheme(aiConfig, context, orderedSections, signals, options),
        runChannelSummaryAgent(aiConfig, context, orderedSections, signals, options),
      ]);
  const heroTheme = generatedHeroTheme ?? fallbackHeroTheme(context);
  const title = `Снимок по каналу: ${chat.title}`;
  const snapshotSummary = generatedSnapshotSummary ?? fallbackSnapshotSummary(context, orderedSections);
  const periodFrom = analysisWindow.mode === "incremental"
    ? minDate(previousCompletedSnapshot?.periodFrom, context.oldestMessageDate)
    : context.oldestMessageDate;
  const periodTo = analysisWindow.mode === "incremental"
    ? maxDate(previousCompletedSnapshot?.periodTo, context.newestMessageDate)
    : context.newestMessageDate;
  const snapshotDocument: ChannelSnapshotDocument = {
    schemaVersion: CHANNEL_SNAPSHOT_SCHEMA_VERSION,
    snapshotType: "channel",
    title,
    sourceId: chat.id,
    chatTitle: chat.title,
    summary: snapshotSummary,
    generatedAt: new Date().toISOString(),
    period: {
      from: periodFrom?.toISOString() ?? null,
      to: periodTo?.toISOString() ?? null,
    },
    heroTheme,
    coverImage: previousDocument?.coverImage ?? previousCoverImage,
    signals,
  };

  const { signals: _signals, ...snapshotDocumentMetadata } = snapshotDocument;

  await prisma.sourceSnapshot.update({
    where: {
      id: snapshotId,
    },
    data: {
      status: "completed",
      completedAt: new Date(),
      model: aiConfig.model,
      periodFrom,
      periodTo,
      summary: snapshotSummary,
      heroTheme: heroTheme satisfies Prisma.InputJsonValue,
      coverImage: snapshotDocument.coverImage ? snapshotDocument.coverImage satisfies Prisma.InputJsonValue : Prisma.JsonNull,
      document: {
        ...snapshotDocumentMetadata,
        embeddingModel: embeddingsModel,
        analysisWindow: snapshotAnalysisWindowToJson(analysisWindow),
      } satisfies Prisma.InputJsonValue,
    },
  });
  const persistedSignals = await replaceSnapshotSignals(prisma, {
    snapshotId,
    sourceId: chat.id,
    signals,
  });
  await patchSnapshotPipeline(prisma, snapshotId, {
    status: "running",
    snapshot: {
      status: "completed",
      completedAt: new Date().toISOString(),
      signals: persistedSignals.signals,
      evidence: persistedSignals.evidence,
      periodFrom: periodFrom?.toISOString() ?? null,
      periodTo: periodTo?.toISOString() ?? null,
    },
    analysis: {
      status: "completed",
      window: snapshotAnalysisWindowToJson(analysisWindow),
      completedAt: new Date().toISOString(),
    },
    sections: {
      status: "completed",
      total: sections.length,
      completed: sections.length,
      failed: 0,
      pending: 0,
      running: 0,
      error: null,
      failedSectionId: null,
    },
    curation: {
      status: "pending",
      pending: persistedSignals.signals,
      processed: 0,
    },
  });

  logAgent(options ?? {}, "tool:completeSnapshotIfReady:complete", {
    snapshotId,
    persistedSignals: persistedSignals.signals,
    persistedEvidence: persistedSignals.evidence,
  });
  try {
    const curationJob = await enqueueSourceSignalCurationJob({
      snapshotId,
    });
    await patchSnapshotPipeline(prisma, snapshotId, {
      curation: {
        status: "queued",
        pending: persistedSignals.signals,
        jobIds: [String(curationJob.id)],
      },
    });

    logAgent(options ?? {}, "tool:sourceSignalCurator:enqueued", {
      snapshotId,
      jobId: curationJob.id,
    });
  } catch (error) {
    await patchSnapshotPipeline(prisma, snapshotId, {
      curation: {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      },
      errors: [{
        stage: "curation",
        message: error instanceof Error ? error.message : String(error),
        at: new Date().toISOString(),
      }],
    });
    logAgent(options ?? {}, "tool:sourceSignalCurator:enqueueFailed", {
      snapshotId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (!snapshotDocument.coverImage?.url) {
    try {
      const coverJob = await enqueueSnapshotCoverImageJob({
        snapshotId,
      });
      await patchSnapshotPipeline(prisma, snapshotId, {
        images: {
          status: "queued",
          coverStatus: "queued",
          coverJobId: String(coverJob.id),
        },
      });

      logAgent(options ?? {}, "tool:snapshotCoverImage:enqueued", {
        snapshotId,
        jobId: coverJob.id,
      });
    } catch (error) {
      await patchSnapshotPipeline(prisma, snapshotId, {
        images: {
          status: "failed",
          coverStatus: "failed",
          coverError: error instanceof Error ? error.message : String(error),
        },
        errors: [{
          stage: "cover-image",
          message: error instanceof Error ? error.message : String(error),
          at: new Date().toISOString(),
        }],
      });
      logAgent(options ?? {}, "tool:snapshotCoverImage:enqueueFailed", {
        snapshotId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const evidenceItemIds = [...new Set(signals.flatMap((signal) =>
    (signal.evidence ?? []).map((evidence) => evidence.itemId).filter(Boolean),
  ))];

  if (evidenceItemIds.length) {
    try {
      const formattingJob = await enqueueContentFormattingJob({
        chat: chat.username ? `@${chat.username}` : chat.title,
        limit: evidenceItemIds.length,
        snapshotId,
        itemIds: evidenceItemIds,
        skipExisting: true,
      });
      await patchSnapshotPipeline(prisma, snapshotId, {
        formatting: {
          status: "queued",
          total: evidenceItemIds.length,
          completed: 0,
          jobIds: [String(formattingJob.id)],
        },
      });

      logAgent(options ?? {}, "tool:contentFormatting:enqueued", {
        snapshotId,
        jobId: formattingJob.id,
        count: evidenceItemIds.length,
      });
    } catch (error) {
      await patchSnapshotPipeline(prisma, snapshotId, {
        formatting: {
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        },
        errors: [{
          stage: "formatting",
          message: error instanceof Error ? error.message : String(error),
          at: new Date().toISOString(),
        }],
      });
      logAgent(options ?? {}, "tool:contentFormatting:enqueueFailed", {
        snapshotId,
        count: evidenceItemIds.length,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await patchSnapshotPipeline(prisma, snapshotId, {
    images: {
      previewsTotal: 0,
      previewsCompleted: 0,
      previewReason: "waiting_for_curation",
    },
  });
}
