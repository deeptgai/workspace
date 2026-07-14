import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { ChatTool, ChatToolCall } from "../ai/chatClient.js";

type McpTool = {
  name: string;
  description?: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, object>;
    required?: string[];
    [key: string]: unknown;
  };
};

type McpCallToolResult = Awaited<ReturnType<Client["callTool"]>>;

export type MediaWikiMcpSession = {
  tools: ChatTool[];
  callTool: (call: ChatToolCall) => Promise<string>;
  close: () => Promise<void>;
};

const ALLOWED_MEDIAWIKI_TOOLS = new Set(["search_pages", "get_page_info", "parse_page"]);
const ENGLISH_WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php";

function packageRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "node_modules", "mediawiki-mcp-server");
}

function mediawikiServerPath() {
  return process.env.MEDIAWIKI_MCP_SERVER_PATH || path.join(packageRoot(), "build", "index.js");
}

function sanitizeToolSchema(tool: McpTool) {
  const properties = {
    ...(tool.inputSchema.properties ?? {}),
  };

  delete properties.apiUrl;

  const required = (tool.inputSchema.required ?? []).filter((key) => key !== "apiUrl");

  if (tool.name === "search_pages" && properties.limit) {
    properties.limit = {
      type: "number",
      minimum: 1,
      maximum: 5,
      description: "Maximum number of results to return. Use 1-3 unless more disambiguation is needed.",
    };
  }

  return {
    type: "object",
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: false,
  };
}

function toolText(result: McpCallToolResult) {
  if ("toolResult" in result) {
    return JSON.stringify(result.toolResult).slice(0, Number(process.env.MEDIAWIKI_MCP_TOOL_RESULT_MAX_CHARS || "8000"));
  }

  return result.content.map((item) => {
    if (item.type === "text") {
      return item.text;
    }

    if (item.type === "resource" && "text" in item.resource) {
      return item.resource.text;
    }

    if (item.type === "resource_link") {
      return `${item.title ?? item.name}: ${item.uri}`;
    }

    return `[${item.type} content omitted]`;
  }).join("\n\n").slice(0, Number(process.env.MEDIAWIKI_MCP_TOOL_RESULT_MAX_CHARS || "8000"));
}

function parseArguments(value: string) {
  try {
    const parsed = JSON.parse(value);

    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export async function openMediaWikiMcpSession(): Promise<MediaWikiMcpSession> {
  const client = new Client({
    name: "deeptg-mediawiki-enrichment",
    version: "0.1.0",
  });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [mediawikiServerPath()],
    stderr: "pipe",
  });

  await client.connect(transport);

  const listedTools = await client.listTools();
  const mcpTools = listedTools.tools.filter((tool): tool is McpTool => ALLOWED_MEDIAWIKI_TOOLS.has(tool.name));
  const tools = mcpTools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: sanitizeToolSchema(tool),
    },
  }));

  return {
    tools,
    async callTool(call: ChatToolCall) {
      if (!ALLOWED_MEDIAWIKI_TOOLS.has(call.function.name)) {
        return `Tool ${call.function.name} is not allowed.`;
      }

      const args: Record<string, unknown> = {
        ...parseArguments(call.function.arguments),
        apiUrl: ENGLISH_WIKIPEDIA_API,
      };

      if (call.function.name === "search_pages") {
        const limit = typeof args.limit === "number" ? args.limit : 3;
        args.limit = Math.max(1, Math.min(5, limit));
      }

      const result = await client.callTool({
        name: call.function.name,
        arguments: args,
      });

      return toolText(result);
    },
    async close() {
      await client.close();
    },
  };
}
