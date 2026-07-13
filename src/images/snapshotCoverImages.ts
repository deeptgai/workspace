import { Prisma, type PrismaClient } from "@prisma/client";
import type { SnapshotGeneratedImage } from "../snapshots/sourceSnapshotSchema.js";
import { putObject, stableObjectKey } from "../storage/objectStorage.js";
import { buildSnapshotReadModel } from "../signals/snapshotReadModel.js";
import { generateSnapshotCoverImage } from "./falSnapshotCover.js";

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

  if (!snapshot) {
    throw new Error(`Snapshot not found: ${snapshotId}`);
  }

  const existingCoverImage = snapshot.coverImage &&
    typeof snapshot.coverImage === "object" &&
    !Array.isArray(snapshot.coverImage) &&
    typeof snapshot.coverImage.url === "string"
    ? snapshot.coverImage
    : undefined;

  if (skipExisting && existingCoverImage?.url) {
    return {
      status: "skipped",
      snapshotId,
      title: snapshot.title,
      reason: "already_exists",
    };
  }

  const document = await buildSnapshotReadModel(prisma, snapshot);

  if (!document) {
    throw new Error(`Snapshot signals not found while generating cover image: ${snapshotId}`);
  }

  const coverImage = await generateSnapshotCoverImage(document);
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

  await prisma.sourceSnapshot.update({
    where: {
      id: snapshotId,
    },
    data: {
      coverImage: storedCoverImage as Prisma.InputJsonValue,
    },
  });

  return {
    status: "generated",
    snapshotId,
    title: snapshot.title,
    coverImage: storedCoverImage,
  };
}
