import { Prisma, type PrismaClient } from "@prisma/client";
import { putObject, stableObjectKey } from "../storage/objectStorage.js";
import type { SnapshotSignal, SnapshotSignalPreviewImage } from "../snapshots/sourceSnapshotSchema.js";
import { canGenerateSignalPreview, generateSignalPreviewImage } from "./falSignalPreview.js";

export type SignalPreviewImageResult =
  | {
      status: "generated";
      snapshotId: string;
      signalId: string;
      kind: SnapshotSignal["kind"];
      title: string;
      previewImage: SnapshotSignalPreviewImage;
    }
  | {
      status: "skipped";
      snapshotId: string;
      signalId: string;
      kind: SnapshotSignal["kind"];
      title: string;
      reason: "already_exists" | "unsupported_kind";
    };

type GenerateAndStoreSignalPreviewOptions = {
  skipExisting?: boolean;
};

function hasPreviewImage(value: unknown) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && typeof (value as { url?: unknown }).url === "string");
}

async function fillMissingSourcePreviewImage(
  prisma: PrismaClient,
  sourceSignalId: string | null,
  previewImage: SnapshotSignalPreviewImage,
) {
  if (!sourceSignalId) {
    return;
  }

  const sourceSignal = await prisma.sourceSignal.findUnique({
    where: {
      id: sourceSignalId,
    },
    select: {
      previewImage: true,
    },
  });

  if (hasPreviewImage(sourceSignal?.previewImage)) {
    return;
  }

  await prisma.sourceSignal.update({
    where: {
      id: sourceSignalId,
    },
    data: {
      previewImage: previewImage as Prisma.InputJsonValue,
    },
  });
}

export async function generateAndStoreSignalPreviewImage(
  prisma: PrismaClient,
  snapshotId: string,
  signalId: string,
  options: GenerateAndStoreSignalPreviewOptions = {},
): Promise<SignalPreviewImageResult> {
  const skipExisting = options.skipExisting ?? true;
  const snapshot = await prisma.sourceSnapshot.findUnique({
    where: {
      id: snapshotId,
    },
    include: {
      source: true,
      signals: {
        where: {
          externalSignalId: signalId,
        },
        take: 1,
      },
    },
  });

  if (!snapshot) {
    throw new Error(`Snapshot not found: ${snapshotId}`);
  }

  const tableSignal = snapshot.signals[0] ?? null;
  const signal = tableSignal
    ? {
        id: tableSignal.externalSignalId,
        kind: tableSignal.kind as SnapshotSignal["kind"],
        title: tableSignal.title,
        summary: tableSignal.summary,
        tags: Array.isArray(tableSignal.tags) ? tableSignal.tags.filter((tag): tag is string => typeof tag === "string") : [],
        priority: tableSignal.priority as SnapshotSignal["priority"],
        score: tableSignal.score ?? undefined,
        confidence: tableSignal.confidence ?? undefined,
        metrics: Array.isArray(tableSignal.metrics) ? tableSignal.metrics as SnapshotSignal["metrics"] : undefined,
        evidence: [],
        url: tableSignal.url ?? undefined,
        person: tableSignal.person && typeof tableSignal.person === "object" && !Array.isArray(tableSignal.person)
          ? tableSignal.person as SnapshotSignal["person"]
          : undefined,
        previewImage: tableSignal.previewImage && typeof tableSignal.previewImage === "object" && !Array.isArray(tableSignal.previewImage)
          ? tableSignal.previewImage as SnapshotSignal["previewImage"]
          : undefined,
        timeline: tableSignal.timeline && typeof tableSignal.timeline === "object" && !Array.isArray(tableSignal.timeline)
          ? tableSignal.timeline as SnapshotSignal["timeline"]
          : undefined,
        externalContext: tableSignal.externalContext && typeof tableSignal.externalContext === "object" && !Array.isArray(tableSignal.externalContext)
          ? tableSignal.externalContext as SnapshotSignal["externalContext"]
          : undefined,
      } satisfies SnapshotSignal
    : null;

  if (!signal) {
    throw new Error(`Signal not found in snapshot ${snapshotId}: ${signalId}`);
  }

  const existingPreviewImage = tableSignal?.previewImage &&
    typeof tableSignal.previewImage === "object" &&
    !Array.isArray(tableSignal.previewImage) &&
    typeof tableSignal.previewImage.url === "string"
    ? tableSignal.previewImage
    : undefined;

  if (skipExisting && existingPreviewImage?.url) {
    await fillMissingSourcePreviewImage(prisma, tableSignal.sourceSignalId, existingPreviewImage as SnapshotSignalPreviewImage);

    return {
      status: "skipped",
      snapshotId,
      signalId,
      kind: signal.kind,
      title: signal.title,
      reason: "already_exists",
    };
  }

  if (!canGenerateSignalPreview(signal)) {
    return {
      status: "skipped",
      snapshotId,
      signalId,
      kind: signal.kind,
      title: signal.title,
      reason: "unsupported_kind",
    };
  }

  const previewImage = await generateSignalPreviewImage(signal, {
    chatTitle: snapshot.source.title,
  });
  const falImageResponse = await fetch(previewImage.url);

  if (!falImageResponse.ok) {
    throw new Error(`Cannot download fal image ${previewImage.url}: ${falImageResponse.status} ${await falImageResponse.text()}`);
  }

  const contentType = falImageResponse.headers.get("content-type") || previewImage.contentType || "image/jpeg";
  const extension = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
  const imageBytes = new Uint8Array(await falImageResponse.arrayBuffer());
  const objectKey = stableObjectKey([snapshotId, signal.id, previewImage.requestId ?? Date.now().toString()], extension);
  const storedObject = await putObject(objectKey, imageBytes, contentType);
  const storedPreviewImage: SnapshotSignalPreviewImage = {
    ...previewImage,
    url: storedObject.url,
    sourceUrl: previewImage.url,
    storageProvider: "s3",
    bucket: storedObject.bucket,
    objectKey: storedObject.key,
    sizeBytes: storedObject.sizeBytes,
    contentType: storedObject.contentType,
  };

  await prisma.snapshotSignal.update({
    where: {
      id: tableSignal.id,
    },
    data: {
      previewImage: storedPreviewImage as Prisma.InputJsonValue,
    },
  });

  await fillMissingSourcePreviewImage(prisma, tableSignal.sourceSignalId, storedPreviewImage);

  return {
    status: "generated",
    snapshotId,
    signalId,
    kind: signal.kind,
    title: signal.title,
    previewImage: storedPreviewImage,
  };
}
