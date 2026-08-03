# Cost

> Part of the [AIFlowBridge documentation](../README.md).
>
> **Data freshness policy.** Every number in this document is a snapshot, not a live feed. Pricing reflects the upstream catalogs as of the **2026-08-03** snapshot, shipped with **AIFlowBridge 2.15.5**. Sources: per-vendor pricing pages for the direct vendors, `https://openrouter.ai/api/v1/models` for OpenRouter entries (mirrored into the bundled `resources/pricing.json` at release time). Refresh cadence: per release. Verify before quoting numbers externally. See [docs/providers.md#data-freshness](providers.md#data-freshness) for the policy and how to pull a fresh snapshot.

AIFlowBridge is **local glue** around paid upstream APIs. It does not replace those APIs and it does not magically lower their per-token prices.
Anything that says otherwise is marketing.

## What AIFlowBridge affects

- **Free vision for Copilot subscribers.** Models that do not accept images (DeepSeek, MiniMax, Xiaomi text-only) handle them via a _vision proxy_. The default vision model is `oswe-vscode-prime`, which is bundled with a GitHub Copilot subscription. If you already pay for Copilot, vision calls cost **$0** through AIFlowBridge instead of paying a vision-capable upstream model.
- **No AIFlowBridge-side markup on token prices.** For the three direct vendors (DeepSeek, MiniMax, Xiaomi MiMo), AIFlowBridge calls upstream APIs directly with your own API keys - the price you see on the provider's dashboard is the price you pay. For **OpenRouter** (which itself fronts 100+ models through a single endpoint), pricing reflects OpenRouter's published rates including their small markup over direct provider prices - this is an upstream-side pricing choice, not an AIFlowBridge fee. The "Est. cost" column in the dashboard uses the bundled indicative tariff for each model and is overridable per-profile via `aiflowbridge.providers[].pricing`.
- **One bill per task, not per provider.** Switching between DeepSeek V4 Flash ($0.27/M input) for boilerplate and MiniMax M3 ($0.30/M input) for the hard stuff happens inside the same Copilot Chat window, with per-request token counts. You avoid paying a single premium model for every interaction.
- **Accurate token counting (v1.2+).** The dashboard and the cost estimate for MiniMax (and future models that exposes tokens count through their API) use the upstream endpoint instead of a `length/4` heuristic. No end-of-month surprise.
- **No subscription, no per-seat fee.** AIFlowBridge itself is free; you only pay the upstream APIs you actually use.

## What AIFlowBridge does NOT do

- Discounts or rebates on upstream pricing
- Free trial credits
- Bundled inference

## Typical monthly spend

For a solo developer using AIFlowBridge (heavy Copilot-style use, ~50 M input + 20 M output tokens):

| Workload                                              | Approx. cost                      |
| ----------------------------------------------------- | --------------------------------- |
| All Xiaomi MiMo V2.5 ($0.10/M in, $0.30/M out)        | $11                               |
| Mixed: 70% MiMo + 30% MiniMax M3                      | $14                               |
| All MiniMax M3 ($0.30/M in, $1.20/M out)              | $39                               |
| All DeepSeek V4 Flash ($0.27/M in, $1.10/M out)       | $36                               |
| Vision-heavy with `oswe-vscode-prime` proxy (Copilot) | **+ $0** - covered by Copilot sub |
| AIFlowBridge itself                                   | **$0** + optional sponsorship     |

**Calculations** (input rate x 50M + output rate x 20M):

| Family / model    | Input rate | Output rate | 50M in | 20M out | Total  |
| ----------------- | ---------- | ----------- | ------ | ------- | ------ |
| Xiaomi MiMo V2.5  | $0.10      | $0.30       | $5     | $6      | $11    |
| DeepSeek V4 Flash | $0.27      | $1.10       | $13.50 | $22     | $35.50 |
| MiniMax M3        | $0.30      | $1.20       | $15    | $24     | $39    |

The cheapest AI stack that still gives you Copilot Chat with image paste is AIFlowBridge + Xiaomi MiMo + the bundled Copilot vision model: at $11/month for heavy use, that's about 60% the price of a Copilot Pro subscription on its own.

## Indicative rates per family

> Source: bundled registry ([`resources/models.json`](../resources/models.json)) and per-vendor pricing pages.

AIFlowBridge ships with indicative per-million-token rates baked into the bundled model registry ([`resources/models.json`](../resources/models.json)) so the dashboard shows non-zero costs out of the box:

| Family      | Input / 1M    | Output / 1M   | Currency | Applies to                                                               |
| ----------- | ------------- | ------------- | -------- | ------------------------------------------------------------------------ |
| DeepSeek    | $0.27 - $0.55 | $1.10 - $2.19 | USD      | V4 Flash, V4 Pro (per-model rates in the registry)                       |
| MiniMax     | $0.30         | $1.20         | USD      | M2, M2.1, M2.1 Highspeed, M2.5, M2.5 Highspeed, M2.7, M2.7 Highspeed, M3 |
| Xiaomi MiMo | $0.10         | $0.30         | USD      | V2 Omni, V2 Pro, V2.5, V2.5 Pro                                          |

These are **estimates**, not a quote.
The actual tariff depends on your plan tier, region (Xiaomi ships separate plans per cluster: `token-plan-ams`, `token-plan-sgp`, `token-plan-cn`), and whether you use token-plan keys (`tp-*`) or pay-as-you-go.
The per-row tooltip on each Est. cost cell shows the rate that was used to compute it.

## Computing the cost per row

The **Est. cost** column shows the cost of each request (or the aggregated total for the row), computed as:

```
cost = (promptTokens * pricing.inputPerMillion
      + completionTokens * pricing.outputPerMillion) / 1_000_000
```

Every model in the registry is auto-synthesized into the gateway catalog with the appropriate rate, so the catalog covers all 14 models without any user input.

## Overriding the pricing

There are three layers, from most permanent to most local:

1. **Workspace override** (`.vscode/aiflowbridge.models.json`) - committed to the project repo, affects only the current workspace, picks up the next time VS Code loads the workspace.
2. **Per-user override** (`<globalStorageUri>/models.json`) - opened via `AIFlowBridge: Edit model registry`, affects all workspaces for the current OS user, picks up on the next VS Code window reload.
3. **Provider override** (`aiflowbridge.providers[].pricing` in `settings.json`) - the most surgical option, lets you change the rate of a single gateway entry without touching the registry. Useful for one-off experiments or per-region billing.

To override the rate for one model only (e.g. Xiaomi on the Singapore cluster, billed in EUR), the easiest path is a globalStorage override of the registry.
See [docs/architecture.md](architecture.md#model-registry) for the full schema and override rules.

User-declared models added via `aiflowbridge.userModels` (or the **AIFlowBridge: Add a custom model** command) inherit the family-level default pricing automatically - so a custom MiniMax-M3 model gets the same indicative rate as the built-in MiniMax M2.7 profile.
Override it the same way by adding a `pricing` block to the synthesized provider entry.

Providers without a `pricing` block show `-` in the Est. cost column, and requests routed through them contribute `0` to the total.

## Bundled pricing snapshot

The model-level `pricing` blocks in `resources/models.json` (covered in [Indicative rates per family](#indicative-rates-per-family)) describe the per-vendor token-plan tariffs used as the family-level fallback when no other source applies.
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
