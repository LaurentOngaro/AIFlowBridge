# Cost

> Part of the [AIFlowBridge documentation](../README.md).
>
> **Data freshness policy.**
> Every number in this document is a snapshot, not a live feed.
> Pricing reflects the upstream catalogs as of the **2026-10-24** snapshot, shipped with **AIFlowBridge 2.26.0**.
> Sources: per-vendor pricing pages for the direct vendors, `https://openrouter.ai/api/v1/models` for OpenRouter entries (mirrored into the bundled `resources/pricing.json` at release time).
> Refresh cadence: per release. Verify before quoting numbers externally. See [docs/providers.md#data-freshness](providers.md#data-freshness) for the policy and how to pull a fresh snapshot.

AIFlowBridge is **local glue** around paid upstream APIs. It does not replace those APIs and it does not magically lower their per-token prices.
Anything that says otherwise is marketing.

## What AIFlowBridge affects

- **Free vision for Copilot subscribers.** Models whose runtime does not pass the image through upstream (all DeepSeek, all MiniMax, and every Xiaomi MiMo model except `mimo-v2.5`) handle it via a _vision proxy_. The default vision model is `oswe-vscode-prime`, which is bundled with a GitHub Copilot subscription. If you already pay for Copilot, vision calls cost **$0** through AIFlowBridge instead of paying a vision-capable upstream model.
- **No AIFlowBridge-side markup on token prices.** For direct vendors (DeepSeek, MiniMax, Xiaomi MiMo, Z.ai, MoonshotAI), AIFlowBridge calls upstream APIs directly with your own API keys - the price you see on the provider's dashboard is the price you pay. For **OpenRouter** (which itself fronts 100+ models through a single endpoint), pricing reflects OpenRouter's published rates including their small markup over direct provider prices - this is an upstream-side pricing choice, not an AIFlowBridge fee. The "Est. cost" column in the dashboard uses the bundled indicative tariff for each model and is overridable per-profile via `aiflowbridge.providers[].pricing`.
- **One bill per task, not per provider.** Switching between DeepSeek V4.1 Flash ($0.30/M input) for boilerplate, Xiaomi MiMo V2.6 Flash ($0.10/M input) for bulk tasks, and MiniMax M3 ($0.30/M input) for reasoning happens inside the same Copilot Chat window, with per-request token counts. You avoid paying a single premium model for every interaction.
- **Accurate token counting (v1.2+).** The dashboard and the cost estimate for MiniMax (and future models that exposes tokens count through their API) use the upstream endpoint instead of a `length/4` heuristic. No end-of-month surprise.
- **No subscription, no per-seat fee.** AIFlowBridge itself is free; you only pay the upstream APIs you actually use.

## What AIFlowBridge does NOT do

- Discounts or rebates on upstream pricing
- Free trial credits
- Bundled inference

## Typical monthly spend

For a solo developer using AIFlowBridge (heavy Copilot-style use, ~50 M input + 20 M output tokens):

| Workload                                                         | Approx. cost                      |
| ---------------------------------------------------------------- | --------------------------------- |
| All Xiaomi MiMo, any V2.5 / V2.6 model ($0.10/M in, $0.30/M out) | $11                               |
| Mixed: 70% MiMo + 30% MiniMax M3                                 | $19.40                            |
| All Z.ai GLM 5.3 Flash ($0.15/M in, $0.50/M out)                 | $17.50                            |
| All DeepSeek V4.1 Flash ($0.30/M in, $1.20/M out)                | $39                               |
| All MiniMax M3 ($0.30/M in, $1.20/M out)                         | $39                               |
| All MiniMax M3.1 Flash ($0.15/M in, $0.60/M out)                 | $19.50                            |
| Vision-heavy with `oswe-vscode-prime` proxy (Copilot)            | **+ $0** - covered by Copilot sub |
| AIFlowBridge itself                                              | **$0** + optional sponsorship     |

**Calculations** (input rate x 50M + output rate x 20M):

| Family / model      | Input rate | Output rate | 50M in | 20M out | Total  |
| ------------------- | ---------- | ----------- | ------ | ------- | ------ |
| Xiaomi MiMo (all)   | $0.10      | $0.30       | $5     | $6      | $11    |
| Z.ai GLM 5.3 Flash  | $0.15      | $0.50       | $7.50  | $10     | $17.50 |
| DeepSeek V4.1 Flash | $0.30      | $1.20       | $15    | $24     | $39    |
| MiniMax M3          | $0.30      | $1.20       | $15    | $24     | $39    |
| MiniMax M3.1 Flash  | $0.15      | $0.60       | $7.50  | $12     | $19.50 |

Every Xiaomi MiMo model in the registry (V2.5, V2.5 Pro, V2.6 Flash, V2.6 Pro, V2.6 Pro UltraSpeed) carries the same $0.10 / $0.30 rate, so the family has a single cost line.

Be honest about where the break-even sits: at this heavy volume (~70M tokens/month) the MiMo bill ($11) is already above a $10 Copilot Pro subscription, and MiniMax M3 or DeepSeek V4.1 Flash ($39) is well above it.
The saving is real when your usage stays lighter than that, when you route bulk tasks to the cheapest model instead of a premium one, or when a free tier (Gemini BYOK within its free quota, the 15 bundled OpenRouter free models, a local Ollama runtime) covers the whole workload.

## Indicative rates per family

> Source: bundled registry ([`resources/models.json`](../resources/models.json)) and per-vendor pricing pages.

AIFlowBridge ships with indicative per-million-token rates baked into the bundled model registry ([`resources/models.json`](../resources/models.json)) so the dashboard shows non-zero costs out of the box:

| Family                                 | Input / 1M    | Output / 1M    | Currency | Applies to                                                                                                                 | Billing posture                                                                                    |
| -------------------------------------- | ------------- | -------------- | -------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| DeepSeek                               | $0.30 - $1.32 | $1.20 - $3.96  | USD      | V4.1 Flash, V4 Pro (per-model rates in the registry)                                                                       | Per-token (real charge)                                                                            |
| MiniMax                                | $0.15 - $0.30 | $0.60 - $1.20  | USD      | M3 (M3.1 Flash carries its own lower rate: $0.15 in, $0.60 out)                                | Per-token (real charge on `sk-*`) / Plan-covered on `tp-*`                                         |
| Xiaomi MiMo                            | $0.10         | $0.30          | USD      | V2.5, V2.5 Pro, V2.6 Flash, V2.6 Pro, V2.6 Pro UltraSpeed (same rate on all five)                                          | Per-token (real charge)                                                                            |
| Z.ai                                   | $0.15 - $1.40 | $0.50 - $4.40  | USD      | GLM 5.3, GLM 5.3 Flash, GLM 5.3 FlashX                                                                                     | Per-token (real charge on `sk-...` / Plan-covered on Coding Plan)                                  |
| MoonshotAI                             | $0.95 - $3.00 | $4.00 - $15.00 | USD      | Kimi K3, Kimi K2.7 Code, Kimi K2.7 Code Highspeed, Kimi K2.6                                                               | Per-token (real charge)                                                                            |
| Google AI Studio (BYOK, default route) | $0.10 - $0.30 | $0.40 - $2.50  | USD      | Gemini 3.8 / 3.7 / 3.6 Flash, Flash-Lite Latest, Flash Latest                                                              | Per-token (real charge on the user's GCP project; INDEPENDENT from any AI Studio Pro subscription) |

**Important disambiguation**: "Google AI Studio Pro" is a Web subscription for the AI Studio UI and is **independent** from the API-key billing path.
Activating or canceling AI Studio Pro does NOT change what you pay for Gemini calls made via `https://generativelanguage.googleapis.com/v1beta` (the BYOK route).
The Google AI Pro/Ultra subscription is a consumer entitlement attached to the Antigravity product; it is **not** a token budget for the Gemini API, and it was never usable from AIFlowBridge: the Google product OAuth route that tried to spend it was retired in this release.
Those calls are charged against the GCP project the API key is attached to - with a card, at the rate above; without a card, on Gemini's free tier (RPM/RPD caps).
Either way, AI Studio Pro has no influence on the API-key surface.

These are **estimates**, not a quote.
The actual tariff depends on your plan tier, region (Xiaomi ships separate plans per cluster: `token-plan-ams`, `token-plan-sgp`, `token-plan-cn`), and whether you use token-plan keys (`tp-*`) or pay-as-you-go.
The per-row tooltip on each Est. cost cell shows the rate that was used to compute it.

## Computing the cost per row

The **Est. cost** column shows the cost of each request (or the aggregated total for the row), computed as:

```
cost = (promptTokens * pricing.inputPerMillion
      + completionTokens * pricing.outputPerMillion) / 1_000_000
```

Every model in the registry is auto-synthesized into the gateway catalog, so the catalog covers all 36 models without any user input.
All 36 of them carry a rate, the cheapest tier included: `MiniMax-M3.1-Flash` is published at $0.15/M in and $0.60/M out.
A bundled model is never given a sibling's rate to fill the gap: the registry is the source of truth for the bundled catalog, so its silence means "no published price", not "price unknown".

The number is a **real charge estimate** for per-token billing, and an **indicative equivalent** for plan-covered usage (token plan or subscription) - the same formula, the same rates, but $0 actually billed.
The dashboard marks plan-covered rows with a `plan` badge and a billing notice under the headline cards; CSV / JSON exports carry a `billedTo` column (`token` / `plan`).
Since 2.23.0 the CSV export also neutralises spreadsheet formula injection: a value opening with `=`, `+`, `-`, `@`, TAB or CR gets a `'` prefix, because RFC 4180 quoting does not stop Excel or LibreOffice from evaluating a quoted field, and the exported `responseSummary` column carries upstream model output.
Mark a provider as plan-covered with `"billing": "plan"` on its `aiflowbridge.providers` entry.
Nothing is inferred from the vendor or the authentication method, so a subscription entitlement is never assumed.
Full details: [providers.md#token-plans-vs-per-token-billing](providers.md#token-plans-vs-per-token-billing).

## Overriding the pricing

There are three layers, from most permanent to most local:

1. **Workspace override** (`.vscode/aiflowbridge.models.json`) - committed to the project repo, affects only the current workspace, picks up the next time VS Code loads the workspace.
2. **Per-user override** (`<globalStorageUri>/models.json`) - opened via `AIFlowBridge: Edit model registry`, affects all workspaces for the current OS user, picks up on the next VS Code window reload.
3. **Provider override** (`aiflowbridge.providers[].pricing` in `settings.json`) - the most surgical option, lets you change the rate of a single gateway entry without touching the registry. Useful for one-off experiments or per-region billing.

To override the rate for one model only (e.g. Xiaomi on the Singapore cluster, billed in EUR), the easiest path is a globalStorage override of the registry.
See [docs/architecture.md](architecture.md#model-registry-3-tier) for the full schema and override rules.

User-declared models added via `aiflowbridge.userModels` (or the **AIFlowBridge: Add a custom model** command) inherit the family-level default pricing automatically - so a custom MiniMax-M3 model gets the same indicative rate as the built-in MiniMax M3 profile.
Override it the same way by adding a `pricing` block to the synthesized provider entry.

Providers without a `pricing` block show `-` in the Est. cost column, and requests routed through them contribute `0` to the total.

## Bundled pricing snapshot

The model-level `pricing` blocks in `resources/models.json` (covered in [Indicative rates per family](#indicative-rates-per-family)) describe the per-vendor token-plan tariffs.
They are also the family-level fallback, but only for **user-declared** models: a model you add yourself and leave unpriced inherits its family's indicative rate, whereas a bundled model the registry leaves unpriced stays unpriced.
A second, finer-grained pricing layer was introduced in 2.15.0 so the dashboard can reflect the actual OpenRouter rates for the 100+ reachable model ids.

- **Source**: OpenRouter public listing (`GET https://openrouter.ai/api/v1/models`), refreshed at each release and on demand by the user.
- **Estimative disclaimer**: prices are indicative, accurate as of the date stamp shown in the dashboard tooltip and on each `Est. cost` cell. Treat as an estimate, not a bill. A few percent of drift between the doc and the bundled JSON is expected and acceptable.
- **How to update**:
  - **End users**: command palette -> `AIFlowBridge: Refresh pricing now`, or the `Refresh prices` button in the dashboard. The fetch hits OpenRouter, writes the result to `<globalStorageUri>/pricing-override.json`, and updates the in-memory pricing registry so the next request and the dashboard tooltips pick up the new rates without a window reload.
  - **Maintainers**: `npm run pricing:refresh` before bumping the version. The script writes `resources/pricing.json` with a fresh `generatedAt` + `aiflowbridgeVersion` stamp, ready to be shipped in the next release.

The dashboard's `Est. cost` tooltip shows a `source: ...` tag so you always know whether the rate is the release-time bundled value, your last user-side refresh, or a registry / family-level fallback.
Open `resources/pricing.json` directly via `AIFlowBridge: Open pricing data` to inspect the bundled rates shipped with the extension.

## Vision-heavy workload saves more

If you paste images frequently, the vision-proxy saves you **the cost of a vision-capable upstream model**.
The Copilot-bundled `oswe-vscode-prime` is included in your Copilot subscription, so image pass-through is free on top of the upstream token cost.

| Workload (with images)                          | Without AIFB (vision-capable upstream) | With AIFB + Copilot vision proxy |
| ----------------------------------------------- | -------------------------------------- | -------------------------------- |
| 50 vision calls/day, 1k input + 500 output each | Add ~$15-30 / month per vision model   | **+$0** (Copilot sub covers it)  |
