import type { AiConfig } from "./config.js";

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
};

type ChatCompletionOptions = {
  json?: boolean;
  schema?: {
    name: string;
    schema: Record<string, unknown>;
    strict?: boolean;
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();

  return message.includes("timeout") ||
    message.includes("aborted") ||
    message.includes("temporarily") ||
    message.includes("rate limit") ||
    message.includes("http 429") ||
    message.includes("http 500") ||
    message.includes("http 502") ||
    message.includes("http 503") ||
    message.includes("http 504");
}

export async function createChatCompletion(
  config: AiConfig,
  messages: ChatMessage[],
  options: ChatCompletionOptions = {},
): Promise<string> {
  const timeoutMs = Number(process.env.AI_REQUEST_TIMEOUT_MS || "300000");
  const maxAttempts = Number(process.env.AI_REQUEST_MAX_ATTEMPTS || "3");
  const isOpenRouter = config.baseUrl.includes("openrouter.ai");
  const useResponseHealing = isOpenRouter && process.env.OPENROUTER_RESPONSE_HEALING !== "false" && (options.json || options.schema);
  const requireParameters = isOpenRouter && Boolean(options.schema) && process.env.OPENROUTER_REQUIRE_PARAMETERS !== "false";
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await withTimeout(fetch(`${config.baseUrl}/chat/completions`, {
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
          messages,
          temperature: 0.2,
          ...(options.schema
            ? {
                response_format: {
                  type: "json_schema",
                  json_schema: {
                    name: options.schema.name,
                    strict: options.schema.strict ?? true,
                    schema: options.schema.schema,
                  },
                },
              }
            : options.json
              ? { response_format: { type: "json_object" } }
              : {}),
          ...(requireParameters
            ? {
                provider: {
                  require_parameters: true,
                },
              }
            : {}),
          ...(useResponseHealing
            ? {
                plugins: [
                  {
                    id: "response-healing",
                  },
                ],
              }
            : {}),
        }),
      }), timeoutMs, "Source completion request");

      const json = await withTimeout(
        response.json() as Promise<ChatCompletionResponse>,
        timeoutMs,
        "Source completion response body",
      );

      if (!response.ok) {
        throw new Error(json.error?.message || `Source completion failed with HTTP ${response.status}`);
      }

      const content = json.choices?.[0]?.message?.content?.trim();

      if (!content) {
        throw new Error("Source completion returned empty content.");
      }

      return content;
    } catch (error) {
      lastError = error;

      if (attempt >= maxAttempts || !isRetryableError(error)) {
        throw error;
      }

      await sleep(2000 * attempt);
    }
  }

  throw lastError;
}
