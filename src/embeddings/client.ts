import type { EmbeddingsConfig } from "./config.js";

type EmbeddingsResponse = {
  data?: Array<{
    index?: number;
    embedding?: number[];
  }>;
  error?: {
    message?: string;
  };
};

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<T>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

export async function createEmbeddings(
  config: EmbeddingsConfig,
  input: string[],
): Promise<number[][]> {
  if (input.length === 0) {
    return [];
  }

  const timeoutMs = Number(process.env.EMBEDDINGS_REQUEST_TIMEOUT_MS || "60000");
  const response = await withTimeout(fetch(`${config.baseUrl}/embeddings`, {
    method: "POST",
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      "Authorization": `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      ...(process.env.OPENROUTER_HTTP_REFERER
        ? { "HTTP-Referer": process.env.OPENROUTER_HTTP_REFERER }
        : {}),
      ...(process.env.OPENROUTER_APP_TITLE
        ? { "X-Title": process.env.OPENROUTER_APP_TITLE }
        : {}),
    },
    body: JSON.stringify({
      model: config.model,
      input,
    }),
  }), timeoutMs, "Embeddings request");

  const json = await withTimeout(
    response.json() as Promise<EmbeddingsResponse>,
    timeoutMs,
    "Embeddings response body",
  );

  if (!response.ok) {
    throw new Error(json.error?.message || `Embeddings request failed with HTTP ${response.status}`);
  }

  const embeddings = json.data
    ?.sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((item) => item.embedding)
    .filter((embedding): embedding is number[] => Array.isArray(embedding));

  if (!embeddings || embeddings.length !== input.length) {
    throw new Error(`Embeddings response size mismatch. Expected ${input.length}, got ${embeddings?.length ?? 0}.`);
  }

  return embeddings;
}
