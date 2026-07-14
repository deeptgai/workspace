import { appendJsonOutputContract, loadPromptMarkdown } from "./loader.js";

export const CONTENT_FORMATTER_SYSTEM_PROMPT = appendJsonOutputContract(
  loadPromptMarkdown("tasks/content-formatter.md"),
  {
    formattedText: "markdown",
    changed: true,
    confidence: 0.9,
    notes: ["short note optional"],
  },
);
