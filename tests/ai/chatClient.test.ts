import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createChatCompletion, createChatCompletionWithTools } from "../../src/ai/chatClient.ts";

type FetchCall = {
  url: string;
  init: RequestInit;
  body: Record<string, unknown>;
};

const config = {
  apiKey: "test-key",
  baseUrl: "https://openrouter.ai/api/v1",
  model: "anthropic/claude-sonnet-4.5",
};

const messages = [
  {
    role: "user" as const,
    content: "Return JSON.",
  },
];

const schema = {
  name: "test_schema",
  schema: {
    type: "object",
    properties: {
      value: {
        type: "string",
      },
    },
    required: ["value"],
    additionalProperties: false,
  },
};

function successResponse(content: string) {
  return new Response(JSON.stringify({
    choices: [
      {
        message: {
          content,
        },
      },
    ],
  }), {
    status: 200,
    headers: {
      "content-type": "application/json",
    },
  });
}

function messageResponse(message: Record<string, unknown>) {
  return new Response(JSON.stringify({
    choices: [
      {
        message,
      },
    ],
  }), {
    status: 200,
    headers: {
      "content-type": "application/json",
    },
  });
}

function errorResponse(status: number, message: string) {
  return new Response(JSON.stringify({
    error: {
      message,
    },
  }), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

function mockFetch(responses: Response[]) {
  const calls: FetchCall[] = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    assert.ok(init, "fetch init should be passed");
    const body = init.body;
    if (typeof body !== "string") {
      throw new TypeError("fetch body should be a string");
    }

    calls.push({
      url: String(url),
      init,
      body: JSON.parse(body),
    });

    const response = responses.shift();
    assert.ok(response, "unexpected extra fetch call");

    return response;
  }) as typeof fetch;

  return {
    calls,
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

describe("createChatCompletion", () => {
  const envBackup: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of [
      "AI_REQUEST_MAX_ATTEMPTS",
      "AI_REQUEST_TIMEOUT_MS",
      "OPENROUTER_REQUIRE_PARAMETERS",
      "OPENROUTER_RESPONSE_HEALING",
    ]) {
      envBackup[key] = process.env[key];
    }

    process.env.AI_REQUEST_MAX_ATTEMPTS = "1";
    process.env.AI_REQUEST_TIMEOUT_MS = "10000";
    delete process.env.OPENROUTER_REQUIRE_PARAMETERS;
    delete process.env.OPENROUTER_RESPONSE_HEALING;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(envBackup)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("sends strict json_schema with OpenRouter provider requirements", async () => {
    const fetchMock = mockFetch([successResponse("{\"value\":\"ok\"}")]);

    try {
      const content = await createChatCompletion(config, messages, { schema });

      assert.equal(content, "{\"value\":\"ok\"}");
      assert.equal(fetchMock.calls.length, 1);
      assert.equal(fetchMock.calls[0]?.url, "https://openrouter.ai/api/v1/chat/completions");
      assert.deepEqual(fetchMock.calls[0]?.body.response_format, {
        type: "json_schema",
        json_schema: {
          name: "test_schema",
          strict: true,
          schema: schema.schema,
        },
      });
      assert.deepEqual(fetchMock.calls[0]?.body.provider, {
        require_parameters: true,
      });
      assert.deepEqual(fetchMock.calls[0]?.body.plugins, [
        {
          id: "response-healing",
        },
      ]);
    } finally {
      fetchMock.restore();
    }
  });

  it("falls back from schema provider errors to json_object without require_parameters", async () => {
    const fetchMock = mockFetch([
      errorResponse(400, "Provider returned error"),
      successResponse("{\"value\":\"fallback\"}"),
    ]);

    try {
      const content = await createChatCompletion(config, messages, { schema });

      assert.equal(content, "{\"value\":\"fallback\"}");
      assert.equal(fetchMock.calls.length, 2);
      assert.deepEqual(fetchMock.calls[0]?.body.response_format, {
        type: "json_schema",
        json_schema: {
          name: "test_schema",
          strict: true,
          schema: schema.schema,
        },
      });
      assert.deepEqual(fetchMock.calls[0]?.body.provider, {
        require_parameters: true,
      });
      assert.deepEqual(fetchMock.calls[1]?.body.response_format, {
        type: "json_object",
      });
      assert.equal(fetchMock.calls[1]?.body.provider, undefined);
    } finally {
      fetchMock.restore();
    }
  });

  it("does not fall back when OpenRouter rejects authentication or permission", async () => {
    const fetchMock = mockFetch([
      errorResponse(403, "Forbidden"),
    ]);

    try {
      await assert.rejects(
        createChatCompletion(config, messages, { schema }),
        /Forbidden/,
      );
      assert.equal(fetchMock.calls.length, 1);
    } finally {
      fetchMock.restore();
    }
  });

  it("does not fall back for invalid schemas", async () => {
    const fetchMock = mockFetch([
      errorResponse(400, "Invalid schema: required must be an array"),
    ]);

    try {
      await assert.rejects(
        createChatCompletion(config, messages, { schema }),
        /Invalid schema/,
      );
      assert.equal(fetchMock.calls.length, 1);
    } finally {
      fetchMock.restore();
    }
  });

  it("honors allowJsonFallback false", async () => {
    const fetchMock = mockFetch([
      errorResponse(400, "Provider returned error"),
    ]);

    try {
      await assert.rejects(
        createChatCompletion(config, messages, {
          schema,
          allowJsonFallback: false,
        }),
        /Provider returned error/,
      );
      assert.equal(fetchMock.calls.length, 1);
    } finally {
      fetchMock.restore();
    }
  });
});

describe("createChatCompletionWithTools", () => {
  const envBackup: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of [
      "AI_REQUEST_MAX_ATTEMPTS",
      "AI_REQUEST_TIMEOUT_MS",
      "OPENROUTER_RESPONSE_HEALING",
    ]) {
      envBackup[key] = process.env[key];
    }

    process.env.AI_REQUEST_MAX_ATTEMPTS = "1";
    process.env.AI_REQUEST_TIMEOUT_MS = "10000";
    delete process.env.OPENROUTER_RESPONSE_HEALING;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(envBackup)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("runs a plain tool loop without response_format unless requested", async () => {
    const tools = [{
      type: "function" as const,
      function: {
        name: "search_pages",
        description: "Search Wikipedia",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
            },
          },
          required: ["query"],
          additionalProperties: false,
        },
      },
    }];
    const fetchMock = mockFetch([
      messageResponse({
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: {
              name: "search_pages",
              arguments: "{\"query\":\"Sequoia Capital\"}",
            },
          },
        ],
      }),
      successResponse("{\"value\":\"tool-loop\"}"),
    ]);
    const toolCalls: string[] = [];

    try {
      const content = await createChatCompletionWithTools(config, messages, {
        tools,
        onToolCall: async (call) => {
          toolCalls.push(call.function.name);
          return "{\"pages\":[{\"title\":\"Sequoia Capital\"}]}";
        },
      });

      assert.equal(content, "{\"value\":\"tool-loop\"}");
      assert.equal(fetchMock.calls.length, 2);
      assert.deepEqual(toolCalls, ["search_pages"]);
      assert.equal(fetchMock.calls[0]?.body.response_format, undefined);
      assert.equal(fetchMock.calls[0]?.body.plugins, undefined);
      assert.deepEqual(fetchMock.calls[0]?.body.tools, tools);
      assert.equal(fetchMock.calls[1]?.body.response_format, undefined);
      assert.deepEqual(fetchMock.calls[1]?.body.messages, [
        ...messages,
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: {
                name: "search_pages",
                arguments: "{\"query\":\"Sequoia Capital\"}",
              },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call_1",
          content: "{\"pages\":[{\"title\":\"Sequoia Capital\"}]}",
        },
      ]);
      assert.deepEqual(fetchMock.calls[1]?.body.tools, tools);
    } finally {
      fetchMock.restore();
    }
  });
});
