# Style rules

> Part of the [agent instructions](../AGENTS.md).

## DO

- **Chat interactions** with the agent (thinking, questions, answers, reflections): French.
- **Code, comments, docs:** English only.
- **Markdown prose:** one paragraph = one physical line. Tables, code blocks, and frontmatter are exempt.
- **User-facing strings:** English.
- **TypeScript:** strict typing, ES modules (`import` / `export`), `async/await`, `const` over `let`, `interface` for object shapes, `type` for unions/aliases.
- **No `any`** unless unavoidable - prefer `unknown` and narrow.
- **API keys** stored in VS Code `SecretStorage` (OS keychain) - never in `settings.json` or repo files.

## DON'T

- **No Chinese localization files** (`package.nls.zh-cn.json`, `README.zh-cn.md`, ...). Project is English-only by design.
- **No em-dash (U+2014) or en-dash (U+2013).** Use plain ASCII hyphen-minus (`-`, U+002D). Reason: these characters are almost exclusively used by AI assistants in French/English prose, not by humans in their daily writing. Their presence in a tracked file is a strong signal of AI-generated content.
- **No smart quotes / ellipsis.** ASCII `'` `"` `...` instead of curly variants. Mostly enforced automatically by `MD026` in `markdownlint`.
- **French diacritics are required, not optional** (é è ê à â ç ô ù û ï î ë ÿ, plus uppercase É È Ê À Â Ç Ô Ù Û Ï Î Ë Ÿ, plus ë, æ, œ). Keep them in every French word. ASCII-only output is a violation of the project style — the source-of-truth file is UTF-8.
- **Box-drawing characters and arrow symbols** (`->` `=>` `<-`) are OK for diagrams and table separators.

## Markdown conventions

- **One sentence per line.** No line break inside a sentence, no matter the line length. The table row is allowed to wrap, but the prose never does.
- **ATX headings** (`#`, `##`).
- **Fenced code blocks** with a language hint (e.g. ` ```bash `).
- **Tables** use pipes + hyphens, no leading/trailing whitespace per cell beyond what's needed.

## TypeScript conventions

- **No `// @ts-ignore`** without a one-line justification comment.
- **No `console.*`** in source files. Use `logger.info` / `logger.warn` / `logger.debug` from `src/logger.ts`.
- **No silent error swallowing.** Empty `catch {}` blocks require a justification comment.
- **Pure functions preferred** for unit-testable logic. Side effects live at the call site so the function can be tested in isolation.
- **No comments unless asked.** If a comment is necessary (security, non-obvious behavior), it goes in English.

## Logging conventions

Prefix log messages by area:

| Prefix           | Source                                       |
| ---------------- | -------------------------------------------- |
| `[AIFlowBridge]` | `src/aiflowbridge/index.ts`, `src/runtime/*` |
| `[Gateway]`      | `src/aiflowbridge/gateway/*`                 |
| `[Telemetry]`    | `src/aiflowbridge/telemetry*`                |
| `[Vision]`       | `src/provider/vision/*`                      |
| `[MiniMax]`      | `src/provider/minimax.ts`, related           |
| `[Xiaomi]`       | `src/provider/xiaomi.ts`, related            |
| `[DeepSeek]`     | `src/provider/index.ts`, related             |

All logs go through `src/logger.ts` (`vscode.LogOutputChannel`). Inspect via `AIFlowBridge: Show logs`.

## What to delete before committing

- Temporary debug `console.log` left in source.
- Trailing whitespace, mixed line endings.
- Accidentally added `.bak` / `.orig` / `.swp` files.
- Files inside `_Private/` that should never land in the public repo.
