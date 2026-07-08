# Connecting Continue (JetBrains) to the AIFlowBridge standalone gateway

[Continue](https://www.continue.dev/) is the JetBrains plugin that brings AI chat + agent mode to IntelliJ, PyCharm, WebStorm, GoLand, etc.
It is OpenAI-compatible out of the box, so it talks to the AIFlowBridge standalone gateway with no plugin-specific glue.

## Prerequisites

- AIFlowBridge standalone gateway running on the same machine, on `http://127.0.0.1:8787/v1`.
- Continue 0.9+ (JetBrains) installed.

Verify the gateway is up:

```bash
curl http://127.0.0.1:8787/v1/models
```

## Configure Continue

Create or edit `~/.continue/config.yaml`:

```yaml
name: AIFlowBridge Standalone
version: 1.0.0
models:
  - name: DeepSeek V4 Pro (AIFlowBridge)
    provider: openai
    model: deepseek-v4-pro
    apiBase: http://127.0.0.1:8787/v1
    apiKey: standalone
    roles: [chat, edit, apply]

  - name: DeepSeek V4 Flash (AIFlowBridge)
    provider: openai
    model: deepseek-v4-flash
    apiBase: http://127.0.0.1:8787/v1
    apiKey: standalone
    roles: [chat, edit, apply]

  - name: MiniMax M3 (AIFlowBridge)
    provider: openai
    model: MiniMax-M3
    apiBase: http://127.0.0.1:8787/v1
    apiKey: standalone
    roles: [chat, edit, apply]

  - name: MiMo V2.5 Pro (AIFlowBridge)
    provider: openai
    model: mimo-v2.5-pro
    apiBase: http://127.0.0.1:8787/v1
    apiKey: standalone
    roles: [chat, edit, apply]

  - name: MiMo V2 Omni (AIFlowBridge)
    provider: openai
    model: mimo-v2-omni
    apiBase: http://127.0.0.1:8787/v1
    apiKey: standalone
    roles: [chat, edit, apply]
```

> `apiKey: standalone` is intentional. The gateway validates the real upstream API key server-side (against DeepSeek / MiniMax / Xiaomi).
> The `Authorization: Bearer ...` header on incoming requests just needs to be a non-empty string. Pick anything memorable.

## Reload Continue

In JetBrains: open the Continue panel (`View -> Tool Windows -> Continue`) and hit `Ctrl/Cmd + R` inside the panel, or reload the IDE window.

## Add more models

`GET http://127.0.0.1:8787/v1/models` returns the full list of routes the gateway knows about (hand-curated + synthesized from the bundled registry).
Copy any model id from the response into a new entry in `config.yaml`.

## Verify

Inside Continue, ask: "What model are you?". The selected model name should appear in the answer.
You can also check the AIFlowBridge logs (`journalctl --user -u aiflowbridge` on Linux, Console.app on macOS, the Task Scheduler history on Windows) for a `POST /v1/chat/completions` entry.
