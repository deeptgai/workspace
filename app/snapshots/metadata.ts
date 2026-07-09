import type { Metadata } from "next";
import type { ChannelSnapshotDocument, SnapshotSignal } from "../../src/snapshots/sourceSnapshotSchema";

const defaultDescription = "Карта идей, болей, инсайтов, материалов, мест и людей по источнику.";

function imageMeta(url: string | undefined) {
  return url ? [{ url }] : undefined;
}

export function snapshotMetadata(params: {
  title: string;
  description?: string;
  document?: ChannelSnapshotDocument | null;
}): Metadata {
  const description = params.description || defaultDescription;
  const images = imageMeta(params.document?.coverImage?.url);

  return {
    title: params.title,
    description,
    openGraph: {
      title: params.title,
      description,
      type: "article",
      images,
    },
    twitter: {
      card: images ? "summary_large_image" : "summary",
      title: params.title,
      description,
      images: images?.map((image) => image.url),
    },
    robots: {
      index: true,
      follow: true,
    },
  };
}

export function signalMetadata(params: {
  title: string;
  description?: string;
  document?: ChannelSnapshotDocument | null;
  signal?: SnapshotSignal | null;
}): Metadata {
  const description = params.description || defaultDescription;
  const images = imageMeta(params.signal?.previewImage?.url || params.document?.coverImage?.url);

  return {
    title: params.title,
    description,
    openGraph: {
      title: params.title,
      description,
      type: "article",
      images,
    },
    twitter: {
      card: images ? "summary_large_image" : "summary",
      title: params.title,
      description,
      images: images?.map((image) => image.url),
    },
    robots: {
      index: true,
      follow: true,
    },
  };
}
