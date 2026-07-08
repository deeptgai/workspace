import { Prisma, type PrismaClient } from "@prisma/client";
import { putObject, stableObjectKey } from "../storage/objectStorage.js";
import { isChannelSnapshotDocument, type SnapshotSignal, type SnapshotSignalPreviewImage } from "../snapshots/sourceSnapshotSchema.js";
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

const snapshotUpdateLocks = new Map<string, Promise<void>>();

async function withSnapshotUpdateLock<T>(snapshotId: string, action: () => Promise<T>) {
  const previous = snapshotUpdateLocks.get(snapshotId) ?? Promise.resolve();
  let release!: () => void;
  const currentLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  const current = previous.catch(() => undefined).then(() => currentLock);

  snapshotUpdateLocks.set(snapshotId, current);
  await previous.catch(() => undefined);

  try {
    return await action();
  } finally {
    release();

    if (snapshotUpdateLocks.get(snapshotId) === current) {
      snapshotUpdateLocks.delete(snapshotId);
    }
  }
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
    },
  });

  if (!snapshot || !isChannelSnapshotDocument(snapshot.document)) {
    throw new Error(`Snapshot document not found or not completed: ${snapshotId}`);
  }

  const signal = snapshot.document.signals.find((item) => item.id === signalId);

  if (!signal) {
    throw new Error(`Signal not found in snapshot ${snapshotId}: ${signalId}`);
  }

  if (skipExisting && signal.previewImage?.url) {
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

  await withSnapshotUpdateLock(snapshotId, async () => {
    const latestSnapshot = await prisma.sourceSnapshot.findUnique({
      where: {
        id: snapshotId,
      },
      select: {
        document: true,
      },
    });

    if (!latestSnapshot || !isChannelSnapshotDocument(latestSnapshot.document)) {
      throw new Error(`Snapshot document not found while saving signal image: ${snapshotId}`);
    }

    const updatedDocument = {
      ...latestSnapshot.document,
      signals: latestSnapshot.document.signals.map((item) => item.id === signalId
        ? {
            ...item,
            previewImage: storedPreviewImage,
          }
        : item),
    };

    await prisma.sourceSnapshot.update({
      where: {
        id: snapshotId,
      },
      data: {
        document: updatedDocument as Prisma.InputJsonValue,
      },
    });
  });

  return {
    status: "generated",
    snapshotId,
    signalId,
    kind: signal.kind,
    title: signal.title,
    previewImage: storedPreviewImage,
  };
}
