import { Prisma, type PrismaClient, type SourceSignal, type SnapshotSignal as SnapshotSignalRow } from "@prisma/client";
import type { AiConfig } from "../ai/config.js";
import { createChatCompletion } from "../ai/chatClient.js";
import { SOURCE_SIGNAL_CURATOR_SYSTEM_PROMPT } from "../prompts/sourceSignalCurator.js";

type CuratorDecision =
  | {
      decision: "merge";
      sourceSignalId: string;
      confidence: number;
      reason: string;
      title?: string;
      summary?: string;
      tags?: string[];
    }
  | {
      decision: "create";
      confidence: number;
      reason: string;
      title?: string;
      summary?: string;
      canonicalClaim?: string;
      tags?: string[];
    }
  | {
      decision: "reject";
      confidence: number;
      reason: string;
    };

type SnapshotSignalWithEvidence = SnapshotSignalRow & {
  evidence: Array<{
    id: string;
    contentItemId: string | null;
    itemExternalId: string;
    quote: string | null;
    reason: string | null;
  }>;
};

const candidateLimit = Number(process.env.SIGNAL_CURATOR_CANDIDATE_LIMIT || "8");

const CURATOR_DECISION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    decision: {
      type: "string",
      enum: ["merge", "create", "reject"],
    },
    sourceSignalId: {
      type: "string",
      description: "Required when decision is merge; empty string otherwise.",
    },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
    },
    reason: {
      type: "string",
    },
    title: {
      type: "string",
    },
    summary: {
      type: "string",
    },
    canonicalClaim: {
      type: "string",
    },
    tags: {
      type: "array",
      items: {
        type: "string",
      },
    },
  },
  required: ["decision", "sourceSignalId", "confidence", "reason", "title", "summary", "canonicalClaim", "tags"],
};

function extractJsonObject(content: string) {
  const trimmed = content.trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");

  if (start < 0 || end < start) {
    throw new Error(`Curator returned non-JSON content: ${content.slice(0, 160)}`);
  }

  return trimmed.slice(start, end + 1);
}

function parseDecision(content: string): CuratorDecision {
  const parsed = JSON.parse(extractJsonObject(content)) as Record<string, unknown>;

  if (parsed.decision === "merge" && typeof parsed.sourceSignalId === "string") {
    return {
      decision: "merge",
      sourceSignalId: parsed.sourceSignalId,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.7,
      reason: typeof parsed.reason === "string" ? parsed.reason : "Semantic merge",
      title: typeof parsed.title === "string" ? parsed.title : undefined,
      summary: typeof parsed.summary === "string" ? parsed.summary : undefined,
      tags: Array.isArray(parsed.tags) ? parsed.tags.filter((tag): tag is string => typeof tag === "string") : undefined,
    };
  }

  if (parsed.decision === "reject") {
    return {
      decision: "reject",
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.7,
      reason: typeof parsed.reason === "string" ? parsed.reason : "Rejected by curator",
    };
  }

  return {
    decision: "create",
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.7,
    reason: typeof parsed.reason === "string" ? parsed.reason : "New source signal",
    title: typeof parsed.title === "string" ? parsed.title : undefined,
    summary: typeof parsed.summary === "string" ? parsed.summary : undefined,
    canonicalClaim: typeof parsed.canonicalClaim === "string" ? parsed.canonicalClaim : undefined,
    tags: Array.isArray(parsed.tags) ? parsed.tags.filter((tag): tag is string => typeof tag === "string") : undefined,
  };
}

function textTokens(value: string) {
  return new Set(value.toLowerCase().split(/[^a-zа-яё0-9]+/iu).filter((token) => token.length >= 3));
}

function lexicalSimilarity(a: string, b: string) {
  const left = textTokens(a);
  const right = textTokens(b);

  if (!left.size || !right.size) {
    return 0;
  }

  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) {
      intersection += 1;
    }
  }

  return intersection / Math.sqrt(left.size * right.size);
}

function jsonStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function uniqueTags(...tagGroups: Array<string[] | undefined>) {
  return [...new Set(tagGroups.flatMap((tags) => tags ?? []).map((tag) => tag.trim()).filter(Boolean))].slice(0, 10);
}

function jsonObjectValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function hasPreviewImage(value: unknown) {
  return Boolean(jsonObjectValue(value) && typeof (value as { url?: unknown }).url === "string");
}

function signalText(signal: Pick<SnapshotSignalRow | SourceSignal, "title" | "summary" | "canonicalClaim" | "kind">) {
  return [signal.kind, signal.title, signal.summary, signal.canonicalClaim].filter(Boolean).join("\n");
}

function minDate(...values: Array<Date | null | undefined>) {
  const dates = values.filter((value): value is Date => Boolean(value));

  return dates.length ? new Date(Math.min(...dates.map((value) => value.getTime()))) : undefined;
}

function maxDate(...values: Array<Date | null | undefined>) {
  const dates = values.filter((value): value is Date => Boolean(value));

  return dates.length ? new Date(Math.max(...dates.map((value) => value.getTime()))) : undefined;
}

async function candidateSourceSignals(prisma: PrismaClient, signal: SnapshotSignalRow) {
  const candidates = await prisma.sourceSignal.findMany({
    where: {
      sourceId: signal.sourceId,
      kind: signal.kind,
      status: {
        not: "archived",
      },
    },
    include: {
      _count: {
        select: {
          evidence: true,
          snapshotSignals: true,
        },
      },
    },
    orderBy: {
      updatedAt: "desc",
    },
    take: 200,
  });
  const exact = signal.fingerprint
    ? candidates.find((candidate) => candidate.fingerprint === signal.fingerprint)
    : null;
  const scored = candidates
    .map((candidate) => ({
      candidate,
      score: exact?.id === candidate.id ? 1 : lexicalSimilarity(signalText(signal), signalText(candidate)),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, candidateLimit);

  return scored.map((item) => item.candidate);
}

async function decideSignal(
  aiConfig: AiConfig,
  snapshotSignal: SnapshotSignalWithEvidence,
  candidates: Awaited<ReturnType<typeof candidateSourceSignals>>,
): Promise<CuratorDecision> {
  const exactCandidate = snapshotSignal.fingerprint
    ? candidates.find((candidate) => candidate.fingerprint === snapshotSignal.fingerprint)
    : null;

  if (exactCandidate) {
    return {
      decision: "merge",
      sourceSignalId: exactCandidate.id,
      confidence: 1,
      reason: "Exact fingerprint match",
      title: snapshotSignal.title,
      summary: snapshotSignal.summary,
      tags: uniqueTags(jsonStringArray(exactCandidate.tags), jsonStringArray(snapshotSignal.tags)),
    };
  }

  if (!candidates.length) {
    return {
      decision: "create",
      confidence: 0.95,
      reason: "No source signal candidates for this kind",
      title: snapshotSignal.title,
      summary: snapshotSignal.summary,
      canonicalClaim: snapshotSignal.canonicalClaim ?? undefined,
      tags: jsonStringArray(snapshotSignal.tags),
    };
  }

  const content = await createChatCompletion(aiConfig, [
    {
      role: "system",
      content: SOURCE_SIGNAL_CURATOR_SYSTEM_PROMPT,
    },
    {
      role: "user",
      content: JSON.stringify({
        snapshotSignal: {
          id: snapshotSignal.id,
          kind: snapshotSignal.kind,
          title: snapshotSignal.title,
          summary: snapshotSignal.summary,
          canonicalClaim: snapshotSignal.canonicalClaim,
          tags: jsonStringArray(snapshotSignal.tags),
          confidence: snapshotSignal.confidence,
          evidence: snapshotSignal.evidence.slice(0, 6).map((item) => ({
            itemExternalId: item.itemExternalId,
            quote: item.quote,
            reason: item.reason,
          })),
        },
        sourceSignalCandidates: candidates.map((candidate) => ({
          id: candidate.id,
          kind: candidate.kind,
          title: candidate.title,
          summary: candidate.summary,
          canonicalClaim: candidate.canonicalClaim,
          tags: jsonStringArray(candidate.tags),
        })),
      }, null, 2),
    },
  ], {
    schema: {
      name: "source_signal_curator_decision",
      schema: CURATOR_DECISION_SCHEMA,
    },
  });

  const decision = parseDecision(content);

  if (decision.decision === "merge" && !candidates.some((candidate) => candidate.id === decision.sourceSignalId)) {
    return {
      decision: "create",
      confidence: 0.65,
      reason: `Curator suggested an unknown sourceSignalId; creating instead. Original reason: ${decision.reason}`,
      title: snapshotSignal.title,
      summary: snapshotSignal.summary,
      canonicalClaim: snapshotSignal.canonicalClaim ?? undefined,
      tags: jsonStringArray(snapshotSignal.tags),
    };
  }

  return decision;
}

async function applyDecision(
  prisma: PrismaClient,
  snapshotSignal: SnapshotSignalWithEvidence,
  decision: CuratorDecision,
) {
  if (decision.decision === "reject") {
    await prisma.snapshotSignal.update({
      where: {
        id: snapshotSignal.id,
      },
      data: {
        status: "rejected",
        resolution: decision satisfies Prisma.InputJsonValue,
      },
    });

    return {
      created: 0,
      merged: 0,
      rejected: 1,
      evidence: 0,
    };
  }

  return prisma.$transaction(async (tx) => {
    const currentSnapshotSignal = await tx.snapshotSignal.findUnique({
      where: {
        id: snapshotSignal.id,
      },
      select: {
        previewImage: true,
      },
    });
    const snapshotPreviewImage = jsonObjectValue(currentSnapshotSignal?.previewImage) ??
      jsonObjectValue(snapshotSignal.previewImage);
    const existingSourceSignal = decision.decision === "merge"
      ? await tx.sourceSignal.findUnique({
          where: {
            id: decision.sourceSignalId,
          },
          select: {
            firstEvidenceAt: true,
            lastEvidenceAt: true,
            tags: true,
            previewImage: true,
          },
        })
      : null;
    const sourceSignal = decision.decision === "merge"
      ? await tx.sourceSignal.update({
          where: {
            id: decision.sourceSignalId,
          },
          data: {
            title: decision.title || snapshotSignal.title,
            summary: decision.summary || snapshotSignal.summary,
            tags: uniqueTags(jsonStringArray(existingSourceSignal?.tags), jsonStringArray(snapshotSignal.tags), decision.tags) satisfies Prisma.InputJsonValue,
            confidence: decision.confidence,
            previewImage: !hasPreviewImage(existingSourceSignal?.previewImage) && snapshotPreviewImage
              ? snapshotPreviewImage as Prisma.InputJsonValue
              : undefined,
            firstEvidenceAt: minDate(existingSourceSignal?.firstEvidenceAt, snapshotSignal.sortAt),
            lastEvidenceAt: maxDate(existingSourceSignal?.lastEvidenceAt, snapshotSignal.sortAt),
          },
        })
      : await tx.sourceSignal.create({
          data: {
            sourceId: snapshotSignal.sourceId,
            kind: snapshotSignal.kind,
            title: decision.title || snapshotSignal.title,
            summary: decision.summary || snapshotSignal.summary,
            canonicalClaim: decision.canonicalClaim || snapshotSignal.canonicalClaim || `${snapshotSignal.title}. ${snapshotSignal.summary}`,
            fingerprint: snapshotSignal.fingerprint || snapshotSignal.id,
            tags: uniqueTags(jsonStringArray(snapshotSignal.tags), decision.tags) satisfies Prisma.InputJsonValue,
            confidence: decision.confidence,
            previewImage: snapshotPreviewImage ? snapshotPreviewImage as Prisma.InputJsonValue : Prisma.JsonNull,
            firstEvidenceAt: snapshotSignal.sortAt,
            lastEvidenceAt: snapshotSignal.sortAt,
            metadata: {
              firstSnapshotId: snapshotSignal.snapshotId,
              firstSnapshotSignalId: snapshotSignal.id,
              curatorReason: decision.reason,
            },
          },
        });
    let evidence = 0;

    for (const item of snapshotSignal.evidence) {
      await tx.sourceSignalEvidence.upsert({
        where: {
          sourceSignalId_itemExternalId: {
            sourceSignalId: sourceSignal.id,
            itemExternalId: item.itemExternalId,
          },
        },
        create: {
          sourceSignalId: sourceSignal.id,
          contentItemId: item.contentItemId,
          snapshotSignalId: snapshotSignal.id,
          itemExternalId: item.itemExternalId,
          quote: item.quote,
          reason: item.reason,
          confidence: snapshotSignal.confidence,
          firstSeenSnapshotId: snapshotSignal.snapshotId,
        },
        update: {
          contentItemId: item.contentItemId,
          snapshotSignalId: snapshotSignal.id,
          quote: item.quote,
          reason: item.reason,
          confidence: snapshotSignal.confidence,
        },
      });
      evidence += 1;
    }

    await tx.snapshotSignal.update({
      where: {
        id: snapshotSignal.id,
      },
      data: {
        status: decision.decision === "merge" ? "merged" : "promoted",
        sourceSignalId: sourceSignal.id,
        resolution: {
          ...decision,
          sourceSignalId: sourceSignal.id,
        } satisfies Prisma.InputJsonValue,
      },
    });

    return {
      created: decision.decision === "create" ? 1 : 0,
      merged: decision.decision === "merge" ? 1 : 0,
      rejected: 0,
      evidence,
    };
  });
}

export async function curateSnapshotSignalsIntoSource(
  prisma: PrismaClient,
  aiConfig: AiConfig,
  snapshotId: string,
  options: {
    limit?: number;
    onProgress?: (progress: { processed: number; total: number; signalId: string; decision: CuratorDecision["decision"] }) => void;
  } = {},
) {
  const snapshotSignals = await prisma.snapshotSignal.findMany({
    where: {
      snapshotId,
      status: "pending",
      canonicalClaim: {
        not: null,
      },
    },
    include: {
      evidence: true,
    },
    orderBy: [
      {
        sortAt: "desc",
      },
      {
        createdAt: "asc",
      },
    ],
    take: options.limit,
  });
  const totals = {
    snapshotId,
    processed: 0,
    created: 0,
    merged: 0,
    rejected: 0,
    evidence: 0,
  };

  for (const snapshotSignal of snapshotSignals) {
    const candidates = await candidateSourceSignals(prisma, snapshotSignal);
    const decision = await decideSignal(aiConfig, snapshotSignal, candidates);
    const result = await applyDecision(prisma, snapshotSignal, decision);

    totals.processed += 1;
    totals.created += result.created;
    totals.merged += result.merged;
    totals.rejected += result.rejected;
    totals.evidence += result.evidence;
    options.onProgress?.({
      processed: totals.processed,
      total: snapshotSignals.length,
      signalId: snapshotSignal.externalSignalId,
      decision: decision.decision,
    });
  }

  return totals;
}
