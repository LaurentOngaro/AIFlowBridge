# Providers

> Part of the [AIFlowBridge documentation](../README.md).

## Supported models (14 bundled + 100+ reachable via OpenRouter)

| Provider   | Models                                                                                                                                                           | Vision          | Tool Calling |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------ |
| DeepSeek   | V4 Flash, V4 Pro                                                                                                                                                 | Proxied         | ✅           |
| MiniMax    | M2, M2.1, M2.1 Highspeed, M2.5, M2.5 Highspeed, M2.7, M2.7 Highspeed                                                                                             | Proxied         | ✅           |
| MiniMax    | M3                                                                                                                                                               | **Native**      | ✅           |
| Xiaomi     | MiMo V2 Omni                                                                                                                                                     | Native          | ✅           |
| Xiaomi     | MiMo V2 Pro, V2.5 Pro                                                                                                                                            | Proxied         | ✅           |
| Xiaomi     | MiMo V2.5                                                                                                                                                        | **Native**      | ✅           |
| OpenRouter | [100+ models at `openrouter.ai/models`](https://openrouter.ai/models) - see [OpenRouter section](#openrouter-100-models-via-a-single-openai-compatible-endpoint) | varies by model | ✅           |

Notes:

- All 14 direct-vendor models in the table above expose the image-paste button in Copilot Chat. **Native** models accept images directly. **Proxied** models route the image through a separate vision-capable model that produces a text description, which is then injected into the prompt (see [vision-proxy.md](vision-proxy.md)).
- **Thinking** indicates a reasoning model with a thinking-effort selector exposed in Copilot Chat. MiniMax M2 / M2.1 / M2.5 / M2.7 generations do not expose a thinking selector. **MiniMax M3 exposes a "Thinking Effort" selector** (None / High / Max) that maps to the upstream `reasoning_split` boolean - see [reasoning.md](reasoning.md).
- Configure the proxied vision model with `AIFlowBridge: Set vision proxy model` or via `aiflowbridge.vision.copilotVisionModel`.
- **OpenRouter** is exposed through the OpenAI-compatible gateway only (port 8787), not through the Copilot Chat picker. The 100+ model ids listed at [openrouter.ai/models](https://openrouter.ai/models) are ALL reachable: pass any of them verbatim in the `model` field of a request to `http://127.0.0.1:8787/v1/chat/completions` and the gateway forwards the call to `openrouter.ai/api/v1/chat/completions` unchanged. The bundled `models.json` ships 7 flagship entries (`nvidia/nemotron-3-ultra-550b-a55b:free`, `openai/gpt-oss-120b:free`, `google/gemma-4-31b-it:free`, `meta-llama/llama-3.3-70b-instruct:free`, `qwen/qwen3-coder:free`, `qwen/qwen3-next-80b-a3b-instruct:free`, `nvidia/nemotron-3-super-120b-a12b:free`) - all on OpenRouter's free tier, so the dashboard always shows $0 for them. **All other OpenRouter model ids work exactly the same way** - they are not "limited to the bundled list". Adding a non-bundled id is optional and only changes the dashboard experience (it appears in `GET /v1/models`, you can attach a `pricing` block). The Vision / Native columns do NOT apply to OpenRouter since the gateway forwards image parts unchanged to OpenRouter and each upstream model decides whether to handle them natively. See the [OpenRouter section](#openrouter-100-models-via-a-single-openai-compatible-endpoint) below for setup, the bundled flagship table (with their confirmed capabilities), and the indicative tariff.

## OpenRouter (100+ models via a single OpenAI-compatible endpoint)

[OpenRouter](https://openrouter.ai/) is a meta-provider that fronts 100+ models from OpenAI, Anthropic, Google, Meta, Mistral, DeepSeek, Alibaba, and others behind one OpenAI-compatible endpoint (`https://openrouter.ai/api/v1`).
It honours the Chat Completions spec, accepts a standard `Authorization: Bearer <key>` header, and streams SSE the same way every other OpenAI-compatible vendor does.
No protocol adapter is required - it plugs into AIFlowBridge the same way DeepSeek or MiniMax do.

### Setup

1. **Get an API key** from [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys).
2. **Store it in SecretStorage** (VS Code extension):

   ```
   Ctrl+Shift+P  ->  AIFlowBridge: Edit model registry
   ```

   Then add a vendor entry, OR for the gateway path, set the key via the `aiflowbridge.providers.openrouter.apiKey` SecretStorage slot (the standalone CLI reads `AIFLOWBRIDGE_OPENROUTER_API_KEY` from the environment).

3. **Restart the gateway** so the new vendor is picked up. The gateway advertises the seven flagship models below in `GET /v1/models`. The other 100+ models are reachable by name - set the model id in your OpenAI-compatible client (Kilo Code picker, Continue config, `curl -d '{"model": "..."}'`) and the gateway forwards the call verbatim.

### Bundled flagship subset (7 of 100+, all free tier)

> **Data snapshot: 2026-07-14 (AIFlowBridge 2.15.0).** Source: `https://openrouter.ai/api/v1/models` (live catalog query, July 2026) + `resources/pricing.json` bundled at release time. The 7 free-tier ids below are pinned to this snapshot; a new release of AIFlowBridge may refresh the list. The 100+ non-bundled OpenRouter model ids reachable through `aiflowbridge.userModels` are queried against the live OpenRouter catalog at call time, so they always reflect the current upstream state.

The bundled registry ships seven recent flagships - chosen to maximise coverage of the top labs (NVIDIA, OpenAI, Google, Meta, Alibaba) and to ship on the OpenRouter **free tier** (pricing = $0 / $0 per 1M tokens for all seven).
They appear in `GET /v1/models` and the dashboard reads their `pricing` block to compute "Est. cost" - in their case, the dashboard always shows $0. **Capabilities shown below apply only to these seven entries** - the full 100+ catalog at [openrouter.ai/models](https://openrouter.ai/models) handles them per its own documentation; consult the upstream listings for any model id not in this table.
All data below was pulled from `https://openrouter.ai/api/v1/models` (July 2026 snapshot).

| Model id (use verbatim in `model` field)                        | Context window | Output cap | Vision | Reasoning | Tool calling |
| --------------------------------------------------------------- | -------------- | ---------- | ------ | --------- | ------------ |
| `nvidia/nemotron-3-ultra-550b-a55b:free` (550B MoE, 55B active) | 1 000 000      | 65 536     | ❌     | ✅        | ✅           |
| `openai/gpt-oss-120b:free` (117B MoE, 5.1B active)              | 131 072        | 131 072    | ❌     | ✅        | ✅           |
| `google/gemma-4-31b-it:free` (30.7B dense multimodal)           | 262 144        | 8 192      | ✅     | ✅        | ✅           |
| `meta-llama/llama-3.3-70b-instruct:free`                        | 131 072        | 16 384     | ❌     | ❌        | ✅           |
| `qwen/qwen3-coder:free` (480B MoE, 35B active)                  | 1 048 576      | 262 000    | ❌     | ❌        | ✅           |
| `qwen/qwen3-next-80b-a3b-instruct:free` (80B MoE, 3B active)    | 262 144        | 16 384     | ❌     | ❌        | ✅           |
| `nvidia/nemotron-3-super-120b-a12b:free` (120B MoE, 12B active) | 1 000 000      | 262 144    | ❌     | ✅        | ✅           |

The mix covers the major OpenRouter axes: a frontier-reasoning workhorse (Nemotron 3 Ultra 550B), an OpenAI open-weight flagship (gpt-oss-120b), a multimodal option (Gemma 4 31B), the reference 70B instruct (Llama 3.3 70B), the leading free coding agent (Qwen3 Coder 480B with 1M context), a low-latency MoE (Qwen3 Next 80B), and a multi-agent orchestrator (Nemotron 3 Super 120B).

**Using a non-bundled OpenRouter model:** the same gateway path works - no AIFlowBridge update needed. Three options:

1. **Use one of the 7 bundled ids verbatim** (the IDs above are exact OpenRouter strings).
2. **Add the unknown id to `aiflowbridge.userModels`** with `family: "openrouter"`. The gateway synthesizes a virtual provider with `vendors.openrouter.baseUrl` and the new id is now visible in `GET /v1/models`. Attach a `pricing` block to get an "Est. cost" tariff in the dashboard.
3. **Override the bundled registry** via `<globalStorageUri>/models.json` or `<workspaceFolder>/.vscode/aiflowbridge.models.json` if you want the new id to ship as part of a curated registry tier.

In all three cases, the gateway forwards the model id verbatim to `openrouter.ai/api/v1/chat/completions` - AIFlowBridge does not translate, alias, or rewrite it.

### Caveats

- **Free tier is rate-limited**: OpenRouter caps free-tier traffic per IP/account. For heavy use, attach a paid key and pay per token - or switch to the direct DeepSeek / MiniMax / Xiaomi vendors. The free tier is meant for exploration, not production load.
- **Rate limits** are OpenRouter-side and stricter than direct vendors. Documented at [openrouter.ai/docs#limits](https://openrouter.ai/docs). AIFlowBridge does not add a retry layer; on 429 the client is expected to back off.
- **Attribution headers** are added automatically by the gateway on every OpenRouter request: `HTTP-Referer: https://aiflowbridge.dev v<semver>` and `X-Title: AIFlowBridge v<semver>`. OpenRouter asks for these so requests are eligible for the free-tier reliability track. The implementation lives in `src/aiflowbridge/gateway/openrouter-headers.ts` and is unit-tested in `tests/integration/openrouter.smoke.test.ts`.
- **Adding new OpenRouter models** at runtime: use **`AIFlowBridge: Add a custom model`** (the OpenRouter choice is now listed alongside MiniMax / DeepSeek / Xiaomi), or add an entry to `aiflowbridge.userModels` with `family: "openrouter"`. The gateway forwards the call regardless of whether the model id appears in the bundled registry.

### Pricing

> **Data snapshot: 2026-07-14 (AIFlowBridge 2.15.0).** Source: `https://openrouter.ai/api/v1/models` for the free-tier `pricing.prompt` / `pricing.completion` fields (bundled into `resources/pricing.json` at release time). Pricing for non-bundled model ids must be sourced from the OpenRouter model page (linked from the catalog response).

All 7 bundled flagships are **free** on OpenRouter's free tier (USD 0.00 / USD 0.00 per 1M tokens, per the OpenRouter `/v1/models` snapshot of July 2026).
The dashboard's "Est. cost" column therefore always shows $0 for these entries.
For non-bundled model ids, the dashboard does not show a tariff unless you supply a `pricing` block in the `aiflowbridge.userModels` entry.
Override per-profile via `aiflowbridge.providers[].pricing` if you have a custom OpenRouter plan or want to budget against a paid upstream model.

## Why is the model list hardcoded?

The list of officially supported models lives in [`resources/models.json`](../resources/models.json) (with its JSON Schema in [`resources/models.schema.json`](../resources/models.schema.json)) and is **not auto-discovered** from the upstream APIs.
This is a deliberate design choice driven by VS Code's `vscode.lm.registerLanguageModelChatProvider` API.

VS Code requires each model to declare its capabilities at registration time:

- `maxInputTokens` and `maxOutputTokens` (context window)
- `toolCalling` - `true`, `false`, or a numeric limit on simultaneous tools
- `imageInput` - whether the paste-image button appears in Copilot Chat
- `thinking` - whether the thinking-effort selector is exposed
- `requiresThinkingParam` - provider-specific quirks (e.g. DeepSeek's `thinking: { type: "enabled" }`)

The upstream APIs (`GET /v1/models`) only return `{ id, owned_by, created }`.
They do not expose context window, tool limits, vision support, or thinking support in a usable format.
Without explicit capabilities, VS Code would:

- Hide the image-paste button for vision-capable models
- Expose tool calling for models that don't support it (broken UX)
- Skip the thinking-effort selector for reasoning models
- Allow context overflow with no warning

A bad capability is a worse user experience than a missing model. A hardcoded registry ensures every supported model works end-to-end on day one.
See [architecture.md](architecture.md#model-registry) for how to override individual entries.

**Convention** : the `id` field in `resources/models.json` is the **upstream API id** itself (e.g. `MiniMax-M2.7`, `mimo-v2.5-pro`), not a kebab-case VS Code alias.
The picker shows the human-readable `name` field.
This avoids any id translation layer between VS Code and the upstream API.

## Adding a model without waiting for a release

You do **not** need a new AIFlowBridge release to use a newly released provider model. Three options, from simplest to most powerful:

### Option 1 - Command Palette (easiest)

Run **`AIFlowBridge: Add a custom model`** from the Command Palette. The command:

1. Asks which provider to query
2. Fetches the model list from the provider's `/v1/models` endpoint (using your stored API key)
3. Lets you pick a model from the list
4. Lets you pick its capabilities (tool calling, vision, thinking) with simple Yes/No prompts
5. Saves the entry to your `aiflowbridge.userModels` setting

The new model appears in the Copilot Chat picker immediately. You can edit or remove the entry in your user settings at any time.

### Option 2 - Direct setting (`aiflowbridge.userModels`)

Add an entry to `settings.json` under `aiflowbridge.userModels`:

```json
{
  "aiflowbridge.userModels": [
    {
      "id": "minimax-m3",
      "name": "MiniMax M3",
      "family": "minimax",
      "version": "m3",
      "maxInputTokens": 1000000,
      "maxOutputTokens": 128000,
      "capabilities": {
        "toolCalling": true,
        "imageInput": true,
        "thinking": false
      },
      "requiresThinkingParam": false
    }
  ]
}
```

**Trade-off** : user-declared models are your responsibility.
If you mark `imageInput: true` for a model that does not accept images, the Copilot Chat paste button will appear but the model will fail on upload.
Capabilities are not validated against the upstream API.

### Option 3 - Registry override (workspace or per-user)

For a more permanent, structured change (pricing, vendor defaults, full schema validation in the editor), use the **model registry** instead of `aiflowbridge.userModels`.
Run **`AIFlowBridge: Edit model registry`** - it opens `<globalStorageUri>/models.json` in the editor (creating it from the bundled file if needed).
See [architecture.md](architecture.md#model-registry) for the full schema and override rules.
Changes apply to the **next VS Code window reload**.

## Promoting a user model to the official registry

If a user-defined model is widely useful, the recommended path is to add it to the official bundled registry in [`resources/models.json`](../resources/models.json) via a pull request.
The PR will be reviewed for:

- Correct `id` matching the upstream API exactly (use `AIFlowBridge: Add a custom model` or `curl /v1/models` to confirm)
- Correct capabilities (especially image input and thinking)
- Matching `maxInputTokens` / `maxOutputTokens` from the provider's documentation
- Per-model `pricing` block (USD per 1M tokens) - see the `ModelPricing` shape in [architecture.md](architecture.md#model-registry)
- Translation key in `package.nls.json` (`model.<id>.detail`)
- Entry in the Providers table above
- **Snapshot date** stamped at the top of each affected table (see "Data freshness" below)

The release cadence is opportunistic - no fixed schedule. Tag `v1.x.y` when a meaningful set of changes accumulates.

## Data freshness

Every pricing number and model id mentioned in this document is a **snapshot**, not a live feed.
The data was pulled at release time of the bundled `resources/models.json` and **does not auto-refresh**.

### Snapshot metadata

- Current snapshot date: **2026-07-13**
- Current snapshot version: **AIFlowBridge 2.15.0**
- Primary source (OpenRouter): `https://openrouter.ai/api/v1/models`
- Primary source (direct vendors): the per-vendor pricing pages documented in `vendors.<vendor>.externalUrls` of `resources/models.json`

### Refresh cadence

- Snapshot is regenerated when `resources/models.json` ships a new revision (i.e. on every AIFlowBridge release that touches the model registry).
- Snapshot metadata is stamped next to each affected table or block - look for the `> Data snapshot: YYYY-MM-DD (AIFlowBridge X.Y.Z).` line above the block.
- The `description`, `displayName`, and `keywords` fields in `package.json` also carry this metadata.

### What does NOT auto-refresh

- The 7 bundled OpenRouter flagships (table above). Picking a new free flagship requires an explicit registry edit + release.
- The `pricing` block of each bundled model (pricing is hardcoded; we do NOT re-fetch on every gateway start to keep the cold-start path zero-network).
- The "Pick your cost point" table in `README.md` and the "Indicative rates per family" table in `docs/cost.md`.

### What DOES auto-refresh at runtime

- The 100+ non-bundled OpenRouter model ids reachable through `aiflowbridge.userModels`. Those are forwarded verbatim to OpenRouter by id - no AIFlowBridge-managed pricing for them.
- Discovery payloads (`GET /v1/discovery`) - built dynamically from the live registry cache.

### Verifying a number before quoting it

1. Find the `> Data snapshot: ...` line above the block you want to quote.
2. If the snapshot date is older than ~3 months, treat the number as indicative only.
3. To pull a fresh snapshot, query the OpenRouter API and the per-vendor pricing pages listed above, then open a PR with the new bundled entries + updated snapshot dates.

This policy is enforced as a soft contract - contributors adding pricing data to user-facing docs without a snapshot stamp should be flagged in PR review.
