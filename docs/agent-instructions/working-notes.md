# Working notes (`_helpers/` vs `_Private/`)

> Part of the [agent instructions](../AGENTS.md).

The project has **two parallel trees** for everything that is not extension runtime. They are separate on disk, in git, and in the marketplace package - by design.

## What belongs in the repo root

Anything that the extension or the standalone gateway **needs at runtime or build time** sits at the repo root: `src/`, `dist/`, `resources/`, `package.json`, `tsconfig*.json`, `tests/`, `out/`, `.github/`, `.vscode/`. Nothing else.

Everything else - utility scripts, working notes, audits, archived material, personal drafts - lives under `_helpers/` or `_Private/`.

## The two trees

| Tree        | Visibility | Tracked in main repo ?                              | Backsource                                                                      | Typical content                                                                                                |
| ----------- | ---------- | ---------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `_helpers/` | Public     | Partially (gated per subfolder)                      | n/a                                                                             | Anything **public** but **not extension runtime**: utility scripts, audits, action plans, strategy docs ready to be shared with collaborators / the open-source community. |
| `_Private/` | Local-only | No (gitignored)                                      | bare repo at `D:\Projets_Perso\03_Code\_Extensions\vsCode\AIFlowBridge-Private` | Personal drafts, WIP, brainstorms, post-mortems, anything that should never leave this machine.                |

Both `_helpers/**` and `_Private/**` are excluded from the VSIX via `.vscodeignore` so they never reach end users even by accident.

## `_helpers/` layout

`_helpers/` is split into three subfolders with distinct visibility rules. Pick the right one before writing a file there.

| Subfolder              | Visibility | Tracked ?                                          | Used for                                                                                                              |
| ---------------------- | ---------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `_helpers/scripts/`    | Public     | Yes (committed to main repo)                       | Utility scripts invoked from the terminal, CI, or the VS Code task runner. PowerShell (`.ps1`), Python (`.py`), and Node (`.mjs`, `.js`) live side by side. Stable, versioned. Runtime requirement (Python 3, Node, PowerShell) follows the script's own shebang. |
| `_helpers/docs/`       | Public     | No (gitignored)                                    | Long-form shared working notes - audits, action plans, strategy docs, post-mortems that are ready to be shared with the open-source community but not part of the user-facing `docs/` tree. Reserved for future use; nothing there yet. |
| `_helpers/archives/`   | Public     | No (gitignored)                                    | Frozen snapshots of historical material (audit dumps, raw logs, generated reports) that are useful for future archaeology but should not pollute `git log` or the repo size. Reserved for future use; nothing there yet. |

Rule of thumb: if a file is **run as a command**, it goes in `_helpers/scripts/`. If a file is **read as documentation or evidence**, it goes in `_helpers/docs/` (when public) or `_Private/docs/` (when local-only). If it is a **historical artifact to be preserved verbatim**, it goes in `_helpers/archives/`.

## `_Private/` layout

`_Private/` is fully gitignored from the main repo. It is its own git repo (branch `master`) backed by a bare repo at `D:\Projets_Perso\03_Code\_Extensions\vsCode\AIFlowBridge-Private`. The history can travel to a private remote (private GitHub repo, external drive) but **never** lands on the public main repo or in the VSIX.

`_Private/` can contain the same kinds of artefacts as `_helpers/` (scripts, docs, archives) plus anything personal that should never leave the machine. Typical layout: `_Private/docs/` for personal notes, `_Private/scripts/` for local-only scripts (one-off automations, tools that touch personal data, internal API keys, ...), `_Private/archives/` for local-only dumps, plus anything else the author wants to keep out of the public eye. Subfolder names are not enforced - use whatever structure matches your workflow. See `_Private/README.md` once `SetupPrivateRepo.ps1` has been run.

## Setup

Run `pwsh -File _helpers/scripts/SetupPrivateRepo.ps1` (one-shot, idempotent). The script creates the bare repo, clones it into `_Private/`, scaffolds a starter structure (`docs/`, `archives/`, `README.md`), and updates `.gitignore` + `.vscodeignore`. See `_Private/README.md` for the daily workflow.

## Scripts

All utility scripts live in `_helpers/scripts/` and are committed to the main repo so any contributor can run them.

| File                                                            | Language   | Purpose                                                                                              | Invocation                                                          |
| --------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `_helpers/scripts/SetupPrivateRepo.ps1`                        | PowerShell | One-shot setup of the `_Private/` working notes tree                                                 | `pwsh -File _helpers/scripts/SetupPrivateRepo.ps1`                  |
| `_helpers/scripts/PublishAIFlowBridge.ps1`                     | PowerShell | Build, package, and install the VSIX into one or more local VS Code profiles                        | `pwsh -File _helpers/scripts/PublishAIFlowBridge.ps1 [-AllProfiles]`|
| `_helpers/scripts/UpdateStandAloneServer.ps1`                   | PowerShell | Build and deploy the standalone gateway CLI to a destination folder (Windows)                       | `pwsh -File _helpers/scripts/UpdateStandAloneServer.ps1`            |
| `_helpers/scripts/RerunLastCIWorkflow.ps1`                     | PowerShell | Recreate and re-push the last git tag to retrigger the GitHub Actions CI workflow without a new commit | `pwsh -File _helpers/scripts/RerunLastCIWorkflow.ps1 [-TagName X]`  |
| `_helpers/scripts/check-standalone-bundle.js`                  | Node.js    | Smoke test: parse a CommonJS entry point, assert every relative `require()` resolves on disk, and that `package.json` + `resources/models.json` are present at the archive root. Used by `.github/workflows/release.yml` and `tests/standalone-bundle.test.ts`. | `node _helpers/scripts/check-standalone-bundle.js <entry.js>`       |
| `_helpers/scripts/format-prose.py`                            | Python 3   | Wrap long markdown prose paragraphs at sentence boundaries (soft ceiling at 250 characters per line). Accepts a file or a directory; a directory target is walked recursively for `*.md` files with hidden + build + dependency trees pruned automatically. | `python3 _helpers/scripts/format-prose.py [--check] <file-or-dir> [...]`  |

When adding a new utility script: place it under `_helpers/scripts/`, give it a comment-based help block (`.SYNOPSIS` / `.DESCRIPTION` / `.EXAMPLE` for PowerShell, a header block for Node.js), and add a row to the table above. Do not put utility scripts at the repo root or in `scripts/` (the latter is reserved for runtime or build-pipeline-critical code; the project has none today, so the folder does not exist).

## Rule for agents

If you generate a document that could be sensitive (audit findings, security post-mortems, strategic plans with personal targets, screenshots of internal tools, anything that is not yet ready to be public), default to `_Private/docs/`. Promote to `_helpers/docs/` only when the author decides it is safe to share. Never copy from `_Private/` to the public tree without explicit user approval.

If you generate a utility script (something invoked from the terminal, npm, CI, or the VS Code task runner), put it in `_helpers/scripts/`. Add a row to the table above so future agents can find it.
