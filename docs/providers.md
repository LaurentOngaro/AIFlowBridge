# Providers

> Part of the [AIFlowBridge documentation](../README.md).

## Supported models (38 bundled + 100+ reachable via OpenRouter)

> Data snapshot: 2026-10-01 (AIFlowBridge 2.24.0). Upstream ids and prices verified against the vendor docs and, for OpenRouter, the live `GET /api/v1/models` catalogue.

| Provider         | Copilot Chat picker | Models                                                                                                                                                           | Vision                       | Tool Calling |
| ---------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ------------ |
| DeepSeek         | Yes                 | V4.1 Flash (`deepseek-flash`), V4 Pro (`deepseek-v4-pro`)                                                                                                        | Proxied                      | Yes          |
| MiniMax          | Yes                 | M2.7, M2.7 Highspeed                                                                                                                                             | Proxied                      | Yes          |
| MiniMax          | Yes                 | M3, M3.1 Flash Preview (M Plan / MiniMax Code only)                                                                                                              | Proxied                      | Yes          |
| Xiaomi           | Yes                 | MiMo V2.5 Pro                                                                                                                                                    | Proxied                      | Yes          |
| Xiaomi           | Yes                 | MiMo V2.5, V2.6 Flash, V2.6 Pro, V2.6 Pro UltraSpeed                                                                                                             | Proxied (`mimo-v2.5` native) | Yes          |
| Z.ai             | No (gateway-only)   | GLM 5.3, GLM 5.3 Flash, GLM 5.3 FlashX                                                                                                                           | upstream                     | Yes          |
| MoonshotAI       | No (gateway-only)   | Kimi K3, Kimi K2.7 Code, Kimi K2.7 Code Highspeed, Kimi K2.6                                                                                                     | upstream                     | Yes          |
| Google AI Studio | No (gateway-only)   | Gemini 3.8 Flash, 3.7 Flash, 3.6 Flash, `gemini-flash-latest`, `gemini-flash-lite-latest` (BYOK API key)                                                         | upstream                     | Yes          |
| OpenRouter       | No (gateway-only)   | [100+ models at `openrouter.ai/models`](https://openrouter.ai/models) - see [OpenRouter section](#openrouter-100-models-via-a-single-openai-compatible-endpoint) | upstream                     | Yes          |

A vendor appears in the Copilot Chat picker only when it has a `vscode.LanguageModelChatProvider` implementation (DeepSeek, MiniMax, Xiaomi, all three under the single `aiflowbridge` vendor id).
Gateway-only vendors are reached from Kilo Code, Continue, JetBrains AI Assistant, Open WebUI and `curl` at `http://127.0.0.1:8787/v1`, which costs them nothing: the call is forwarded verbatim.
That is also why the Vision column reads "upstream" for them: the gateway forwards image parts unchanged and the vendor decides what to do with them, so the value is not a claim AIFlowBridge makes.

Notes:

- The 11 direct Copilot Chat models in the table above (DeepSeek, MiniMax, Xiaomi) expose the image-paste button in Copilot Chat. **Native** means the upstream provider receives the image bytes directly; **Proxied** means the image is first described by a separate vision-capable model and the description is injected into the prompt. Of the 11, only `mimo-v2.5` is native - see [vision-proxy.md](vision-proxy.md) for the exact per-model table.
- **Google AI Studio (Gemini 3.8 / 3.7 / 3.6 Flash)** is gateway-only like OpenRouter, reached over the Gemini public API with your own `AIzaSy...` API key. A second route existed from 2.17.0 until this release: Google product OAuth (Antigravity / Cloud Code Assist, `cloudcode-pa.googleapis.com`). **That route has been retired** and is refused locally - see [the retired route section](#the-retired-google-product-oauth-route).
- **Thinking** indicates a reasoning model with a thinking-effort selector exposed in Copilot Chat. MiniMax M2.7 does not expose a thinking selector. **MiniMax M3 exposes a "Thinking Effort" selector** (None / High / Max) that maps to the upstream `reasoning_split` boolean - see [reasoning.md](reasoning.md). **MiniMax M3.1 Flash Preview cannot switch reasoning off**, but its depth is tunable: its selector offers five levels (Low / Medium / High / Extra high / Max) forwarded verbatim as the upstream `reasoning_effort` field. Its upstream answers HTTP 400 (`requires adaptive thinking`) to `reasoning_split: false`, `thinking.type: "disabled"` and `reasoning_effort: "none"`, so AIFlowBridge rewrites those off signals on both the gateway and the Copilot Chat path and logs a line when it does; the picker cannot produce one because it offers no `None`. The `aiflowbridge.providers.minimax.reasoningEffort` setting is the fallback when the selector is untouched (`max`, the upstream default, otherwise).
- **Z.ai and MoonshotAI are gateway-only**, like OpenRouter and Google AI Studio: no Copilot Chat picker entry, reached from Kilo Code / Continue / `curl` through `http://127.0.0.1:8787/v1`. GLM 5.3 and Kimi K3 always reason and cannot be switched off, so a request asking for no reasoning would be rejected upstream. **The gateway rewrites those signals to thinking-on for you** before forwarding: `thinking.type: disabled`, `reasoning_split: false` and `reasoning_effort: none` are upgraded, and an INFO line says so. This applies to every model declared `requiresThinkingParam` in the registry, not just the two above, so you no longer have to remember which model forbids the off switch.
- Configure the proxied vision model with `AIFlowBridge: Set vision proxy model` or via `aiflowbridge.vision.copilotVisionModel`.
- **OpenRouter** is exposed through the OpenAI-compatible gateway only (port 8787), not through the Copilot Chat picker. The 100+ model ids listed at [openrouter.ai/models](https://openrouter.ai/models) are ALL reachable: pass any of them verbatim in the `model` field of a request to `http://127.0.0.1:8787/v1/chat/completions` and the gateway forwards the call to `openrouter.ai/api/v1/chat/completions` unchanged. The bundled `models.json` ships the 15 entries that were on the free tier at the snapshot date (`nvidia/nemotron-3-ultra-550b-a55b:free`, `nvidia/nemotron-3.5-lightning:free`, `nvidia/nemotron-3-super-120b-a12b:free`, `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free`, `google/gemma-4-31b-it:free`, `google/gemma-4-26b-a4b-it:free`, `qwen/qwen3.8-27b:free`, `cohere/north-mini-code:free`, `poolside/laguna-s-2.1:free`, `poolside/laguna-xs-2.1:free`, `thinkingmachines/inkling:free`, `thinkingmachines/inkling-small:free`, `dots-studio/dots-3-note-preview:free`, `inclusionai/ling-3.0-flash-sante:free`, `liquid/lfm-2.5-2.6b:free`) - so the dashboard always shows $0 for them. The free tier rotates: an id that leaves it is purged at the next refresh, and a new one is simply reachable verbatim without a registry change. **All other OpenRouter model ids work exactly the same way** - they are not "limited to the bundled list". Adding a non-bundled id is optional and only changes the dashboard experience (it appears in `GET /v1/models`, you can attach a `pricing` block). The Vision / Native columns do NOT apply to OpenRouter since the gateway forwards image parts unchanged to OpenRouter and each upstream model decides whether to handle them natively. See the [OpenRouter section](#openrouter-100-models-via-a-single-openai-compatible-endpoint) below for setup, the bundled flagship table (with their confirmed capabilities), and the indicative tariff.

## OpenRouter (100+ models via a single OpenAI-compatible endpoint)

[OpenRouter](https://openrouter.ai/) is a meta-provider that fronts 100+ models from OpenAI, Anthropic, Google, Meta, Mistral, DeepSeek, Alibaba, and others behind one OpenAI-compatible endpoint (`https://openrouter.ai/api/v1`).
It honours the Chat Completions spec, accepts a standard `Authorization: Bearer <key>` header, and streams SSE the same way every other OpenAI-compatible vendor does.
No protocol adapter is required - it plugs into AIFlowBridge the same way DeepSeek or MiniMax do.

### Setup

1. **Get an API key** from [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys).
2. **Store it** - OpenRouter is the one vendor with no `Set API Key` command, because it has no provider class and lives purely on the gateway path. Three equivalent options:

   ```
   # Environment variable (wins over the file)
   export AIFLOWBRIDGE_OPENROUTER_API_KEY=sk-or-v1-...
   # ... or the bare name the resolver also accepts
   export OPENROUTER_API_KEY=sk-or-v1-...

   # Or <storageDir>/secrets.json, chmod 600
   { "openrouter.apiKey": "sk-or-v1-..." }
   ```

   `aiflowbridge.providers.openrouter.apiKey` is **not** a declared setting: use one of the two options above.
The VS Code extension accepts both. The registry does declare an OpenRouter secret slot, but no command writes it, which is why there is no `OpenRouter: Set API Key` command.

3. **Restart the gateway** so the new vendor is picked up. The gateway advertises the 15 free-tier models below in `GET /v1/models`. The other 100+ models are reachable by name - set the model id in your OpenAI-compatible client (Kilo Code picker, Continue config, `curl -d '{"model": "..."}'`) and the gateway forwards the call verbatim.

### Bundled free-tier subset (15 of 100+, all free tier)

The bundled registry ships 15 recent free-tier models on OpenRouter (pricing = $0 / $0 per 1M tokens for all 15).
They appear in `GET /v1/models` and the dashboard reads their `pricing` block to compute "Est. cost" - in their case, the dashboard always shows $0. **Capabilities shown below apply only to these 15 entries** - the full 100+ catalog at [openrouter.ai/models](https://openrouter.ai/models) handles them per its own documentation; consult the upstream listings for any model id not in this table.
All data below was pulled from `https://openrouter.ai/api/v1/models` (October 2026 snapshot).

| Model id (use verbatim in `model` field)                                  | Context window | Output cap | Vision | Reasoning | Tool calling |
| ------------------------------------------------------------------------- | -------------- | ---------- | ------ | --------- | ------------ |
| `cohere/north-mini-code:free` (30B MoE, 3B active)                        | 256 000        | 64 000     | No     | Yes       | Yes          |
| `dots-studio/dots-3-note-preview:free` (280B MoE, 16B active)             | 512 000        | 460 800    | Yes    | Yes       | Yes          |
| `google/gemma-4-26b-a4b-it:free` (25.2B MoE, 3.8B active)                 | 262 144        | 32 768     | Yes    | Yes       | Yes          |
| `google/gemma-4-31b-it:free` (30.7B dense multimodal)                     | 262 144        | 32 768     | Yes    | Yes       | Yes          |
| `inclusionai/ling-3.0-flash-sante:free`                                   | 262 144        | 32 768     | No     | Yes       | Yes          |
| `liquid/lfm-2.5-2.6b:free` (2.6B dense)                                   | 65 536         | 8 192      | No     | Yes       | Yes          |
| `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` (30B MoE, 3B active) | 256 000        | 65 536     | Yes    | Yes       | Yes          |
| `nvidia/nemotron-3-super-120b-a12b:free` (120B MoE, 12B active)           | 262 144        | 235 929    | No     | Yes       | Yes          |
| `nvidia/nemotron-3-ultra-550b-a55b:free` (550B MoE, 55B active)           | 1 000 000      | 65 536     | No     | Yes       | Yes          |
| `nvidia/nemotron-3.5-lightning:free`                                      | 1 000 000      | 65 536     | No     | Yes       | Yes          |
| `poolside/laguna-s-2.1:free`                                              | 262 144        | 32 768     | No     | Yes       | Yes          |
| `poolside/laguna-xs-2.1:free`                                             | 262 144        | 32 768     | No     | Yes       | Yes          |
| `qwen/qwen3.8-27b:free` (27B dense)                                       | 262 144        | 235 929    | Yes    | Yes       | Yes          |
| `thinkingmachines/inkling:free` (1M context)                              | 1 048 576      | 262 144    | Yes    | Yes       | Yes          |
| `thinkingmachines/inkling-small:free` (1M context)                        | 1 048 576      | 262 144    | Yes    | Yes       | Yes          |

**Using a non-bundled OpenRouter model:** the same gateway path works - no AIFlowBridge update needed. Three options:

1. **Use one of the 15 bundled ids verbatim** (the IDs above are exact OpenRouter strings).
2. **Add the unknown id to `aiflowbridge.userModels`** with `family: "openrouter"`. The gateway synthesizes a virtual provider with `vendors.openrouter.baseUrl` and the new id is now visible in `GET /v1/models`. Attach a `pricing` block to get an "Est. cost" tariff in the dashboard.
3. **Override the bundled registry** via `<globalStorageUri>/models.json` or `<workspaceFolder>/.vscode/aiflowbridge.models.json` if you want the new id to ship as part of a curated registry tier.

In all three cases, the gateway forwards the model id verbatim to `openrouter.ai/api/v1/chat/completions` - AIFlowBridge does not translate, alias, or rewrite it.

### Caveats

- **Free tier is rate-limited**: OpenRouter caps free-tier traffic per IP/account. For heavy use, attach a paid key and pay per token - or switch to the direct DeepSeek / MiniMax / Xiaomi vendors. The free tier is meant for exploration, not production load.
- **Rate limits** are OpenRouter-side and stricter than direct vendors. Documented at [openrouter.ai/docs#limits](https://openrouter.ai/docs). AIFlowBridge does not add a retry layer; on 429 the client is expected to back off.
- **Attribution headers** are added automatically by the gateway on every OpenRouter request: `HTTP-Referer: https://aiflowbridge.dev v<semver>` and `X-Title: AIFlowBridge v<semver>`. OpenRouter asks for these so requests are eligible for the free-tier reliability track. The implementation lives in `src/aiflowbridge/gateway/openrouter-headers.ts` and is unit-tested in `tests/integration/openrouter.smoke.test.ts`.
- **Adding new OpenRouter models** at runtime: use **`AIFlowBridge: Add a custom model`** (the OpenRouter choice is now listed alongside MiniMax / DeepSeek / Xiaomi), or add an entry to `aiflowbridge.userModels` with `family: "openrouter"`. The gateway forwards the call regardless of whether the model id appears in the bundled registry.

### Pricing

All 15 bundled models are **free** on OpenRouter's free tier (USD 0.00 / USD 0.00 per 1M tokens, per the OpenRouter `/v1/models` snapshot).
The dashboard's "Est. cost" column therefore always shows $0 for these entries.
For non-bundled model ids, the dashboard does not show a tariff unless you supply a `pricing` block in the `aiflowbridge.userModels` entry.
Override per-profile via `aiflowbridge.providers[].pricing` if you have a custom OpenRouter plan or want to budget against a paid upstream model.

## Z.ai GLM (GLM 5.3 flagship and multimodal models)

Z.ai exposes frontier reasoning and multimodal models through an OpenAI-compatible endpoint (`https://api.z.ai/api/paas/v4`).
Like OpenRouter and Google AI Studio, Z.ai is a **gateway-only vendor (Path B)**: it is reached from Kilo Code, Continue, JetBrains AI Assistant, Open WebUI, and `curl` through `http://127.0.0.1:8787/v1`, not from the Copilot Chat picker.

### Setup

1. **Get an API key** from [z.ai/manage-api/apikey](https://z.ai/manage-api/apikey).
2. **Store it**:
   - **VS Code extension**: `Ctrl+Shift+P` -> `Z.ai GLM: Set API Key` -> paste your key. Revoke with `Z.ai GLM: Clear API Key`.
   - **Standalone**: set `AIFLOWBRIDGE_ZAI_API_KEY` (or `ZAI_API_KEY`) in the environment, or add `"zai.apiKey": "..."` to `<storageDir>/secrets.json` (chmod 600).
3. **Use it**: send completion requests with `model: "glm-5.3"`, `"glm-5.3-flash"`, or `"glm-5.3-flashx"`. All three ids appear in `GET /v1/models`.

### Models and endpoints

- **`glm-5.3`**: Flagship reasoning model, 1M context, 131 072 max output, text-only input ($1.40 / $4.40 per 1M tokens).
- **`glm-5.3-flash`**: Multimodal model (image, video, file input), 1M context, 131 072 output ($0.15 / $0.50 per 1M tokens).
- **`glm-5.3-flashx`**: High-efficiency multimodal reasoning model, 1M context, 131 072 output ($0.37 / $1.25 per 1M tokens).

Notes:

- **Thinking cannot be disabled**: On GLM 5.3 models, reasoning is always active. Sending `thinking.type: "disabled"` causes the upstream API to reject the request with HTTP 400. To adjust reasoning intensity, pass `reasoning_effort` (`low`, `high`, `max`; default `max`).
- **Coding Plan endpoint**: The default baseUrl is the pay-as-you-go endpoint (`https://api.z.ai/api/paas/v4`). If you subscribe to the Z.ai GLM Coding Plan, set `aiflowbridge.providers.zai.baseUrl` to `https://api.z.ai/api/coding/paas/v4` in `settings.json`.

## MoonshotAI Kimi (Kimi K3 and K2.7 Code models)

MoonshotAI provides the Kimi series of reasoning and coding models via an OpenAI-compatible endpoint (`https://api.moonshot.ai/v1`).
MoonshotAI is a **gateway-only vendor (Path B)** reached through `http://127.0.0.1:8787/v1`.

### Setup

1. **Get an API key** from [platform.kimi.ai/console/api-keys](https://platform.kimi.ai/console/api-keys).
2. **Store it**:
   - **VS Code extension**: `Ctrl+Shift+P` -> `MoonshotAI Kimi: Set API Key` -> paste your key. Revoke with `MoonshotAI Kimi: Clear API Key`.
   - **Standalone**: set `AIFLOWBRIDGE_MOONSHOT_API_KEY` (or `MOONSHOT_API_KEY`) in the environment, or add `"moonshot.apiKey": "..."` to `<storageDir>/secrets.json` (chmod 600).
3. **Use it**: send completion requests with `model: "kimi-k3"`, `"kimi-k2.7-code"`, `"kimi-k2.7-code-highspeed"`, or `"kimi-k2.6"`. All four ids appear in `GET /v1/models`.

### Models

- **`kimi-k3`**: Flagship multimodal reasoning model (text, image, video), 1M context window, configurable `reasoning_effort` (low / high / max) ($3.00 / $15.00 per 1M tokens).
- **`kimi-k2.7-code`**: Specialized coding model, 262 144 context window ($0.95 / $4.00 per 1M tokens).
- **`kimi-k2.7-code-highspeed`**: Low-latency coding tier, 262 144 context window ($1.90 / $8.00 per 1M tokens).
- **`kimi-k2.6`**: Versatile multimodal reasoning and non-reasoning model, 262 144 context window ($0.95 / $4.00 per 1M tokens).

Notes:

- **Legacy Kimi models**: The `kimi-k2` and `kimi-k2.5` series have been retired upstream and are purged from the catalog.

## Google AI Studio via API key (BYOK, pay-as-you-go)

**This is the default route on 2.17.0+ and is the only route verified to work in the field**, for every Google account. It needs no programme enrolment and no OAuth.
Bring-your-own Gemini API key, point at the public Gemini API, pay only what you consume on the GCP project tied to the key.

Authentication is an `x-goog-api-key: AIza...` header on every request (the native Gemini surface accepts the key only via `x-goog-api-key` or a `?key=...` URL parameter - the `Authorization: Bearer` form is reserved for OAuth 2.0 access tokens, so sending an `AIzaSy...` key under Bearer returns `401 UNAUTHENTICATED`).
By default the gateway targets the **native Gemini surface** (`/v1beta/models/{model}:generateContent` and the streaming `:streamGenerateContent?alt=sse` variant).
There is no transparent fallback to the OpenAI-compatible surface (`/v1beta/openai/chat/completions`) - the gateway always translates the OpenAI Chat Completions request into the native envelope (`toGeminiNativeRequest` in `src/aiflowbridge/gemini/gemini-native.ts`) and reshapes the native SSE frames back into OpenAI chunks before replying to the client.
No OAuth tokens - one shot works exactly like the other direct vendors.

Why native-first instead of OpenAI-compat: Google's OpenAI-compat surface is feature-gated per GCP project and returns 429 with 0 quota on projects that have not enabled the openai-compat feature (common for newer projects).
The native surface is the canonical, always-enabled path with the same free-tier budget as the SDK Python / curl examples in Google's docs.

**Billing**: the key is linked to a GCP project. Calls count against that project's pay-as-you-go counter, NOT against any AI Studio Pro subscription.
This is precisely the same billing surface as `curl https://generativelanguage.googleapis.com/...` from a shell on a machine with `GOOGLE_API_KEY` set - AI Studio Pro is a separate Web subscription that has no impact on the API key path.
Without a card on the GCP project, Gemini 3.8 / 3.7 / 3.6 Flash still run on the **free tier** of the public API (RPM/RPD caps apply).
Tariffs (USD, pay-as-you-go against the GCP project): $0.30 / 1M input, $2.50 / 1M output, with the 1M context window and image input enabled on all three bundled ids.

Setup:

1. **Create an API key** at <https://aistudio.google.com/apikey> (one-click in the API key tab).
2. **Store it**:
   - **VS Code extension**: `Ctrl+Shift+P` -> `Google AI Studio: Set API Key (BYOK pay-as-you-go)` -> paste `AIzaSy...`. Stored in `SecretStorage`. Override the lookup slot per VS Code profile.
   - **Standalone**: `aiflowbridge-server auth googleaistudio setApiKey <AIzaSy...>`. Stored in `<storageDir>/secrets.json` (chmod 600). Revoke with `aiflowbridge-server auth googleaistudio clearApiKey`. The environment variable `AIFLOWBRIDGE_GOOGLEAISTUDIO_API_KEY` (or `GOOGLEAISTUDIO_API_KEY`) is also recognized and takes priority over the file.
3. **Use it**: any OpenAI-compatible client on `http://127.0.0.1:8787/v1` with `model: "gemini-3.8-flash"` (or `"gemini-3.7-flash"` / `"gemini-3.6-flash"` / `"gemini-flash-latest"` / `"gemini-flash-lite-latest"`). All five ids appear in `GET /v1/models`.

Notes:

- The bundled default `vendors.googleaistudio.baseUrl` is `https://generativelanguage.googleapis.com/v1beta`. Synthesized Gemini profiles are tagged `kind: 'openai-compat'` and still take the native-surface path (`buildGeminiNativeUpstreamRequest`: OpenAI-to-native envelope translation, native SSE reshape, `x-goog-api-key` auth) because the host matches - the generic relay path is never used for Gemini.
- The gateway resolves the effective base URL from a 4-tier precedence chain (settings `aiflowbridge.providers.googleaistudio.baseUrl`, workspace registry override, globalStorage registry override, bundled default). `AIFlowBridge: Migrate Google AI Studio off the retired OAuth route to the Gemini API` reads that chain to report WHICH tier still carries a retired value.
- Only the `vendors.googleaistudio` key carries a route signal (`GOOGLEAISTUDIO_ROUTE_VENDOR_KEYS`, `src/aiflowbridge/googleai-studio-route.ts`). `vendors.antigravity` is metadata-only and selects nothing.
- The migration command reads the setting back after writing it. If the window does not serve `aiflowbridge` (a configuration scope that does not include it), the write sticks nowhere, so the command reports it and names the registry override to edit instead.
- Like OpenRouter, this vendor is gateway-only: it does not appear in the Copilot Chat picker (AP-013). Kilo Code, Continue, JetBrains AI Assistant, Open WebUI, and `curl` reach the Gemini ids via the gateway.

## The retired Google product OAuth route

> **Naming.** The route retired in this release was the OAuth transport against `cloudcode-pa.googleapis.com`, the Cloud Code Assist surface. The project called it "Antigravity OAuth" in places because it targeted the Antigravity product's quota. "Antigravity" here is the historical internal name of that one route, not a general identity for Google's products.

Between 2.17.0 and this release, AIFlowBridge shipped a second Google route that needed no API key: Google OAuth (Authorization Code + PKCE) against `cloudcode-pa.googleapis.com`, intended to spend the quota attached to the user's Google AI Pro/Ultra subscription.
**That route has been removed from the product.** It is not merely disabled or hidden.

### Why

Google documents the Antigravity backend as an internal API for its own IDE features.
The [Google Antigravity FAQ](https://antigravity.google/docs/faq) explicitly states that accessing Antigravity services through third-party software, tools, or unauthorized OAuth piggybacking directly violates Google's Terms of Service and can result in account suspension or termination.
Google officially requires third-party agents and tools to use an API key route (Google AI Studio or Vertex AI) instead.
Furthermore, the Gemini Code Assist consumer-accounts page announced the shutdown of Code Assist extension and Gemini CLI requests for individual, Google AI Pro, and Ultra accounts as of **2026-06-18**.
The Cloud Code Assist setup page documents a separate Standard/Enterprise subscription and describes `cloudcode-pa.googleapis.com` as an internal API for IDE functionality.
No official Google surface was identified that documents AIFlowBridge as a supported client or that converts a consumer Pro/Ultra entitlement into a token budget that a third-party gateway may spend.

This is a deliberate product decision: the OAuth transport was implemented in v2.17.0 to explore consumer quota access, but had to be completely retired because accessing these endpoints outside official Google clients is an explicit Terms of Service violation.
The status of each remote error was never determined by the HTTP status alone.

### What a legacy configuration does now

Any profile pointing at the retired host is **refused locally, before any credential resolution and before any upstream request**:

- **HTTP 503** with an OpenAI-shaped error and the stable code `google_product_oauth_unsupported`.
- **No upstream request is sent**, and no browser opens, no callback server binds, no token is refreshed.
- **No partial SSE stream** is opened for a streaming client: the refusal is plain JSON.
- **No implicit fallback to BYOK.** A leftover `AIzaSy...` key on the same profile is not used as a fallback, because switching routes changes what you are billed for. That is a separate, explicit action.
- The profile is also **hidden from `GET /v1/models`**, so no client picker offers a model that always fails.

The refusal message names the retired transport, states that nothing was sent, and points at the Gemini API as a separate route that may incur charges.
It deliberately does **not** suggest that creating or linking a GCP project repairs the integration: no official Google surface documents that as a remedy.

The `AIFlowBridge: Connect to Google AI Studio (Antigravity OAuth)` command id is retained as a stub that explains the retirement without touching the network, so a stale keybinding fails with an explanation instead of "command not found".
It is hidden from the Command Palette.

### Cleaning up the local credentials

`AIFlowBridge: Delete local Google product OAuth credentials` (standalone: `aiflowbridge-server auth googleaistudio --logout`) removes the legacy `antigravity` slot from `<globalStorageDir>/secrets.json`.
The purge is local, selective (your API keys and every other vendor's key are untouched), idempotent, and preserves the store's `0600` permissions.

**This is a local deletion, not a remote revocation.** No token is sent to Google, so it does not revoke the grant at Google.
Revoking a grant at Google is a separate operation on Google's side, performed by the user in their own account settings.

### If you need Google quota

Use the [Gemini API (BYOK)](#google-ai-studio-via-api-key-byok-pay-as-you-go).
It is the only supported Google route, it works for every account, and it bills the GCP project tied to your API key.
Review that project's quotas and billing before enabling it on a paid card.

A future integration against a documented Google Cloud API with an authorized authentication contract is a separate project, not a re-enablement of this route.
Reopening it would require an official, dated Google source, an application-owned OAuth client or other authorized mechanism, a verified working call, and a clear identification of who is billed.

## Token plans vs per-token billing

The dashboard's **Est. cost** column always computes the same formula - `(promptTokens x inputPerMillion + completionTokens x outputPerMillion) / 1_000_000` at the profile's rates - but the meaning of the number depends on how the upstream bills you.
Two cases:

- **Per-token billing** (default): DeepSeek / MiniMax / Xiaomi pay-as-you-go keys, OpenRouter keys, **Google AI Studio API-key (BYOK)** calls billed on the GCP project. The Est. cost is a **real charge estimate**: what the upstream will bill for those tokens.
- **Plan-covered** (token plan or subscription): MiniMax token-plan keys (`tp-*`) and any other upstream you explicitly mark as plan-covered. The Est. cost is an **indicative equivalent**: what the same tokens *would* cost at the profile's pay-as-you-go rates. You pay $0 extra - the plan already covers it.
- **None of the above confuses "AI Studio Pro" subscription with the BYOK API-key route.** AI Studio Pro is a Web product subscription and has nothing to do with the API-key counter on the user's GCP project. A user with AI Studio Pro (and zero card on their GCP project) still pays only what Gemini's free tier allows on the API-key route. A user without AI Studio Pro but with a card on the GCP project still pays per-token on the API-key route. See the [AI Studio via API key](#google-ai-studio-via-api-key-byok-pay-as-you-go) section for the full billing breakdown.

How the dashboard distinguishes them:

- A `plan` badge on the model cell of each plan-covered row in Recent requests, and a `(plan)` suffix on its Est. cost value with an explicit tooltip.
- A billing notice under the headline cards whenever at least one recorded row is plan-covered, with the plan-covered share of the headline total.
- Typing `plan` in the Filters search box narrows to plan-covered rows; `token` narrows to per-token rows.
- CSV / JSON exports carry a `billedTo` column (`token` or `plan`) per row.

How to mark a provider as plan-covered:

- **Explicit (per provider)**: set `"billing": "plan"` on the entry in `aiflowbridge.providers` in `settings.json`. Use this for MiniMax token-plan keys and any other plan-billed upstream. Omit it (or set `"token"`) for pay-as-you-go keys.
- **Nothing is automatic.** A vendor kind or an authentication method never implies plan coverage: a subscription entitlement is not assumed from an OAuth-flavoured transport. The retired Google product OAuth transport used to be stamped `plan` automatically; that stamp is gone with the route.
- **Standalone**: same `providers` array shape in the standalone `<storageDir>/config.json`.

### Xiaomi MiMo: two endpoints, picked from the key

Xiaomi is the one vendor with two distinct upstream endpoints, and AIFlowBridge picks between them from the key prefix instead of asking you to configure anything (`resolveXiaomiBaseUrl()` in `src/config.ts`, mirrored in the gateway at `src/aiflowbridge/gateway/server.ts:2655-2667`):

| Key prefix            | Endpoint used                              | Billing    |
| --------------------- | ------------------------------------------ | ---------- |
| `sk-...`              | `https://api.xiaomimimo.com/v1`            | per token  |
| `tp-...` or `ttp-...` | `https://token-plan-ams.xiaomimimo.com/v1` | token plan |

The configured `aiflowbridge.providers.xiaomi.baseUrl` is therefore only a starting point: whatever host it holds, a `tp-*` key is sent to the token-plan cluster and an `sk-*` key to the pay-as-you-go host.
That is why both values read `https://api.xiaomimimo.com/v1` by default - the choice happens per request.
Override the setting only to point at a regional token-plan cluster (`-sgp`, `-cn`), or at a self-hosted relay: a plain pay-as-you-go key on a cluster endpoint is rewritten back to `api.xiaomimimo.com` and vice versa.

The indicative rates used for the equivalent come from the usual pricing precedence (merged pricing registry, then registry `pricing` block, then family default for user-declared models only) - see [cost.md](cost.md).
For Gemini, the dashboard uses the real upstream public-API rates ($0.30 / $2.50 per 1M for Gemini 3.8 / 3.7 / 3.6 Flash as of 2026-09-04) since the API-key route IS the pay-as-you-go counter.

Notes:

- Like OpenRouter, this vendor is gateway-only: the three Gemini ids do not appear in the Copilot Chat picker (tracked as AP-013).
- Implementation: the pure Gemini translation modules live under `src/aiflowbridge/gemini/` (`gemini-native.ts`, `content-parts.ts`, `json-schema-clean.ts`, `thought-signature-cache.ts`), wired into `GatewayService` (`src/aiflowbridge/gateway/server.ts`). The former Cloud Code envelope and SSE transforms were deleted with the transport they served.
- The retired-transport policy is one pure function, `classifyGoogleTransport` in `src/aiflowbridge/google-transport-policy.ts`, applied by the gateway before credential resolution, before each upstream call, and before each redirect hop.
- Historical telemetry rows recorded on the retired transport are preserved and still readable: they are not rewritten retroactively.

## Why is the model list hardcoded?

The list of officially supported models lives in [`resources/models.json`](../resources/models.json) (with its JSON Schema in [`resources/models.schema.json`](../resources/models.schema.json)) and is **not auto-discovered** from the upstream APIs.
This is a deliberate design choice driven by VS Code's `vscode.lm.registerLanguageModelChatProvider` API.

VS Code requires each model to declare its capabilities at registration time:

- `maxInputTokens` and `maxOutputTokens` (context window)
- `toolCalling` - `true`, `false`, or a numeric limit on simultaneous tools
- `imageInput` - whether the paste-image button appears in Copilot Chat
- `thinking` - whether the thinking-effort selector is exposed
- `requiresThinkingParam` - provider-specific quirks (e.g. DeepSeek's `thinking: { type: "enabled" }`)
- `reasoningEffortLevels` - optional, the reasoning-effort levels the upstream accepts, in ascending order (`low`, `medium`, `high`, `xhigh`, `max` for MiniMax M3.1 Flash Preview). When present, the selector lists exactly those levels and the selection is forwarded as the upstream `reasoning_effort` field; when absent, the selector keeps the None / High / Max entries mapped to `reasoning_split`.

The upstream APIs (`GET /v1/models`) only return `{ id, owned_by, created }`.
They do not expose context window, tool limits, vision support, or thinking support in a usable format.
Without explicit capabilities, VS Code would:

- Hide the image-paste button for vision-capable models
- Expose tool calling for models that don't support it (broken UX)
- Skip the thinking-effort selector for reasoning models
- Allow context overflow with no warning

A bad capability is a worse user experience than a missing model. A hardcoded registry ensures every supported model works end-to-end on day one.
See [architecture.md](architecture.md#model-registry-3-tier) for how to override individual entries.

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

The new model appears in `GET /v1/models` (and therefore in the Kilo Code / Continue pickers and in the dashboard catalog) as soon as the window is reloaded.
For a Path A family (`deepseek`, `minimax`, `xiaomi`) it also shows up in the Copilot Chat picker; for the gateway-only families (`openrouter`, `zai`, `moonshot`, `googleaistudio`) the gateway catalog is the only place it appears (AP-013).
You can edit or remove the entry in your user settings at any time.

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
See [architecture.md](architecture.md#model-registry-3-tier) for the full schema and override rules.
Changes apply to the **next VS Code window reload**.

## Promoting a user model to the official registry

If a user-defined model is widely useful, the recommended path is to add it to the official bundled registry in [`resources/models.json`](../resources/models.json) via a pull request.
The PR will be reviewed for:

- Correct `id` matching the upstream API exactly (use `AIFlowBridge: Add a custom model` or `curl /v1/models` to confirm)
- Correct capabilities (especially image input and thinking)
- Matching `maxInputTokens` / `maxOutputTokens` from the provider's documentation
- Per-model `pricing` block (USD per 1M tokens) - see the `ModelPricing` shape in [architecture.md](architecture.md#model-registry-3-tier)
- Translation key in `src/i18n.ts` (`model.<id>.detail`; `package.nls.json` is manifest-only)
- Entry in the Providers table above
- **Snapshot date** stamped at the top of each affected table (see "Data freshness" below)

The release cadence is opportunistic - no fixed schedule. Tag `v1.x.y` when a meaningful set of changes accumulates.

## Data freshness

Every pricing number and model id mentioned in this document is a **snapshot**, not a live feed.
The data was pulled at release time of the bundled `resources/models.json` and **does not auto-refresh**.

### Snapshot metadata

- Current snapshot date: **2026-10-01**
- Current snapshot version: **AIFlowBridge 2.24.0**
- Primary source (OpenRouter): `https://openrouter.ai/api/v1/models`
- Primary source (direct vendors): the per-vendor pricing pages documented in `vendors.<vendor>.externalUrls` of `resources/models.json`

### Refresh cadence

- Snapshot is regenerated when `resources/models.json` ships a new revision (i.e. on every AIFlowBridge release that touches the model registry).
- Snapshot metadata is stamped next to each affected table or block - look for the `> Data snapshot: YYYY-MM-DD (AIFlowBridge X.Y.Z).` line above the block.
- The `description`, `displayName`, and `keywords` fields in `package.json` also carry this metadata.

### What does NOT auto-refresh

- The 15 bundled OpenRouter free models (table above). Picking a new free flagship requires an explicit registry edit + release.
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
