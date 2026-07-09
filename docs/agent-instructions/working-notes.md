# Working notes (`_helpers/` vs `_Private/`)

> Part of the [agent instructions](../AGENTS.md).

The project has **two parallel trees** for working notes. They are separate on disk, in git, and in the marketplace package - by design.

| Tree        | Visibility | Tracked in main repo ? | Backsource                                                                      | Typical content                                                                                                 |
| ----------- | ---------- | ---------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `_helpers/` | Public     | Partially (gated)      | n/a                                                                             | Audits, action plans, strategy docs that are ready to be shared with collaborators / the open-source community. |
| `_Private/` | Local-only | No (gitignored)        | bare repo at `D:\Projets_Perso\03_Code\_Extensions\vsCode\AIFlowBridge-Private` | Personal drafts, WIP, brainstorms, post-mortems, anything that should never leave this machine.                 |

`_helpers/` is selectively tracked (e.g. `AGENTS.md`, `_helpers/ACTION PLAN.md`) and ignored for the most part (e.g. `_helpers/docs`, `_helpers/archives`) per the `.gitignore` rules. Whatever IS tracked in `_helpers/` lands on GitHub; whatever is not stays local.

`_Private/` is fully gitignored from the main repo. It is its own git repo backed by a bare repo at `D:\Projets_Perso\03_Code\_Extensions\vsCode\AIFlowBridge-Private`. The history can travel to a private remote (private GitHub repo, external drive) but **never** lands on the public main repo or in the VSIX.

## Setup

Run `pwsh -File _helpers/Setup-PrivateRepo.ps1` (one-shot, idempotent). The script creates the bare repo, clones it into `_Private/`, scaffolds a starter structure (`docs/`, `archives/`, `README.md`), and updates `.gitignore` + `.vscodeignore`. See `_Private/README.md` for the daily workflow.

The script lives at `_helpers/Setup-PrivateRepo.ps1` (PascalCase). Older docs may reference `setup-private.ps1` (lowercase) - both names point at the same script.

## Helpers

| File                                | Purpose                                                                      |
| ----------------------------------- | ---------------------------------------------------------------------------- |
| `_helpers/Setup-PrivateRepo.ps1`    | One-shot setup of the `_Private/` working notes tree                         |
| `_helpers/Publish-AIFlowBridge.ps1` | Build, package, and install the VSIX into one or more local VS Code profiles |

## Rule for agents

If you generate a document that could be sensitive (audit findings, security post-mortems, strategic plans with personal targets, screenshots of internal tools, anything that is not yet ready to be public), default to `_Private/docs/`. Promote to `_helpers/docs/` only when the author decides it is safe to share. Never copy from `_Private/` to the public tree without explicit user approval.
