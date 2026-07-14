import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type PromptDocument = {
  body: string;
  frontmatter: Record<string, string>;
};

const promptRoot = path.dirname(fileURLToPath(import.meta.url));

function normalizePrompt(value: string) {
  return value.replace(/\r\n/g, "\n").trim();
}

function promptPath(relativePath: string) {
  const candidates = [
    path.join(promptRoot, relativePath),
    path.join(process.cwd(), "src", "prompts", relativePath),
    path.join(process.cwd(), "dist", "prompts", relativePath),
  ];
  const resolved = candidates.find((candidate) => existsSync(candidate));

  if (!resolved) {
    throw new Error(`Prompt file not found: ${relativePath}`);
  }

  return resolved;
}

export function loadPromptMarkdown(relativePath: string) {
  return normalizePrompt(readFileSync(promptPath(relativePath), "utf8"));
}

export function loadPromptDocument(relativePath: string): PromptDocument {
  const raw = loadPromptMarkdown(relativePath);
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);

  if (!match) {
    return {
      body: raw,
      frontmatter: {},
    };
  }

  const frontmatter = Object.fromEntries(
    match[1]
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const separator = line.indexOf(":");

        if (separator < 0) {
          return [line, ""];
        }

        return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
      }),
  );

  return {
    body: normalizePrompt(match[2]),
    frontmatter,
  };
}

export function renderPromptTemplate(template: string, values: Record<string, string>) {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => values[key] ?? match);
}

export function appendJsonOutputContract(prompt: string, schema: unknown) {
  return [
    prompt,
    "",
    "Верни только JSON object без Markdown и без code fence.",
    "",
    "JSON schema:",
    JSON.stringify(schema),
  ].join("\n");
}
