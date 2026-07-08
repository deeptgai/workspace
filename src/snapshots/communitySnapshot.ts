import { Prisma, type Source, type PrismaClient } from "@prisma/client";
import { createChatCompletion } from "../ai/chatClient.js";
import type { AiConfig } from "../ai/config.js";
import { loadEmbeddingsConfig } from "../embeddings/config.js";
import { searchMessages, type SearchMessageResult } from "../rag/searchMessages.js";
import {
  CHANNEL_SNAPSHOT_SCHEMA_VERSION,
  type ChannelSnapshotDocument,
  type ChannelSnapshotItem,
  type ChannelSnapshotPeopleSegment,
  type ChannelSnapshotSection,
  type ChannelSnapshotSectionId,
  type SnapshotSignal,
  type SnapshotSignalKind,
  type SnapshotItemPriority,
  type SnapshotItemTag,
  type SnapshotEvidenceRef,
} from "./sourceSnapshotSchema.js";

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

type SignalAgentDefinition = {
  id: ChannelSnapshotSectionId;
  title: string;
  agent: string;
  query: string;
  instruction: string;
  maxItems: number;
};

type SectionAgentOutput = {
  summary?: string;
  items?: Array<Partial<ChannelSnapshotItem>>;
  segments?: Array<Partial<ChannelSnapshotPeopleSegment>>;
};

const ALLOWED_PRIORITIES = new Set<SnapshotItemPriority>(["high", "medium", "low"]);
const ALLOWED_TAGS = new Set<SnapshotItemTag>([
  "has_pain",
  "buyer_intent",
  "objection",
  "asks_advice",
  "service_need",
  "budget_signal",
  "decision_maker",
  "active_commenter",
  "helpful_member",
  "strong_question",
  "looking_for_solution",
  "looking_for_contractor",
  "intro_candidate",
  "similar_to_reader",
  "content_pattern",
  "tool_mention",
  "product_mention",
  "author_recommendation",
  "knowledge_asset",
  "weekly_highlight",
  "positioning_signal",
  "discussion_seed",
  "commercial_opportunity",
  "action_required",
]);
const ALLOWED_METRIC_KEYS = new Set([
  "profile",
  "pain",
  "lead_signal",
  "offer",
  "outreach_reason",
  "subscribers",
  "messages",
  "reactions",
  "comments",
  "reach",
  "views",
  "avg_views",
  "avg_engagement_rate",
  "snapshot_signals",
  "snapshot_evidence",
  "snapshot_confidence",
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
  postCommentSegments: Array<{
    postExternalId: string;
    postText: string | null;
    commenters: Array<{
      externalId: string;
      username: string | null;
      name: string;
      commentText: string | null;
    }>;
  }>;
  messageCount: number;
  embeddingCount: number;
  oldestMessageDate: Date | null;
  newestMessageDate: Date | null;
};

const SNAPSHOT_KIND = "channel_structured_snapshot";

export const SIGNAL_AGENTS: SignalAgentDefinition[] = [
  {
    id: "ideas",
    title: "Идеи",
    agent: "IdeaSignalAgent",
    query: "ideas theses beliefs principles positioning product thinking business ideas",
    instruction: "Найди сильные идеи и тезисы, которые подписчик может забрать себе. Каждая item — одна самостоятельная идея, не пересказ поста. Объясни, чем она полезна и где подтверждается.",
    maxItems: 8,
  },
  {
    id: "pains",
    title: "Боли",
    agent: "PainSignalAgent",
    query: "pain points problems frustration struggle objections requests needs difficult work",
    instruction: "Найди боли и напряжения, где читатель может узнать себя: что сложно, неприятно, тормозит рост, требует решения. Для каналов без комментариев формулируй боли как осторожные гипотезы по текстам автора.",
    maxItems: 8,
  },
  {
    id: "hypotheses",
    title: "Гипотезы",
    agent: "HypothesisSignalAgent",
    query: "hypotheses experiments opportunities maybe test launch new direction growth possibility",
    instruction: "Найди гипотезы: идеи в проверке, возможные направления роста, коммерческие возможности, эксперименты и предположения автора. Каждая гипотеза должна иметь понятный следующий тест или критерий проверки.",
    maxItems: 7,
  },
  {
    id: "insights",
    title: "Инсайты",
    agent: "InsightSignalAgent",
    query: "insights conclusions learnings non obvious lessons takeaways what works why it matters",
    instruction: "Найди неочевидные выводы и уроки, которые можно применить без чтения всей ленты. Инсайт должен быть сильнее пересказа: формулируй как вывод из нескольких наблюдений или сильного поста.",
    maxItems: 8,
  },
  {
    id: "materials",
    title: "Материалы",
    agent: "MaterialSignalAgent",
    query: "links youtube books articles posts resources references recommendations materials",
    instruction: "Собери материалы: книги, видео, статьи, внешние посты, ссылки и рекомендации. Не выдумывай URL; если точной ссылки нет в evidence, оставь ее в metrics как mention_type/source_context, но не добавляй url.",
    maxItems: 10,
  },
  {
    id: "tools",
    title: "Инструменты",
    agent: "ToolKnowledgeAgent",
    query: "tools methods frameworks apps platforms techniques CRM BI Jira ChatGPT SEO security",
    instruction: "Собери инструменты в широком смысле: сервисы, методы, приемы работы, фреймворки, связки систем и практики, которые читатель может повторить у себя. Не смешивай с материалами для чтения/просмотра.",
    maxItems: 12,
  },
  {
    id: "places",
    title: "Места",
    agent: "PlaceSignalAgent",
    query: "places locations city cafe park bay station travel Saint Petersburg context atmosphere",
    instruction: "Найди места, которые имеют смысловую роль в канале: где происходили важные события, что дает атмосферу, энергию, нетворк или контекст автора. Не добавляй место, если оно не упоминалось явно.",
    maxItems: 6,
  },
  {
    id: "people",
    title: "Люди",
    agent: "PeopleSignalAgent",
    query: "comments people commenters leads pain points buyer intent objections requests audience participants",
    instruction: "Собери людей только по конкретным пользователям из комментариев и явным людям из постов. Каждый item — один конкретный человек. Опиши наблюдаемый интерес, сегменты, почему с ним может быть полезно познакомиться и мягкий повод для контакта. Не оценивай личность, не делай чувствительные выводы, опирайся только на evidence.",
    maxItems: 12,
  },
];

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

function formatPostCommentSegments(context: SnapshotContext): string {
  if (context.postCommentSegments.length === 0) {
    return "- no post/comment groups";
  }

  return context.postCommentSegments.map((segment) => [
    `- candidateId=post-${segment.postExternalId}`,
    `postExternalId=${segment.postExternalId}`,
    `postText="${compactText(segment.postText, 260)}"`,
    `people=${segment.commenters.map((person) => [
      person.externalId,
      person.username ? `@${person.username}` : person.name,
      `"${compactText(person.commentText, 90)}"`,
    ].join(":")).join(" ; ")}`,
  ].join(" | ")).join("\n");
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
        content: [
          "Ты исправляешь сломанный JSON.",
          "Верни только валидный JSON object без Markdown и без code fence.",
          "Не добавляй новых фактов и не меняй смысл данных.",
          "Исправь только синтаксис: кавычки, запятые, экранирование, обрезанные строки.",
        ].join("\n"),
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

  const tags = [...new Set(value.filter((tag): tag is SnapshotItemTag =>
    typeof tag === "string" && ALLOWED_TAGS.has(tag as SnapshotItemTag),
  ))];

  return tags.length ? tags : undefined;
}

function normalizeMetricKey(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const key = value.trim();

  return ALLOWED_METRIC_KEYS.has(key) ? key : null;
}

function normalizePeopleSegments(value: unknown): ChannelSnapshotPeopleSegment[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const segments = value.flatMap((segment, index) => {
    if (!segment || typeof segment !== "object") {
      return [];
    }

    const candidate = segment as {
      id?: unknown;
      title?: unknown;
      summary?: unknown;
      sourceCandidateIds?: unknown;
      actorExternalIds?: unknown;
      evidence?: unknown;
    };
    const sourceCandidateIds = Array.isArray(candidate.sourceCandidateIds)
      ? [...new Set(candidate.sourceCandidateIds.flatMap((id) => (
          typeof id === "string" && id.trim() ? [id.trim()] : []
        )))]
      : [];
    const actorExternalIds = Array.isArray(candidate.actorExternalIds)
      ? [...new Set(candidate.actorExternalIds.flatMap((id) => (
          typeof id === "string" && id.trim() ? [id.trim()] : []
        )))]
      : [];

    if (!actorExternalIds.length && !sourceCandidateIds.length) {
      return [];
    }

    return [{
      id: typeof candidate.id === "string" && candidate.id.trim()
        ? candidate.id.trim().replace(/[^a-z0-9_-]+/giu, "-").toLowerCase()
        : `segment-${index + 1}`,
      title: typeof candidate.title === "string" && candidate.title.trim()
        ? candidate.title.trim()
        : `Сегмент ${index + 1}`,
      summary: typeof candidate.summary === "string" ? candidate.summary : "",
      sourceCandidateIds,
      actorExternalIds,
      evidence: normalizeEvidence(candidate.evidence),
    }];
  });

  return segments.length ? segments : undefined;
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
    segments: definition.id === "people" ? normalizePeopleSegments(output.segments) : undefined,
  };
}

function applyPostCommentSegments(section: ChannelSnapshotSection, context: SnapshotContext): ChannelSnapshotSection {
  if (section.id !== "people") {
    return section;
  }

  const candidates = context.postCommentSegments.map((candidate) => ({
    id: `post-${candidate.postExternalId}`,
    title: compactText(candidate.postText, 72) || `Пост ${candidate.postExternalId}`,
    summary: compactText(candidate.postText, 220),
    actorExternalIds: candidate.commenters.map((person) => person.externalId),
  }));
  const peopleByCandidate = new Map(candidates.map((candidate) => [
    candidate.id,
    candidate.actorExternalIds,
  ]));

  const llmSegments = (section.segments ?? []).map((segment) => {
    const candidatePeople = (segment.sourceCandidateIds ?? []).flatMap((candidateId) =>
        peopleByCandidate.get(candidateId) ?? [],
    );

    return {
      ...segment,
      actorExternalIds: [...new Set([
        ...segment.actorExternalIds,
        ...candidatePeople,
      ])],
    };
  }).filter((segment) => segment.actorExternalIds.length > 0);

  return {
    ...section,
    segments: llmSegments,
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
    segments: section.segments ? section.segments as Prisma.InputJsonValue : undefined,
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
  segments: Prisma.JsonValue | null;
}): ChannelSnapshotSection {
  return {
    id: row.sectionId as ChannelSnapshotSectionId,
    title: row.title,
    agent: row.agent,
    summary: row.summary ?? "",
    items: Array.isArray(row.items) ? row.items as ChannelSnapshotItem[] : [],
    segments: Array.isArray(row.segments) ? row.segments as ChannelSnapshotPeopleSegment[] : undefined,
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

  if (sectionId === "hypotheses") {
    return "hypothesis";
  }

  if (sectionId === "insights") {
    return "insight";
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

const snapshotTagLabels: Record<SnapshotItemTag, string> = {
  has_pain: "боль",
  buyer_intent: "спрос",
  objection: "возражение",
  asks_advice: "совет",
  service_need: "услуга",
  budget_signal: "бюджет",
  decision_maker: "decision maker",
  active_commenter: "активный",
  helpful_member: "помогает",
  strong_question: "сильный вопрос",
  looking_for_solution: "ищет решение",
  looking_for_contractor: "ищет подрядчика",
  intro_candidate: "нетворк",
  similar_to_reader: "peer",
  content_pattern: "контент",
  tool_mention: "инструмент",
  product_mention: "продукт",
  author_recommendation: "рекомендация",
  knowledge_asset: "материал",
  weekly_highlight: "highlight",
  positioning_signal: "позиционирование",
  discussion_seed: "обсуждение",
  commercial_opportunity: "возможность",
  action_required: "действие",
};

function signalTags(section: ChannelSnapshotSection, item: ChannelSnapshotItem, kind: SnapshotSignalKind) {
  const tags = [
    ...(item.tags ?? []).map((tag) => snapshotTagLabels[tag] ?? tag),
  ].map((tag) => tag.trim()).filter((tag) => {
    if (!tag) {
      return false;
    }

    const normalized = tag.toLowerCase();
    return ![
      "идея",
      "идеи",
      "боль",
      "боли",
      "гипотеза",
      "гипотезы",
      "инсайт",
      "инсайты",
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
      section.title.toLowerCase(),
      kind,
    ].includes(normalized);
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
            segments: signalTags(section, item, kind).filter((tag) => tag !== "человек" && tag !== section.title).slice(0, 4),
          }
        : undefined,
    }));
  });
}

async function buildSnapshotContext(prisma: PrismaClient, chat: Source, embeddingsModel: string): Promise<SnapshotContext> {
  const peopleMessageKind = chat.type === "group" ? "post" : "comment";
  const [aggregate, topMessages, messageCount, embeddingCount, dateRange, topCommenterGroups] = await Promise.all([
    prisma.contentItem.aggregate({
      where: {
        sourceId: chat.id,
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
    }),
    prisma.contentItem.findMany({
      where: {
        sourceId: chat.id,
        text: {
          not: null,
        },
      },
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
      where: {
        sourceId: chat.id,
      },
    }),
    prisma.contentEmbedding.count({
      where: {
        item: {
          sourceId: chat.id,
        },
        model: embeddingsModel,
      },
    }),
    prisma.contentItem.aggregate({
      where: {
        sourceId: chat.id,
      },
      _min: {
        publishedAt: true,
      },
      _max: {
        publishedAt: true,
      },
    }),
    prisma.contentItem.groupBy({
      by: ["actorId"],
      where: {
        sourceId: chat.id,
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
          where: {
            sourceId: chat.id,
            kind: peopleMessageKind,
            actorId: group.actorId,
            text: {
              not: null,
            },
          },
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
  const postCommentSegments = chat.type === "group"
    ? (await prisma.contentItem.findMany({
        where: {
          sourceId: chat.id,
          kind: "post",
          actorId: {
            not: null,
          },
          text: {
            not: null,
          },
        },
        orderBy: {
          engagementScore: "desc",
        },
        take: Number(process.env.SNAPSHOT_POST_SEGMENT_LIMIT || "25"),
        select: {
          externalId: true,
          text: true,
          actor: {
            select: {
              externalId: true,
              username: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      })).flatMap((message) => message.actor ? [{
        postExternalId: message.externalId,
        postText: message.text,
        commenters: [{
          externalId: message.actor.externalId,
          username: message.actor.username,
          name: [message.actor.firstName, message.actor.lastName].filter(Boolean).join(" ") || message.actor.username || "Пользователь",
          commentText: message.text,
        }],
      }] : [])
    : (await prisma.contentItem.findMany({
        where: {
          sourceId: chat.id,
          kind: "post",
          children: {
            some: {
              actorId: {
                not: null,
              },
            },
          },
        },
        orderBy: [
          {
            repliesCount: "desc",
          },
          {
            engagementScore: "desc",
          },
        ],
        take: Number(process.env.SNAPSHOT_POST_SEGMENT_LIMIT || "25"),
        select: {
          externalId: true,
          text: true,
          children: {
            where: {
              actorId: {
                not: null,
              },
            },
            orderBy: {
              engagementScore: "desc",
            },
            take: Number(process.env.SNAPSHOT_POST_SEGMENT_COMMENTS_LIMIT || "8"),
            select: {
              text: true,
              actor: {
                select: {
                  externalId: true,
                  username: true,
                  firstName: true,
                  lastName: true,
                },
              },
            },
          },
        },
      })).flatMap((post) => {
        const seen = new Set<string>();
        const commenters = post.children.flatMap((comment) => {
          if (!comment.actor || seen.has(comment.actor.externalId)) {
            return [];
          }

          seen.add(comment.actor.externalId);
          return [{
            externalId: comment.actor.externalId,
            username: comment.actor.username,
            name: [comment.actor.firstName, comment.actor.lastName].filter(Boolean).join(" ") || comment.actor.username || "Пользователь",
            commentText: comment.text,
          }];
        });

        return commenters.length ? [{
          postExternalId: post.externalId,
          postText: post.text,
          commenters,
        }] : [];
      });

  return {
    chat,
    aggregate: aggregate as SnapshotAggregate,
    topMessages,
    topCommenters,
    postCommentSegments,
    messageCount,
    embeddingCount,
    oldestMessageDate: dateRange._min.publishedAt,
    newestMessageDate: dateRange._max.publishedAt,
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
  logAgent(options, "tool:rag.searchMessages:start", {
    agent: definition.agent,
    query: definition.query,
    limit: 10,
  });
  const evidence = await searchMessages(prisma, embeddingsConfig, {
    sourceId: context.chat.id,
    query: definition.query,
    limit: 10,
  });
  logAgent(options, "tool:rag.searchMessages:complete", {
    agent: definition.agent,
    results: evidence.length,
    topIds: evidence.slice(0, 5).map((message) => message.externalId),
  });

  logAgent(options, "tool:llm.createChatCompletion:start", {
    agent: definition.agent,
    model: aiConfig.model,
  });
  const content = await createChatCompletion(aiConfig, [
    {
      role: "system",
      content: [
        `Ты ${definition.agent}.`,
        "Ты извлекаешь одну группу сигналов из Telegram-канала для карты пользы.",
        "Пиши строго на русском, кроме названий брендов, компаний, технологий и username.",
        "Для машинной логики используй только формализованные поля: priority, tags и metrics.key. Не кодируй смысл в русском label.",
        "priority может быть только: high, medium, low.",
        "tags выбирай только из списка: has_pain, buyer_intent, objection, asks_advice, service_need, budget_signal, decision_maker, active_commenter, helpful_member, strong_question, looking_for_solution, looking_for_contractor, intro_candidate, similar_to_reader, content_pattern, tool_mention, product_mention, author_recommendation, knowledge_asset, weekly_highlight, positioning_signal, discussion_seed, commercial_opportunity, action_required.",
        "metrics.key выбирай только из списка: profile, pain, lead_signal, offer, outreach_reason, intro_reason, helper_signal, question_signal, solution_need, contractor_need, similarity_reason, impact, effort, priority_reason, topic_strength, demand_signal, commercial_potential, content_pattern, recommendation_type, recommendation_source, recommended_action, mention_type, mentioned_entity, why_it_matters, source_context, time_window, digest_signal, learning_type, learning_asset, positioning_angle, author_thesis, audience_fit, discussion_prompt, tg_post_idea.",
        "metric.label можешь писать на русском для чтения человеком, но UI не будет использовать label для логики.",
        "Не выдумывай факты. Любой важный вывод должен ссылаться на itemId из evidence.",
        "Не пиши itemId, post id, chat id, channel id, user id, provider id, отрицательные id вида -100... или технические ссылки в summary, title, description, score или metrics. Идентификаторы сообщений указывай только в массиве evidence.",
        "Для людей используй только конкретных пользователей из People/commenter signals. Не создавай сегменты, архетипы или группы аудитории.",
        definition.id === "people"
          ? "Для people-сигналов верни три слоя данных: items как конкретные люди, tags для социальных подборок и segments как группы людей. Каждый item должен быть строго одним конкретным человеком из People/commenter signals. Обязательно верни actorExternalId точно как в People/commenter signals. Если есть username, верни personUsername без @. personName верни из personName. Не пиши items вида 'Сегмент: ...'. Не объединяй нескольких людей в один item. Для каждого человека определи социальные роли только по evidence: intro_candidate если с ним стоит познакомиться, helpful_member если он помогает/отвечает/делится опытом, strong_question если задает сильные вопросы, looking_for_solution если ищет решение/совет/инструмент, looking_for_contractor если ищет подрядчика/услугу/исполнителя, similar_to_reader если профиль похож на типичного активного читателя канала или полезен для peer networking. В metrics используй keys: profile, pain, lead_signal, offer, outreach_reason, intro_reason, helper_signal, question_signal, solution_need, contractor_need, similarity_reason. segments называй и объясняй по Post/comment segment candidates. Сделай примерно 5-8 осмысленных сегментов: не 3-5 слишком общих групп и не один сегмент на каждый пост. Люди могут быть в нескольких сегментах, это нормально. Backend сам добавит всех людей из этих постовых кандидатов, поэтому не пытайся вручную перечислить всех actorExternalIds. Для теплоты лида используй priority: high/medium/low. Добавляй tags has_pain, buyer_intent, asks_advice, service_need, budget_signal, decision_maker, active_commenter только когда это подтверждено evidence."
          : "",
        "Верни только JSON object без Markdown и без code fence.",
        "JSON schema:",
        JSON.stringify({
          summary: "string",
          items: [{
            title: "string",
            description: "string",
            url: "direct external URL optional, only when explicitly present in evidence",
            actorExternalId: "string required for people section",
            personUsername: "string optional without @",
            personName: "string optional",
            score: "short human-readable label optional",
            priority: "high | medium | low optional",
            tags: ["has_pain | buyer_intent | objection | asks_advice | service_need | budget_signal | decision_maker | active_commenter | helpful_member | strong_question | looking_for_solution | looking_for_contractor | intro_candidate | similar_to_reader | content_pattern | tool_mention | product_mention | author_recommendation | knowledge_asset | weekly_highlight | positioning_signal | discussion_seed | commercial_opportunity | action_required"],
            confidence: "number 0..1",
            metrics: [{ key: "stable_machine_key", label: "human readable label", value: "string" }],
            evidence: [{ itemId: "source item external id", quote: "short quote optional", reason: "why this evidence matters" }],
          }],
          segments: [{
            id: "stable_slug",
            title: "string",
            summary: "string",
            sourceCandidateIds: ["post-source-item-external-id"],
            actorExternalIds: ["string"],
            evidence: [{ itemId: "source item external id", quote: "short quote optional", reason: "why this evidence matters" }],
          }],
        }),
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Группа сигналов: ${definition.title}`,
        `Задача: ${definition.instruction}`,
        `Максимум items: ${definition.maxItems}`,
        "",
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
        "",
        "Post/comment segment candidates:",
        definition.id === "people" ? formatPostCommentSegments(context) : "- only used by PeopleSignalAgent",
        "",
        "Evidence from RAG:",
        formatMessageEvidence(evidence) || "- none",
      ].join("\n"),
    },
  ], { json: true });
  logAgent(options, "tool:llm.createChatCompletion:complete", {
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

  const title = `Снимок по каналу: ${options.chat.title}`;
  const snapshot = options.snapshotId
    ? await prisma.sourceSnapshot.update({
        where: {
          id: options.snapshotId,
        },
        data: {
          title,
          status: "running",
          startedAt: new Date(),
          completedAt: null,
          error: null,
          model: aiConfig.model,
        },
      })
    : await prisma.sourceSnapshot.create({
        data: {
          sourceId: options.chat.id,
          kind: SNAPSHOT_KIND,
          title,
          status: "running",
          startedAt: new Date(),
          model: aiConfig.model,
        },
      });
  logAgent(options, "tool:updateSnapshotStatus", {
    snapshotId: snapshot.id,
    status: "running",
  });

  logAgent(options, "tool:getSnapshotContext:start");
  const context = await buildSnapshotContext(prisma, options.chat, embeddingsConfig.model);
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
    const context = await buildSnapshotContext(prisma, options.chat, embeddingsConfig.model);
    const rawSection = await withTimeout(
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
    const section = applyPostCommentSegments(rawSection, context);

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
        segments: section.segments ? section.segments as Prisma.InputJsonValue : undefined,
        completedAt: new Date(),
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
  const context = await buildSnapshotContext(prisma, chat, embeddingsModel);
  const orderedSections = SECTION_ORDER.flatMap((sectionId) => {
    const section = sections.find((candidate) => candidate.sectionId === sectionId);
    return section ? [sectionFromDbRow(section)] : [];
  });
  const signals = buildSnapshotSignals(orderedSections);
  const title = `Снимок по каналу: ${chat.title}`;
  const snapshotDocument: ChannelSnapshotDocument = {
    schemaVersion: CHANNEL_SNAPSHOT_SCHEMA_VERSION,
    snapshotType: "channel",
    title,
    sourceId: chat.id,
    chatTitle: chat.title,
    generatedAt: new Date().toISOString(),
    period: {
      from: context.oldestMessageDate?.toISOString() ?? null,
      to: context.newestMessageDate?.toISOString() ?? null,
    },
    signals,
  };

  await prisma.sourceSnapshot.update({
    where: {
      id: snapshotId,
    },
    data: {
      status: "completed",
      completedAt: new Date(),
      model: aiConfig.model,
      document: {
        ...snapshotDocument,
        embeddingModel: embeddingsModel,
      } satisfies Prisma.InputJsonValue,
    },
  });
  logAgent(options ?? {}, "tool:completeSnapshotIfReady:complete", {
    snapshotId,
  });
}
