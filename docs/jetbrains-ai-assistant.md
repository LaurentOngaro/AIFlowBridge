# Connecting JetBrains AI Assistant to the AIFlowBridge standalone gateway

JetBrains AI Assistant (the built-in assistant bundled with the IDE) supports a **custom OpenAI-compatible endpoint** since 2024.3.
The AIFlowBridge standalone gateway exposes exactly the shape it expects.

## Prerequisites

- AIFlowBridge standalone gateway running on `http://127.0.0.1:8787/v1`.
- JetBrains AI Assistant Pro / Enterprise tier, 2024.3 or newer.

## Configure

`Settings -> Tools -> AI Assistant -> Models -> Add model -> Custom OpenAI-compatible endpoint`

| Field             | Value                                  |
| ----------------- | -------------------------------------- |
| Provider name     | `AIFlowBridge` (or anything you want)  |
| URL               | `http://127.0.0.1:8787/v1`             |
| API key           | `standalone` (any non-empty string)    |
| Model             | `deepseek-v4-pro`                      |
| Enable            | Yes                                    |

> The exact menu path varies across 2024.3 / 2025.x point releases.
> In 2025.1 it's `Settings -> Tools -> AI Assistant -> Providers -> Add provider -> OpenAI Compatible`.

Repeat for every model you want to expose (one JetBrains "provider" per upstream model). The list of available ids is at `http://127.0.0.1:8787/v1/models`.

## Verify

Open the AI Assistant chat and pick the new model from the picker.
Send: `Reply with "ok" only.` You should see `ok` and a row in the AIFlowBridge metrics dashboard.
