# Connecting Kilo Code (Cursor / Windsurf / VSCodium / code-server) to the standalone gateway

[Kilo Code](https://kilocode.ai/) runs inside any VS Code fork.
It has a built-in OpenAI-compatible provider, so the AIFlowBridge standalone gateway is a drop-in.

## Configure

In the Kilo Code side panel: `Settings -> Providers -> API Provider -> OpenAI Compatible`

| Field     | Value                      |
| --------- | -------------------------- |
| Base URL  | `http://127.0.0.1:8787/v1` |
| API Key   | (any non-empty string)     |
| Model     | `deepseek-v4-pro`          |
| Streaming | Enabled                    |

Save. The picker now lists the model. Repeat for any other model from `GET /v1/models` if you want them all in the picker.

## Verify

Ask Kilo Code a question. The response should stream normally.
In the AIFlowBridge metrics dashboard (run `npm run start:standalone` from a terminal, or open the VS Code extension's `AIFlowBridge: Show metrics dashboard`) you should see a new row under **Recent requests**.
