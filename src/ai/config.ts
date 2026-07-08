export type AiConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

function requiredEnv(name: string, fallback?: string): string {
  const value = process.env[name]?.trim() || fallback?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function loadAiConfig(): AiConfig {
  return {
    baseUrl: requiredEnv("OPENAI_COMPATIBLE_BASE_URL", "https://openrouter.ai/api/v1").replace(/\/$/, ""),
    apiKey: requiredEnv("OPENROUTER_API_KEY"),
    model: requiredEnv("AI_MODEL"),
  };
}
