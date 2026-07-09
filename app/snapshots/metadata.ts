import type { Metadata } from "next";
import type { ChannelSnapshotDocument, SnapshotSignal } from "../../src/snapshots/sourceSnapshotSchema";

const defaultDescription = "Карта идей, болей, инсайтов, материалов, мест и людей по источнику.";

function siteUrl() {
  const configuredUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.SITE_URL ||
    (process.env.DOMAIN ? `https://${process.env.DOMAIN}` : undefined) ||
    "https://tgdeep.xyz";

  return configuredUrl.replace(/\/+$/, "");
}

function absoluteUrl(url: string | undefined) {
  if (!url) {
    return undefined;
  }

  if (/^https?:\/\//i.test(url)) {
    return url;
  }

  return `${siteUrl()}${url.startsWith("/") ? "" : "/"}${url}`;
}

function imageMeta(url: string | undefined) {
  const absoluteImageUrl = absoluteUrl(url);
  return absoluteImageUrl ? [{ url: absoluteImageUrl }] : undefined;
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
