import { getObject } from "../../../../src/storage/objectStorage";

type RouteContext = {
  params: Promise<{
    bucket: string;
    key: string[];
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { bucket, key } = await context.params;
  const objectKey = key.join("/");
  const object = await getObject(bucket, objectKey);

  if (!object) {
    return new Response("Not found", {
      status: 404,
    });
  }

  const headers = new Headers({
    "Cache-Control": "public, max-age=31536000, immutable",
    "Content-Type": object.headers.get("content-type") || "application/octet-stream",
  });
  const contentLength = object.headers.get("content-length");

  if (contentLength) {
    headers.set("Content-Length", contentLength);
  }

  return new Response(object.body, {
    headers,
  });
}
