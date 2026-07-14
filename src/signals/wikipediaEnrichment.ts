import { createChatCompletionWithTools } from "../ai/chatClient.js";
import type { AiConfig } from "../ai/config.js";
import { openMediaWikiMcpSession } from "../mcp/mediawikiMcpClient.js";
import type { SnapshotExternalContext, SnapshotSignal } from "../snapshots/sourceSnapshotSchema.js";

type EnrichmentAgentOutput = {
  shouldEnrich?: boolean;
  entityName?: string;
  entityType?: SnapshotExternalContext["entityType"];
  summary?: string;
  facts?: Array<{
    claim?: string;
    sourceTitle?: string;
    sourceUrl?: string;
    confidence?: number;
  }>;
  warnings?: string[];
};

const ENRICHABLE_KINDS = new Set<SnapshotSignal["kind"]>([
  "material",
  "tool",
  "place",
  "event",
  "trend",
  "risk",
]);

const ENRICHMENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    shouldEnrich: {
      type: "boolean",
    },
    entityName: {
      type: "string",
    },
    entityType: {
      type: "string",
      enum: ["person", "company", "product", "technology", "book", "place", "event", "concept", "other"],
    },
    summary: {
      type: "string",
    },
    facts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          claim: {
            type: "string",
          },
          sourceTitle: {
            type: "string",
          },
          sourceUrl: {
            type: "string",
          },
          confidence: {
            type: "number",
            minimum: 0,
            maximum: 1,
          },
        },
        required: ["claim", "sourceTitle", "sourceUrl", "confidence"],
      },
    },
    warnings: {
      type: "array",
      items: {
        type: "string",
      },
    },
  },
  required: ["shouldEnrich", "entityName", "entityType", "summary", "facts", "warnings"],
};

function extractJsonObject(content: string) {
  const trimmed = content.trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");

  if (start < 0 || end < start) {
    throw new Error(`Enrichment agent returned non-JSON content: ${content.slice(0, 160)}`);
  }

  return trimmed.slice(start, end + 1);
}

function compact(value: string | undefined, maxLength: number) {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeOutput(output: EnrichmentAgentOutput): SnapshotExternalContext | undefined {
  if (!output.shouldEnrich) {
    return undefined;
  }

  const facts = (output.facts ?? []).flatMap((fact) => {
    const claim = compact(fact.claim, 220);
    const sourceTitle = compact(fact.sourceTitle, 120);
    const sourceUrl = fact.sourceUrl?.trim() ?? "";

    if (!claim || !sourceTitle || !/^https:\/\/en\.wikipedia\.org\//.test(sourceUrl)) {
      return [];
    }

    return [{
      claim,
      sourceTitle,
      sourceUrl,
      retrievedAt: new Date().toISOString(),
      confidence: typeof fact.confidence === "number" ? Math.max(0, Math.min(1, fact.confidence)) : 0.5,
    }];
  }).slice(0, 4);

  if (!facts.length) {
    return undefined;
  }

  return {
    provider: "wikipedia",
    entityName: compact(output.entityName, 120) || facts[0]?.sourceTitle || "Wikipedia",
    entityType: output.entityType ?? "other",
    canonicalUrl: facts[0]?.sourceUrl,
    summary: compact(output.summary, 360) || undefined,
    facts,
    warnings: (output.warnings ?? []).map((warning) => compact(warning, 160)).filter(Boolean).slice(0, 3),
  };
}

export async function enrichSignalWithWikipedia(
  aiConfig: AiConfig,
  signal: SnapshotSignal,
): Promise<SnapshotExternalContext | undefined> {
  if (!ENRICHABLE_KINDS.has(signal.kind)) {
    return undefined;
  }

  const session = await openMediaWikiMcpSession();

  try {
    const content = await createChatCompletionWithTools(aiConfig, [
      {
        role: "system",
        content: [
          "Ты обогащаешь уже найденный Telegram-сигнал внешним контекстом из Wikipedia через MCP tools.",
          "Ты сам решаешь, нужно ли искать внешний контекст, какой запрос сделать и какую страницу раскрыть.",
          "Доступные tools работают только с English Wikipedia. Не проси другие источники.",
          "Не создавай новые сигналы и не меняй смысл Telegram-сигнала.",
          "Используй tools только для уточнения сущности, фактов, дат, определений, масштаба или canonical URL.",
          "Сделай не больше 2 search_pages вызовов и не больше 2 get_page_info/parse_page вызовов.",
          "Добавляй только факты, которые помогают читателю лучше понять уже найденный сигнал.",
          "Если Wikipedia не совпадает с сущностью сигнала или дает бесполезную справку, верни shouldEnrich=false.",
          "Факты должны быть основаны только на результатах MCP tools.",
          "Пиши summary и facts на русском. Не используй Markdown.",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          "Telegram signal:",
          JSON.stringify({
            kind: signal.kind,
            title: signal.title,
            summary: signal.summary,
            tags: signal.tags,
            metrics: signal.metrics,
            url: signal.url,
            evidence: signal.evidence?.slice(0, 5),
          }, null, 2),
        ].join("\n"),
      },
    ], {
      tools: session.tools,
      onToolCall: session.callTool,
      maxToolRounds: Number(process.env.SNAPSHOT_WIKIPEDIA_MCP_MAX_TOOL_ROUNDS || "4"),
      schema: {
        name: "wikipedia_signal_enrichment",
        schema: ENRICHMENT_SCHEMA,
      },
    });

    return normalizeOutput(JSON.parse(extractJsonObject(content)) as EnrichmentAgentOutput);
  } finally {
    await session.close();
  }
}

export async function enrichSignalsWithWikipedia(
  aiConfig: AiConfig,
  signals: SnapshotSignal[],
  onProgress?: (progress: { processed: number; total: number; enriched: number; signalId: string }) => void,
): Promise<SnapshotSignal[]> {
  if (process.env.SNAPSHOT_WIKIPEDIA_ENRICHMENT !== "true") {
    return signals;
  }

  const limit = Number(process.env.SNAPSHOT_WIKIPEDIA_ENRICHMENT_LIMIT || "24");
  const nextSignals: SnapshotSignal[] = [];
  let processed = 0;
  let enriched = 0;

  for (const signal of signals) {
    if (processed >= limit) {
      nextSignals.push(signal);
      continue;
    }

    processed += 1;

    try {
      const externalContext = await enrichSignalWithWikipedia(aiConfig, signal);

      if (externalContext) {
        enriched += 1;
        nextSignals.push({
          ...signal,
          externalContext,
        });
      } else {
        nextSignals.push(signal);
      }
    } catch {
      nextSignals.push(signal);
    }

    onProgress?.({
      processed,
      total: Math.min(signals.length, limit),
      enriched,
      signalId: signal.id,
    });
  }

  return nextSignals;
}
