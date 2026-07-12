# Working notes (`_helpers/` vs `_Private/`)

> Part of the [agent instructions](../AGENTS.md).

The project has **two parallel trees** for working notes. They are separate on disk, in git, and in the marketplace package - by design.

| Tree        | Visibility | Tracked in main repo ? | Backsource                                                                      | Typical content                                                                                                 |
| ----------- | ---------- | ---------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `_helpers/` | Public     | Partially (gated)      | n/a                                                                             | Audits, action plans, strategy docs that are ready to be shared with collaborators / the open-source community. |
| `_Private/` | Local-only | No (gitignored)        | bare repo at `D:\Projets_Perso\03_Code\_Extensions\vsCode\AIFlowBridge-Private` | Personal drafts, WIP, brainstorms, post-mortems, anything that should never leave this machine.                 |

`_helpers/` is selectively tracked per the `.gitignore` rules. Currently tracked files (`PublishAIFlowBridge.ps1`, `SetupPrivateRepo.ps1`) land on GitHub. The subdirectories `_helpers/docs` and `_helpers/archives` are gitignored in anticipation of future use but do not yet exist on disk.

`_Private/` is fully gitignored from the main repo. It is its own git repo (branch `master`) backed by a bare repo at `D:\Projets_Perso\03_Code\_Extensions\vsCode\AIFlowBridge-Private`. The history can travel to a private remote (private GitHub repo, external drive) but **never** lands on the public main repo or in the VSIX. Both `_helpers/**` and `_Private/**` are excluded from the VSIX via `.vscodeignore`.

## Setup

Run `pwsh -File _helpers/SetupPrivateRepo.ps1` (one-shot, idempotent). The script creates the bare repo, clones it into `_Private/`, scaffolds a starter structure (`docs/`, `archives/`, `README.md`), and updates `.gitignore` + `.vscodeignore`. See `_Private/README.md` for the daily workflow.

## Helpers

| File                                | Purpose                                                                      |
| ----------------------------------- | ---------------------------------------------------------------------------- |
| `_helpers/SetupPrivateRepo.ps1`    | One-shot setup of the `_Private/` working notes tree                         |
| `_helpers/PublishAIFlowBridge.ps1` | Build, package, and install the VSIX into one or more local VS Code profiles |

## Rule for agents

If you generate a document that could be sensitive (audit findings, security post-mortems, strategic plans with personal targets, screenshots of internal tools, anything that is not yet ready to be public), default to `_Private/docs/`. Promote to `_helpers/docs/` only when the author decides it is safe to share. Never copy from `_Private/` to the public tree without explicit user approval.
