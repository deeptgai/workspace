import { createHash } from "node:crypto";

export type StoredObject = {
  bucket: string;
  key: string;
  url: string;
  contentType: string;
  sizeBytes: number;
};

export type ObjectStorageConfig = {
  endpoint: string;
  bucket: string;
  publicBasePath: string;
};

function requiredEnv(name: string, fallback?: string) {
  const value = process.env[name]?.trim() || fallback;

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}.`);
  }

  return value;
}

export function objectStorageConfig(): ObjectStorageConfig {
  return {
    endpoint: requiredEnv("OBJECT_STORAGE_ENDPOINT", "http://localhost:8333").replace(/\/+$/, ""),
    bucket: requiredEnv("OBJECT_STORAGE_BUCKET", "deeptg-previews"),
    publicBasePath: requiredEnv("OBJECT_STORAGE_PUBLIC_BASE_PATH", "/media").replace(/\/+$/, ""),
  };
}

function encodeObjectPath(bucket: string, key = "") {
  const bucketPath = encodeURIComponent(bucket);
  const keyPath = key.split("/").map((part) => encodeURIComponent(part)).join("/");

  return key ? `${bucketPath}/${keyPath}` : bucketPath;
}

function objectEndpoint(config: ObjectStorageConfig, bucket: string, key = "") {
  return `${config.endpoint}/${encodeObjectPath(bucket, key)}`;
}

export function publicObjectUrl(config: ObjectStorageConfig, bucket: string, key: string) {
  return `${config.publicBasePath}/${encodeObjectPath(bucket, key)}`;
}

export function stableObjectKey(parts: string[], extension: string, prefix = "signal-previews") {
  const hash = createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 20);
  const cleanExtension = extension.replace(/^\.+/, "") || "bin";

  return `${prefix}/${parts[0]}/${hash}.${cleanExtension}`;
}

export async function createBucketIfMissing(config = objectStorageConfig()) {
  const response = await fetch(objectEndpoint(config, config.bucket), {
    method: "PUT",
  });

  if (!response.ok && response.status !== 409) {
    throw new Error(`Cannot create object storage bucket ${config.bucket}: ${response.status} ${await response.text()}`);
  }

  return config.bucket;
}

export async function putObject(
  key: string,
  body: Uint8Array,
  contentType: string,
  config = objectStorageConfig(),
): Promise<StoredObject> {
  const response = await fetch(objectEndpoint(config, config.bucket, key), {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(body.byteLength),
    },
    body: Buffer.from(body),
  });

  if (!response.ok) {
    throw new Error(`Cannot put object ${config.bucket}/${key}: ${response.status} ${await response.text()}`);
  }

  return {
    bucket: config.bucket,
    key,
    url: publicObjectUrl(config, config.bucket, key),
    contentType,
    sizeBytes: body.byteLength,
  };
}

export async function getObject(bucket: string, key: string, config = objectStorageConfig()) {
  const response = await fetch(objectEndpoint(config, bucket, key));

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Cannot get object ${bucket}/${key}: ${response.status} ${await response.text()}`);
  }

  return response;
}
