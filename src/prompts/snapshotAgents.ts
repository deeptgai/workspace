import type { ChannelSnapshotSectionId } from "../snapshots/sourceSnapshotSchema.js";
import { appendJsonOutputContract, loadPromptDocument, loadPromptMarkdown, renderPromptTemplate } from "./loader.js";

export type SignalAgentDefinition = {
  id: ChannelSnapshotSectionId;
  title: string;
  agent: string;
  query: string;
  instruction: string;
  maxItems: number;
};

const signalAgentIds = [
  "ideas",
  "pains",
  "risks",
  "hypotheses",
  "insights",
  "trends",
  "events",
  "materials",
  "tools",
  "places",
  "people",
] as const satisfies readonly ChannelSnapshotSectionId[];

function frontmatterValue(frontmatter: Record<string, string>, key: string, file: string) {
  const value = frontmatter[key]?.trim();

  if (!value) {
    throw new Error(`Prompt file ${file} is missing frontmatter key: ${key}`);
  }

  return value;
}

function frontmatterNumber(frontmatter: Record<string, string>, key: string, file: string) {
  const rawValue = frontmatterValue(frontmatter, key, file);
  const value = Number(rawValue);

  if (!Number.isFinite(value)) {
    throw new Error(`Prompt file ${file} has invalid number in frontmatter key: ${key}`);
  }

  return value;
}

function loadSignalAgentDefinition(id: typeof signalAgentIds[number]): SignalAgentDefinition {
  const file = `signals/${id}.md`;
  const document = loadPromptDocument(file);

  return {
    id,
    title: frontmatterValue(document.frontmatter, "title", file),
    agent: frontmatterValue(document.frontmatter, "agent", file),
    query: frontmatterValue(document.frontmatter, "query", file),
    instruction: document.body,
    maxItems: frontmatterNumber(document.frontmatter, "maxItems", file),
  };
}

export const SIGNAL_AGENTS: SignalAgentDefinition[] = signalAgentIds.map(loadSignalAgentDefinition);

export const CHANNEL_SUMMARY_SYSTEM_PROMPT = appendJsonOutputContract(
  loadPromptMarkdown("tasks/channel-summary.md"),
  {
    summary: "1-2 short Russian sentences with the top-level channel summary, max 240 characters",
  },
);

export const HERO_THEME_SYSTEM_PROMPT = appendJsonOutputContract(
  loadPromptMarkdown("tasks/hero-theme.md"),
  {
    palette: "emerald | indigo | amber | rose | slate | cyan",
    motif: "network | notes | city | market | studio | landscape",
    mood: "short Russian mood",
    concept: "short Russian visual concept",
    imagePrompt: "English image generation prompt",
  },
);

const SECTION_AGENT_ITEM_JSON_SCHEMA = {
  title: "string",
  description: "string",
  url: "direct external URL optional, only when explicitly present in evidence",
  score: "short human-readable label optional",
  priority: "high | medium | low optional",
  tags: ["короткий UI-тег 1-2 слова", "например: AI", "например: найм"],
  confidence: "number 0..1",
  metrics: [{ key: "stable_machine_key", label: "human readable label", value: "string" }],
  evidence: [{ itemId: "source item external id", quote: "short quote optional", reason: "why this evidence matters" }],
};

const PEOPLE_SECTION_AGENT_ITEM_JSON_SCHEMA = {
  ...SECTION_AGENT_ITEM_JSON_SCHEMA,
  actorExternalId: "string required for people section",
  personUsername: "string optional without @",
  personName: "string optional",
};

function sectionAgentJsonSchema(definition: Pick<SignalAgentDefinition, "id">) {
  return {
    summary: "string",
    items: [
      definition.id === "people"
        ? PEOPLE_SECTION_AGENT_ITEM_JSON_SCHEMA
        : SECTION_AGENT_ITEM_JSON_SCHEMA,
    ],
  };
}

function sectionAgentBasePrompt(definition: Pick<SignalAgentDefinition, "agent">) {
  return renderPromptTemplate(loadPromptMarkdown("tasks/signal-extraction.md"), {
    agent: definition.agent,
  });
}

export function buildSectionAgentSystemPrompt(definition: Pick<SignalAgentDefinition, "agent" | "id">) {
  return appendJsonOutputContract(
    sectionAgentBasePrompt(definition),
    sectionAgentJsonSchema(definition),
  );
}

export function buildSignalSearchPlannerSystemPrompt(definition: Pick<SignalAgentDefinition, "agent">) {
  return appendJsonOutputContract(
    renderPromptTemplate(loadPromptMarkdown("agents/signal-search-planner.md"), {
      agent: definition.agent,
    }),
    {
      enoughEvidence: "boolean, true when current evidence is sufficient for final extraction",
      reason: "short Russian explanation of the decision",
      queries: [{
        query: "short semantic search query",
        reason: "why this search helps",
      }],
    },
  );
}
