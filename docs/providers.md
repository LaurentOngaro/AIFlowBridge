# Providers

> Part of the [AIFlowBridge documentation](../README.md).

## Supported models (16 bundled + 100+ reachable via OpenRouter)

| Provider         | Models                                                                                                                                                           | Vision          | Tool Calling |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------ |
| DeepSeek         | V4 Flash, V4 Pro                                                                                                                                                 | Proxied         | Yes          |
| MiniMax          | M2, M2.1, M2.1 Highspeed, M2.5, M2.5 Highspeed, M2.7, M2.7 Highspeed                                                                                             | Proxied         | Yes          |
| MiniMax          | M3                                                                                                                                                               | **Native**      | Yes          |
| Xiaomi           | MiMo V2 Omni                                                                                                                                                     | Native          | Yes          |
| Xiaomi           | MiMo V2 Pro, V2.5 Pro                                                                                                                                            | Proxied         | Yes          |
| Xiaomi           | MiMo V2.5                                                                                                                                                        | **Native**      | Yes          |
| Google AI Studio | Gemini 3.8 Flash, 3.7 Flash, 3.6 Flash (BYOK API key, gateway-only)                                                                                              | **Native**      | Yes          |
| OpenRouter       | [100+ models at `openrouter.ai/models`](https://openrouter.ai/models) - see [OpenRouter section](#openrouter-100-models-via-a-single-openai-compatible-endpoint) | varies by model | Yes          |

Notes:

- All 14 direct-vendor models in the table above expose the image-paste button in Copilot Chat. **Native** models accept images directly. **Proxied** models route the image through a separate vision-capable model that produces a text description, which is then injected into the prompt (see [vision-proxy.md](vision-proxy.md)).
- **Google AI Studio (Gemini 3.8 / 3.7 / 3.6 Flash)** is gateway-only like OpenRouter. Two distinct routes are available; the bundled default uses the BYOK API-key path on `generativelanguage.googleapis.com` (always available), the Antigravity / Cloud Code Assist OAuth path is an opt-in for users with whitelisted Cloud Code Assist tenants. See [Google AI Studio via API key (BYOK)](#google-ai-studio-via-api-key-byok-pay-as-you-go) below for setup, and [Antigravity via Cloud Code Assist OAuth (advanced)](#google-ai-studio--antigravity-via-cloud-code-assist-oauth-advanced) for the Antgravity-side path. Gemini models do not appear in the Copilot Chat picker (see AP-013); Kilo Code / Continue / `curl` reach them via the gateway.
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

The bundled registry ships seven recent flagships - chosen to maximise coverage of the top labs (NVIDIA, OpenAI, Google, Meta, Alibaba) and to ship on the OpenRouter **free tier** (pricing = $0 / $0 per 1M tokens for all seven).
They appear in `GET /v1/models` and the dashboard reads their `pricing` block to compute "Est. cost" - in their case, the dashboard always shows $0. **Capabilities shown below apply only to these seven entries** - the full 100+ catalog at [openrouter.ai/models](https://openrouter.ai/models) handles them per its own documentation; consult the upstream listings for any model id not in this table.
All data below was pulled from `https://openrouter.ai/api/v1/models` (August 2026 snapshot).

| Model id (use verbatim in `model` field)                        | Context window | Output cap | Vision | Reasoning | Tool calling |
| --------------------------------------------------------------- | -------------- | ---------- | ------ | --------- | ------------ |
| `nvidia/nemotron-3-ultra-550b-a55b:free` (550B MoE, 55B active) | 1 000 000      | 65 536     | No     | Yes       | Yes          |
| `openai/gpt-oss-120b:free` (117B MoE, 5.1B active)              | 131 072        | 131 072    | No     | Yes       | Yes          |
| `google/gemma-4-31b-it:free` (30.7B dense multimodal)           | 262 144        | 8 192      | Yes    | Yes       | Yes          |
| `meta-llama/llama-3.3-70b-instruct:free`                        | 131 072        | 16 384     | No     | No        | Yes          |
| `qwen/qwen3-coder:free` (480B MoE, 35B active)                  | 1 048 576      | 262 000    | No     | No        | Yes          |
| `qwen/qwen3-next-80b-a3b-instruct:free` (80B MoE, 3B active)    | 262 144        | 16 384     | No     | No        | Yes          |
| `nvidia/nemotron-3-super-120b-a12b:free` (120B MoE, 12B active) | 1 000 000      | 262 144    | No     | Yes       | Yes          |

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

All 7 bundled flagships are **free** on OpenRouter's free tier (USD 0.00 / USD 0.00 per 1M tokens, per the OpenRouter `/v1/models` snapshot).
The dashboard's "Est. cost" column therefore always shows $0 for these entries.
For non-bundled model ids, the dashboard does not show a tariff unless you supply a `pricing` block in the `aiflowbridge.userModels` entry.
Override per-profile via `aiflowbridge.providers[].pricing` if you have a custom OpenRouter plan or want to budget against a paid upstream model.

## Google AI Studio via API key (BYOK, pay-as-you-go)

**This is the default route on 2.17.0+ and works for every Google account**, including those without Cloud Code Assist / Antigravity CLI access.
Bring-your-own Gemini API key, point at the public Gemini API, pay only what you consume on the GCP project tied to the key.

Authentication is an `x-goog-api-key: AIza...` header on every request (the native Gemini surface accepts the key only via `x-goog-api-key` or a `?key=...` URL parameter - the `Authorization: Bearer` form is reserved for OAuth 2.0 access tokens, so sending an `AIzaSy...` key under Bearer returns `401 UNAUTHENTICATED`).
By default the gateway targets the **native Gemini surface** (`/v1beta/models/{model}:generateContent` and the streaming `:streamGenerateContent?alt=sse` variant).
There is no transparent fallback to the OpenAI-compatible surface (`/v1beta/openai/chat/completions`) - the gateway always translates the OpenAI Chat Completions request into the native envelope (`toGeminiNativeRequest` in `src/aiflowbridge/antigravity/gemini-native.ts`) and reshapes the native SSE frames back into OpenAI chunks before replying to the client.
No OAuth tokens - one shot works exactly like the other direct vendors.

Why native-first instead of OpenAI-compat: Google's OpenAI-compat surface is feature-gated per GCP project and returns 429 with 0 quota on projects that have not enabled the openai-compat feature (common for newer projects).
The native surface is the canonical, always-enabled path with the same free-tier budget as the SDK Python / curl examples in Google's docs.

**Billing**: the key is linked to a GCP project. Calls count against that project's pay-as-you-go counter, NOT against any AI Studio Pro subscription.
This is precisely the same billing surface as `curl https://generativelanguage.googleapis.com/...` from a shell on a machine with `GOOGLE_API_KEY` set - AI Studio Pro is a separate Web subscription that has no impact on the API key path.
Without a card on the GCP project, Gemini 3.8 / 3.7 / 3.6 Flash still run on the **free tier** of the public API (RPM/RPD caps apply).
Tariffs (USD, pay-as-you-go against the GCP project): $0.30 / 1M input, $2.50 / 1M output, with the 1M context window and image input enabled on all three bundled ids.

Setup:

1. **Create an API key** at https://aistudio.google.com/apikey (one-click in the API key tab).
2. **Store it**:
   - **VS Code extension**: `Ctrl+Shift+P` -> `Google AI Studio: Set API Key (BYOK pay-as-you-go)` -> paste `AIzaSy...`. Stored in `SecretStorage`. Override the lookup slot per VS Code profile.
   - **Standalone**: `aiflowbridge-server auth googleaistudio setApiKey <AIzaSy...>`. Stored in `~/.aiflowbridge/secrets.json` (chmod 600). Revoke with `aiflowbridge-server auth googleaistudio clearApiKey`. The environment variable `AIFLOWBRIDGE_GOOGLEAISTUDIO_API_KEY` is also recognized (lowest priority after the file, secret-storage order unchanged).
3. **Use it**: any OpenAI-compatible client on `http://127.0.0.1:8787/v1` with `model: "gemini-3.8-flash"` (or `"gemini-3.7-flash"` / `"gemini-3.6-flash"`). All three ids appear in `GET /v1/models`.

Notes:

- The bundled default `vendors.googleaistudio.baseUrl` is `https://generativelanguage.googleapis.com/v1beta` (BYOK route). The synthesizer tags the synthesized profile `kind: 'googleaistudio'` for this host, so it runs through the native-surface path (`buildGeminiNativeUpstreamRequest`: OpenAI-to-native envelope translation, native SSE reshape, `x-goog-api-key` auth) - the generic `openai-compat` path is never used for Gemini.
- The gateway resolves the effective route from a 4-tier precedence chain (settings `aiflowbridge.providers.googleaistudio.baseUrl`, workspace registry override, globalStorage registry override, bundled default). The `AIFlowBridge: Switch Google AI Studio route` command resolves the effective route before deciding, strips stale `vendors.googleaistudio` and `vendors.antigravity` entries from both override files on switch, and names the source tier in the toast - a stale override can no longer silently point the toggle the wrong way.
- Like OpenRouter, this vendor is gateway-only: it does not appear in the Copilot Chat picker (AP-013). Kilo Code, Continue, JetBrains AI Assistant, Open WebUI, and `curl` reach the Gemini ids via the gateway.

## Google AI Studio / Antigravity via Cloud Code Assist OAuth (advanced)

Gemini 3.8 / 3.7 / 3.6 Flash are reachable through the same local gateway without any API key for users with **whitelisted Cloud Code Assist tenants** - a subset of Google accounts/Cloud projects Google has approved for Antigravity CLI / Cloud Code Assist access.
Authentication uses Google OAuth (Authorization Code + PKCE): tokens are stored in `<globalStorageDir>/secrets.json` (chmod 600) and refreshed automatically; usage is billed to the Google AI plan attached to the account, not per token through AIFlowBridge.

**Switching between routes** - the BYOK (default, `generativelanguage.googleapis.com/v1beta`) and OAuth (advanced, `cloudcode-pa.googleapis.com`) routes share the same model ids but need different upstream credentials.
The Command Palette command `AIFlowBridge: Switch Google AI Studio route (BYOK native surface vs Antigravity OAuth)` toggles `aiflowbridge.providers.googleaistudio.baseUrl` between the two bundled defaults and automatically clears the credentials of the inactive route (revokes OAuth tokens when leaving AGY, clears the API key when leaving BYOK) so stale credentials from the previous route never answer a request meant for the new one.
The change is persisted in `settings.json` and picked up after a `Developer: Reload Window`.

**This route is independent from the BYOK one above.** They share the same model ids and the same downstream OpenAI surface but target different upstream services (`cloudcode-pa.googleapis.com/v1internal:*` with the Antigravity envelope, vs `generativelanguage.googleapis.com/v1beta` with the Gemini native surface that the gateway translates from the OpenAI Chat Completions request).
Both routes coexist in a single install; an account that has Cloud Code Assist whitelisting can pick either.

Setup (one time, opt-in):

1. **Switch the bundled default to the OAuth upstream URL** in `settings.json`:

    ```json
    "aiflowbridge.providers.googleaistudio.baseUrl": "https://cloudcode-pa.googleapis.com"
    ```

    The synthesizer reads the baseUrl host (`cloudcode-pa.googleapis.com`) and automatically tags the profile `kind: 'googleaistudio'` + `billing: 'plan'`. Without this setting the synthesized profile stays on the BYOK route regardless of whether you also went through the OAuth flow.

2. **Connect the OAuth tokens**:
   - **VS Code**: `AIFlowBridge: Connect to Google AI Studio (Antigravity OAuth)` -> the consent URL opens in the default browser. Revoke with `AIFlowBridge: Disconnect from Google AI Studio (Antigravity OAuth)`.
   - **Standalone**: `aiflowbridge-server auth googleaistudio` -> same flow, prints the URL. `--status` shows the account, project, and token expiry. `--logout` revokes. `--probe` and `--list-models` diagnose auth + upstream.

3. **Use it**: point any OpenAI-compatible client at `http://127.0.0.1:8787/v1` with `model: "gemini-3.8-flash"` (or `"gemini-3.7-flash"` / `"gemini-3.6-flash"`). All three ids appear in `GET /v1/models`. The Est. cost displayed is an indicative equivalent ($0.75 / $3.75 per 1M, introductory through 2026-12-31, standard $1.50 / $7.50 from 2027-01-01) - the dashboard marks those rows `plan` because the plan covers the usage. See [Token plans vs per-token billing](#token-plans-vs-per-token-billing) below.

### How the AGY route differs from the BYOK one

- **Auth**: OAuth tokens (VS Code SecretStorage + `secrets.json`) vs `AIzaSy...` API key.
- **Upstream**: `cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse` vs `generativelanguage.googleapis.com/v1beta/models/...:streamGenerateContent`.
- **Gateway code path**: `kind: 'googleaistudio'` -> `buildAntigravityUpstreamRequest` (envelope, SSE transform, async auth, token manager) vs `kind: 'googleaistudio'` on the BYOK host -> `buildGeminiNativeUpstreamRequest` (native envelope, SSE reshape, `x-goog-api-key`).
- **Billing posture**: plan-covered by default (`aiflowbridge.providers.googleaistudio.billing: 'plan'` synthesized when the AGY host is detected) vs per-token, charged against the GCP project's pay-as-you-go counter.

Notes:

- This vendor is gateway-only: the Gemini ids do not appear in the Copilot Chat picker (tracked as AP-013).
- The `vendors.antigravity` entry in `resources/models.json` is metadata-only: it pins the OAuth upstream `baseUrl` and the external URLs so the route switcher and custom-model discovery have a stable reference. No bundled `models[].family` uses `antigravity` today - the OAuth route is selected by setting the `googleaistudio` baseUrl to the `cloudcode-pa.googleapis.com` host, and OAuth routing uses explicit `aiflowbridge.providers[]` entries only. Custom OAuth client overrides are available via the `AIFLOWBRIDGE_GOOGLE_CLIENT_ID` / `AIFLOWBRIDGE_GOOGLE_CLIENT_SECRET` env vars for private Google Cloud tenants.
- Implementation: pure modules under `src/aiflowbridge/antigravity/` (`envelope.ts`, `sse-transform.ts`, `auth.ts`, `token-store.ts`, `pkce.ts`, `project.ts`, `catalog.ts`), wired into `GatewayService` (`src/aiflowbridge/gateway/server.ts`).
- Diagnose an OAuth failure with `aiflowbridge-server auth googleaistudio --probe` (token + project + upstream status + truncated body) before suspecting AIFlowBridge - 9 times out of 10 it's an upstream Cloud Code Assist decision, not our code.

## Token plans vs per-token billing

The dashboard's **Est. cost** column always computes the same formula - `(promptTokens x inputPerMillion + completionTokens x outputPerMillion) / 1_000_000` at the profile's rates - but the meaning of the number depends on how the upstream bills you.
Two cases:

- **Per-token billing** (default): DeepSeek / MiniMax / Xiaomi pay-as-you-go keys, OpenRouter keys, **Google AI Studio API-key (BYOK)** calls billed on the GCP project. The Est. cost is a **real charge estimate**: what the upstream will bill for those tokens.
- **Plan-covered** (token plan, subscription, or OAuth plan): MiniMax token-plan keys (`tp-*`), Google AI Studio / Antigravity via OAuth (Google AI plan, when the AGY baseUrl is configured). The Est. cost is an **indicative equivalent**: what the same tokens *would* cost at the profile's pay-as-you-go rates. You pay $0 extra - the plan already covers it.
- **None of the above confuses "AI Studio Pro" subscription with the BYOK API-key route.** AI Studio Pro is a Web product subscription and has nothing to do with the API-key counter on the user's GCP project. A user with AI Studio Pro (and zero card on their GCP project) still pays only what Gemini's free tier allows on the API-key route. A user without AI Studio Pro but with a card on the GCP project still pays per-token on the API-key route. See the [AI Studio via API key](#google-ai-studio-via-api-key-byok-pay-as-you-go) section for the full billing breakdown.

How the dashboard distinguishes them:

- A `plan` badge on the model cell of each plan-covered row in Recent requests, and a `(plan)` suffix on its Est. cost value with an explicit tooltip.
- A billing notice under the headline cards whenever at least one recorded row is plan-covered, with the plan-covered share of the headline total.
- Typing `plan` in the Filters search box narrows to plan-covered rows; `token` narrows to per-token rows.
- CSV / JSON exports carry a `billedTo` column (`token` or `plan`) per row.

How to mark a provider as plan-covered:

- **Explicit (per provider)**: set `"billing": "plan"` on the entry in `aiflowbridge.providers` in `settings.json`. Use this for MiniMax token-plan keys and any other plan-billed upstream. Omit it (or set `"token"`) for pay-as-you-go keys.
- **Automatic (OAuth)**: `antigravity` and `googleaistudio` kinds are always plan-covered - no setting needed, the gateway stamps every such request as plan.
- **Standalone**: same `providers` array shape in `~/.aiflowbridge/config.json`.

The indicative rates used for the equivalent come from the usual pricing precedence (merged pricing registry, then registry `pricing` block, then family default) - see [cost.md](cost.md).
For Gemini (BYOK route, the bundled default), the dashboard uses the real upstream public-API rates ($0.30 / $2.50 per 1M for Gemini 3.8 / 3.7 / 3.6 Flash as of 2026-09-04) since the API-key route IS the pay-as-you-go counter.
For the Antigravity OAuth route (opt-in via `aiflowbridge.providers.googleaistudio.baseUrl`), the bundled rates are the introductory tariffs ($0.75 / $3.75 per 1M through 2026-12-31, standard $1.50 / $7.50 from 2027-01-01), and the dashboard marks those rows `plan` because the OAuth plan covers them; the equivalent shown is the true pay-as-you-go value of the plan-covered tokens.

Notes:

- Like OpenRouter, this vendor is gateway-only: the three Gemini ids do not appear in the Copilot Chat picker (tracked as AP-013).
- Custom OAuth client overrides are available via the `AIFLOWBRIDGE_GOOGLE_CLIENT_ID` / `AIFLOWBRIDGE_GOOGLE_CLIENT_SECRET` env vars for private Google Cloud tenants.
- Implementation: pure modules under `src/aiflowbridge/antigravity/` (`envelope.ts`, `sse-transform.ts`, `auth.ts`, `token-store.ts`, `pkce.ts`, `project.ts`, `catalog.ts`), wired into `GatewayService` (`src/aiflowbridge/gateway/server.ts`).
- This route is unavailable if your Google account is not whitelisted for Cloud Code Assist; the upstream returns `429 RESOURCE_EXHAUSTED` (a misleading code that actually means "no access") regardless of how much quota you have on AI Studio Pro, MiniMax, etc. The bundling assumes most users will switch to the [BYOK route](#google-ai-studio-via-api-key-byok-pay-as-you-go) instead.
- Diagnose an auth / upstream issue with `aiflowbridge-server auth googleaistudio --probe` (token + project + upstream status + truncated body).

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

- Current snapshot date: **2026-09-05**
- Current snapshot version: **AIFlowBridge 2.18.3**
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
