export type EmbeddingsConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  batchSize: number;
};

function requiredEnv(name: string, fallback?: string): string {
  const value = process.env[name]?.trim() || fallback?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

export function loadEmbeddingsConfig(): EmbeddingsConfig {
  const batchSize = Number(process.env.EMBEDDINGS_BATCH_SIZE || "50");

  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error("EMBEDDINGS_BATCH_SIZE must be a positive integer.");
  }

  return {
    baseUrl: requiredEnv("EMBEDDINGS_BASE_URL", "https://openrouter.ai/api/v1").replace(/\/$/, ""),
    apiKey: requiredEnv("EMBEDDINGS_API_KEY", optionalEnv("OPENROUTER_API_KEY")),
    model: requiredEnv("EMBEDDINGS_MODEL"),
    batchSize,
  };
}
