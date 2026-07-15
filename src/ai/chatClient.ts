import type { AiConfig } from "./config.js";

type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: ChatToolCall[];
};

export type ChatTool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
};

export type ChatToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type ChatToolHandler = (call: ChatToolCall) => Promise<string>;

type ChatCompletionMessage = {
  content?: string | null;
  tool_calls?: ChatToolCall[];
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: ChatCompletionMessage;
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
  allowJsonFallback?: boolean;
  tools?: ChatTool[];
  toolChoice?: "auto" | "none";
  maxToolRounds?: number;
  onToolCall?: ChatToolHandler;
};

class ChatCompletionHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

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

function shouldFallbackFromSchemaError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  if (error instanceof ChatCompletionHttpError && (error.status === 401 || error.status === 403)) {
    return false;
  }

  const message = error.message.toLowerCase();

  if (message.includes("invalid schema")) {
    return false;
  }

  return message.includes("provider returned error") ||
    message.includes("response_format") ||
    message.includes("json_schema") ||
    message.includes("structured output") ||
    message.includes("structured outputs") ||
    message.includes("require_parameters") ||
    message.includes("unsupported parameter") ||
    message.includes("does not support");
}

export async function createChatCompletion(
  config: AiConfig,
  messages: ChatMessage[],
  options: ChatCompletionOptions = {},
): Promise<string> {
  const timeoutMs = Number(process.env.AI_REQUEST_TIMEOUT_MS || "300000");
  const maxAttempts = Number(process.env.AI_REQUEST_MAX_ATTEMPTS || "3");
  const isOpenRouter = config.baseUrl.includes("openrouter.ai");
  const requestVariants = options.schema && options.allowJsonFallback !== false
    ? [options, { json: true } satisfies ChatCompletionOptions]
    : [options];
  let lastError: unknown;

  for (const [variantIndex, requestOptions] of requestVariants.entries()) {
    lastError = undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const useResponseHealing = isOpenRouter &&
          process.env.OPENROUTER_RESPONSE_HEALING !== "false" &&
          (requestOptions.json || requestOptions.schema);
        const requireParameters = isOpenRouter &&
          Boolean(requestOptions.schema) &&
          process.env.OPENROUTER_REQUIRE_PARAMETERS !== "false";

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
            ...(requestOptions.schema
              ? {
                  response_format: {
                    type: "json_schema",
                    json_schema: {
                      name: requestOptions.schema.name,
                      strict: requestOptions.schema.strict ?? true,
                      schema: requestOptions.schema.schema,
                    },
                  },
                }
              : requestOptions.json
                ? { response_format: { type: "json_object" } }
                : {}),
            ...(requestOptions.tools?.length
              ? {
                  tools: requestOptions.tools,
                  tool_choice: requestOptions.toolChoice ?? "auto",
                }
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
          throw new ChatCompletionHttpError(
            json.error?.message || `Source completion failed with HTTP ${response.status}`,
            response.status,
          );
        }

        const content = json.choices?.[0]?.message?.content?.trim();

        if (!content) {
          throw new Error("Source completion returned empty content.");
        }

        return content;
      } catch (error) {
        lastError = error;

        if (attempt >= maxAttempts || !isRetryableError(error)) {
          break;
        }

        await sleep(2000 * attempt);
      }
    }

    const hasFallbackVariant = variantIndex < requestVariants.length - 1;

    if (!hasFallbackVariant || !shouldFallbackFromSchemaError(lastError)) {
      break;
    }
  }

  throw lastError;
}

export async function createChatCompletionWithTools(
  config: AiConfig,
  messages: ChatMessage[],
  options: ChatCompletionOptions & {
    tools: ChatTool[];
    onToolCall: ChatToolHandler;
  },
): Promise<string> {
  const timeoutMs = Number(process.env.AI_REQUEST_TIMEOUT_MS || "300000");
  const maxAttempts = Number(process.env.AI_REQUEST_MAX_ATTEMPTS || "3");
  const maxToolRounds = options.maxToolRounds ?? 4;
  const conversation = [...messages];
  const requestVariants = options.schema && options.allowJsonFallback !== false
    ? [
        options,
        { ...options, schema: undefined, json: true } satisfies ChatCompletionOptions & { tools: ChatTool[]; onToolCall: ChatToolHandler },
        { ...options, schema: undefined, json: false } satisfies ChatCompletionOptions & { tools: ChatTool[]; onToolCall: ChatToolHandler },
      ]
    : [options];
  let lastError: unknown;

  for (let round = 0; round <= maxToolRounds; round += 1) {
    for (const [variantIndex, requestOptions] of requestVariants.entries()) {
      lastError = undefined;

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
              messages: conversation,
              temperature: 0.2,
              tools: requestOptions.tools,
              tool_choice: requestOptions.toolChoice ?? "auto",
              ...(requestOptions.schema
                ? {
                    response_format: {
                      type: "json_schema",
                      json_schema: {
                        name: requestOptions.schema.name,
                        strict: requestOptions.schema.strict ?? true,
                        schema: requestOptions.schema.schema,
                      },
                    },
                  }
                : requestOptions.json
                  ? { response_format: { type: "json_object" } }
                  : {}),
              ...(config.baseUrl.includes("openrouter.ai") && process.env.OPENROUTER_RESPONSE_HEALING !== "false" && (requestOptions.json || requestOptions.schema)
                ? {
                    plugins: [
                      {
                        id: "response-healing",
                      },
                    ],
                  }
                : {}),
            }),
          }), timeoutMs, "Tool completion request");

          const json = await withTimeout(
            response.json() as Promise<ChatCompletionResponse>,
            timeoutMs,
            "Tool completion response body",
          );

          if (!response.ok) {
            throw new ChatCompletionHttpError(
              json.error?.message || `Tool completion failed with HTTP ${response.status}`,
              response.status,
            );
          }

          const message = json.choices?.[0]?.message;

          if (!message) {
            throw new Error("Tool completion returned no message.");
          }

          const toolCalls = message.tool_calls ?? [];

          if (!toolCalls.length) {
            const content = message.content?.trim();

            if (!content) {
              throw new Error("Tool completion returned empty content.");
            }

            return content;
          }

          if (round >= maxToolRounds) {
            throw new Error(`Tool completion exceeded max tool rounds: ${maxToolRounds}.`);
          }

          conversation.push({
            role: "assistant",
            content: message.content ?? null,
            tool_calls: toolCalls,
          });

          for (const toolCall of toolCalls) {
            const result = await options.onToolCall(toolCall);

            conversation.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: result,
            });
          }

          break;
        } catch (error) {
          lastError = error;

          if (attempt < maxAttempts && isRetryableError(error)) {
            await sleep(2000 * attempt);
            continue;
          }

          const hasFallbackVariant = variantIndex < requestVariants.length - 1;

          if (hasFallbackVariant && shouldFallbackFromSchemaError(error)) {
            break;
          }

          throw error;
        }
      }

      const hasFallbackVariant = variantIndex < requestVariants.length - 1;

      if (!hasFallbackVariant || !shouldFallbackFromSchemaError(lastError)) {
        break;
      }
    }
  }

  throw lastError ?? new Error("Tool completion failed.");
}
