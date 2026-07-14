# Prompt Files

Editable prompts live here as Markdown.

- `signals/*.md` are signal extraction definitions. Frontmatter controls `title`, `agent`, `query`, and `maxItems`; the Markdown body is the section instruction.
- `tasks/*.md` are single-shot LLM task prompts such as formatting, JSON repair, summary, visual theme, and signal curation.
- `tasks/signal-extraction.md` is the shared system prompt for signal extraction calls.
- `images/*.md` are image prompt templates.
- `agents/*.md` are prompts used by real multi-step agents with tool use and loops. Do not put single-shot prompts there.

Text prompts should contain role, task, and editorial rules. JSON output contracts live in TypeScript prompt builders, not in editable Markdown.

Image prompt templates may contain data placeholders such as `{{theme}}`, `{{tags}}`, and `{{topSignals}}`; these are runtime inputs rather than hidden agent instructions.

`npm run build` copies these `.md` files into `dist/prompts` for production workers and CLI commands.
