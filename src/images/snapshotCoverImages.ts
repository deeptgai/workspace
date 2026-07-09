import { Prisma, type PrismaClient } from "@prisma/client";
import { isChannelSnapshotDocument, type SnapshotGeneratedImage } from "../snapshots/sourceSnapshotSchema.js";
import { putObject, stableObjectKey } from "../storage/objectStorage.js";
import { generateSnapshotCoverImage } from "./falSnapshotCover.js";
import { withSnapshotDocumentUpdateLock } from "./snapshotDocumentUpdateLock.js";

export type SnapshotCoverImageResult =
  | {
      status: "generated";
      snapshotId: string;
      title: string;
      coverImage: SnapshotGeneratedImage;
    }
  | {
      status: "skipped";
      snapshotId: string;
      title: string;
      reason: "already_exists";
    };

type GenerateAndStoreSnapshotCoverOptions = {
  skipExisting?: boolean;
};

export async function generateAndStoreSnapshotCoverImage(
  prisma: PrismaClient,
  snapshotId: string,
  options: GenerateAndStoreSnapshotCoverOptions = {},
): Promise<SnapshotCoverImageResult> {
  const skipExisting = options.skipExisting ?? true;
  const snapshot = await prisma.sourceSnapshot.findUnique({
    where: {
      id: snapshotId,
    },
  });

  if (!snapshot || !isChannelSnapshotDocument(snapshot.document)) {
    throw new Error(`Snapshot document not found or not completed: ${snapshotId}`);
  }

  if (skipExisting && snapshot.document.coverImage?.url) {
    return {
      status: "skipped",
      snapshotId,
      title: snapshot.title,
      reason: "already_exists",
    };
  }

  const coverImage = await generateSnapshotCoverImage(snapshot.document);
  const falImageResponse = await fetch(coverImage.url);

  if (!falImageResponse.ok) {
    throw new Error(`Cannot download fal image ${coverImage.url}: ${falImageResponse.status} ${await falImageResponse.text()}`);
  }

  const contentType = falImageResponse.headers.get("content-type") || coverImage.contentType || "image/jpeg";
  const extension = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
  const imageBytes = new Uint8Array(await falImageResponse.arrayBuffer());
  const objectKey = stableObjectKey([snapshot.id, "cover", coverImage.requestId ?? Date.now().toString()], extension, "snapshot-covers");
  const storedObject = await putObject(objectKey, imageBytes, contentType);
  const storedCoverImage: SnapshotGeneratedImage = {
    ...coverImage,
    url: storedObject.url,
    sourceUrl: coverImage.url,
    storageProvider: "s3",
    bucket: storedObject.bucket,
    objectKey: storedObject.key,
    sizeBytes: storedObject.sizeBytes,
    contentType: storedObject.contentType,
  };

  await withSnapshotDocumentUpdateLock(snapshotId, async () => {
    const latestSnapshot = await prisma.sourceSnapshot.findUnique({
      where: {
        id: snapshotId,
      },
      select: {
        document: true,
      },
    });

    if (!latestSnapshot || !isChannelSnapshotDocument(latestSnapshot.document)) {
      throw new Error(`Snapshot document not found while saving cover image: ${snapshotId}`);
    }

    await prisma.sourceSnapshot.update({
      where: {
        id: snapshotId,
      },
      data: {
        document: {
          ...latestSnapshot.document,
          coverImage: storedCoverImage,
        } as Prisma.InputJsonValue,
      },
    });
  });

  return {
    status: "generated",
    snapshotId,
    title: snapshot.title,
    coverImage: storedCoverImage,
  };
}
