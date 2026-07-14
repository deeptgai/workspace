import { appendJsonOutputContract, loadPromptMarkdown } from "./loader.js";

const SOURCE_SIGNAL_CURATOR_JSON_SCHEMA = {
  decision: "merge | create | reject",
  sourceSignalId: "required only for merge",
  confidence: "0..1",
  reason: "short Russian reason",
  title: "optional improved title",
  summary: "optional improved summary",
  canonicalClaim: "optional for create",
  tags: ["optional", "tags"],
};

export const SOURCE_SIGNAL_CURATOR_SYSTEM_PROMPT = appendJsonOutputContract(
  loadPromptMarkdown("tasks/source-signal-curator.md"),
  SOURCE_SIGNAL_CURATOR_JSON_SCHEMA,
);
