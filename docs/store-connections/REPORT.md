# Store Connections & Cross-Store Agentic Search — Research Report

**Repo:** `payswapdotorg/unicom-3.0` (public fork-carrier of `zai-org/zcode` 3.16.2 @ `3c5b227`, Apache-2.0)
**Author:** TL (resident orchestrator) · **Status:** approved for implementation · **Replaces:** the report lost to the pod recycle of the previous session (this version re-verifies every seam against the live tree).

---

## 0. The Golden Path (operator's user story, verbatim)

> Start a new task, pick their model, write a prompt such as *"find me the latest yeezy shoes"* — the agent starts the task, outputs thinking traces and a todo list (same as normal zcode tasks), searches across all connected stores, and outputs a list of findings with their links; product pages can be opened in the integrated browser.

Mapping to what zcode **already has** vs. what we must **add**:

| Golden-path step | zcode today | Gap |
|---|---|---|
| Start a new task | `NewTaskButtonGroup`, task composer, task list | ✅ none |
| Pick a model | model settings with the full model list (GLM-5.3, GLM-5.3 Flash, …) | ✅ none |
| Prompt → agent runs | `zcodeAgent` service + agent CLI | ✅ none |
| Thinking traces | ModelTrajectory UI | ✅ none |
| Todo list | `TodoPanel` + agent todo protocol | ✅ none |
| **Search across connected stores** | — | ❌ **`store_search` tool + connectors (this report)** |
| **Store connection management** | — | ❌ connected-stores settings + credential vault |
| Findings list with links | generic tool-call blocks only | ❌ **`StoreSearchToolCallBlock` renderer** |
| Open product page in integrated browser | `EmbeddedBrowserPane`, `onOpenBrowserUrl` seam | ❌ wire finding links → the seam |

**The only real product surface is the middle row: a store-connection tier + one federated search tool + its UI block.** Everything else in the golden path ships with zcode today.

---

## 1. Verified integration seams (every path re-checked in this tree)

1. **Tool registry** — `apps/zcode-cli/packages/core/src/tool/registry.ts` (`ToolRegistry.register(entry: ToolEntry)`, metadata + aliases; `handlers/index.ts` is the builtin wiring site — `websearch.ts` is the canonical model).
2. **Tool-call UI resolver** — `packages/ui/src/ToolCallBlocks/resolveRenderer.ts` maps tool identity → renderer component (`renderers/web-fetch.tsx`, `renderers/search.tsx` are the models; a new `store-search.tsx` plugs in here).
3. **Embedded browser** — `packages/ui/src/EmbeddedBrowserPaneParts.tsx`; the open-url seam is `onOpenBrowserUrl?: (url: string) => void` threaded through `V4WorkspaceChatArea.tsx` (lines 96/159/286/333). Tool blocks receive open-url affordances through this path (the `web-fetch` renderer is the precedent for clickable links).
4. **Credential vault** — `packages/services/src/credential/` (`credentialService.ts`, `credential.ts`, `providers/`). The CLI side persists encrypted credentials under `~/.zcode` (the desktop already solves key storage — we reuse it, never invent our own).
5. **Settings surface** — the desktop settings app is section-based; a "Connected Stores" section follows the existing section pattern (`packages/services/src/setting/`).
6. **Plugin alternative** — `apps/zcode-cli/packages/image-search-plugin` shows the MCP-server extension pattern (`@zcode/image-search-plugin` is an official MCP server package).
7. **Agent CLI bundling** — the desktop runs the agent CLI as a built bundle (`scripts/build-desktop-agent-cli.mjs`); `dev:desktop` rebuilds it automatically on boot, and after any core-CLI change the bundle must be rebuilt (this is the known "bundling trap" — the dev loop handles it, production packaging must re-run the build script).
8. **State files** — zcode persists per-feature JSON state under `~/.zcode` (no sqlite in the CLI; the services layer owns JSON stores). Store-connection records follow this (`stores.json` via a service, not a database).

---

## 2. Platform matrix (live-verified facts only)

| Platform | Product-search surface | Auth | Live-verified evidence | v1 verdict |
|---|---|---|---|---|
| **Shopify** (any storefront) | **Public catalog**: `https://{shop}.myshopify.com/products.json?limit=250` — public on most storefronts; Admin API (`shop.json`, `products`) for merchant tier | none (public) / Admin token (merchant) | FE3 battery: real `shop.json` 401/404 exchanges; wildcard-DNS behavior documented | ✅ **Tier-1 connector (public catalog + merchant tier)** |
| **WooCommerce** | Public `wp-json/wc/v3/products` is readable on many stores; merchant tier = consumer key/secret (live-verified in FE3: `X-WP-Total` counts, `after`/`before` windows) | none / ck+cs | FE3 battery: real `products?per_page=1` + `X-WP-Total` | ✅ **Tier-1 connector** |
| **Etsy** | OpenAPI v3 (`listings/active`, receipts `min_created` epoch-seconds, `Money {amount, divisor, currency_code}`, revenue = `grandtotal`) — **API key required** | x-api-key + OAuth user token | FE3 battery: live 404-on-unauthenticated-user-endpoint behavior probed and documented | ⚠️ **Tier-2 (credential-gated; no anonymous tier)** |
| **eBay** | Browse API (search) — reachable; requires dev account + OAuth | OAuth | F4 probe: endpoints reachable, no credentials | ⚠️ Tier-2 |
| **Amazon** | SP-API Product Search / Catalog — EU endpoint reachable, seller onboarding-gated; **Apify Amazon scrapers** are a working alternative (operator has an Apify key) | SP-API roles / Apify token | F4 probe: SP-API EU reachable; Apify key on file | ⚠️ Tier-2 via **Apify** first (honest, key on file), SP-API later |
| **Whatnot** | **No public API** (private FastAPI behind Cloudflare; `api.whatnot.com` 404s) | — | F4 probe (negative result, documented) | ❌ **No first-class connector — handled via `web_search` + integrated browser, stated honestly in the UI** |
| **Generic web storefronts** | `web_search` + `web_fetch` tools already built into zcode | none | shipped with zcode | ✅ **Free fallback tier, zero work** |

**Design consequence — the two-tier connector model:**

- **Tier 1 (anonymous catalog connectors — ship first):** Shopify public `products.json` + WooCommerce public products. These need **only a store URL** to "connect", which makes the golden path *("find me the latest yeezy shoes")* fully demoable end-to-end with real sneaker storefronts and zero merchant credentials.
- **Tier 2 (credential-gated connectors):** Etsy (API key), eBay (OAuth), Amazon (Apify token). Same connector interface, credentials in the vault.
- **Tier 3 (delegated search):** Whatnot and anything without an API — the agent's answer composes `web_search` findings; the Connected Stores UI marks these platforms "searched via web" honestly rather than faking a connector.

---

## 3. Architecture decision: builtin tool vs. MCP plugin

| | **A. Builtin `store_search` tool** (recommended) | B. MCP-server plugin (`@zcode/store-search-plugin`) |
|---|---|---|
| Registration | `handlers/store-search.ts` + wiring in `handlers/index.ts` + registry entry | MCP server package + per-user MCP config |
| UI | First-class `StoreSearchToolCallBlock` in `resolveRenderer.ts` — findings list with links, per-store status, open-in-browser buttons | Generic `McpToolCallBlock` — JSON-in-a-box unless we also patch the MCP renderer |
| Credentials | Reads the desktop vault directly | Sandboxed in the MCP server; must re-implement vault access |
| Rebuild cost | Agent CLI bundle rebuild (automated in dev loop) | None for core |
| Fan-out, per-store error taxonomy, 10s aborts | Core tool executor patterns reusable (`websearch.ts` model) | Re-implement in server |

**Decision: Option A.** The golden path explicitly demands a rich findings UI with links that open in the integrated browser — that is a per-tool renderer seam (`resolveRenderer.ts`), which only a builtin tool reaches cleanly. The bundling cost is paid once by the dev loop. The MCP-plugin pattern remains the future escape hatch for third-party store platforms (documented in the plugin README pattern).

---

## 4. Federation design (the tool contract)

One tool, all stores — the model sees a single stable contract:

```jsonc
// store_search — registered with aliases ["search_stores", "store_find"]
{
  "query": "yeezy shoes",          // free text; latest-first when the platform allows
  "platforms": ["shopify", "woo"], // optional — default: ALL connected stores
  "max_per_store": 5,              // default 5, hard cap 25
  "sort": "newest"                 // "newest" | "relevance" | "price_asc" | "price_desc"
}
```

**Result shape (what the renderer consumes):**

```jsonc
{
  "ok": true,
  "results": [
    {
      "platform": "shopify",
      "store": "kith",                    // display name
      "store_domain": "kith.com",
      "title": "ADIDAS YEEZY BOOST 350 V2",
      "price": 230.0, "currency": "USD",
      "url": "https://kith.com/products/...",   // opens in the integrated browser
      "image_url": "https://cdn.shopify.com/...",
      "published_at": "2026-09-30T…"       // when available (newest-first proof)
    }
  ],
  "per_store": [
    { "platform": "shopify", "store": "kith", "count": 5, "status": "ok" },
    { "platform": "woo", "store": "example", "count": 0, "status": "ok" },
    { "platform": "etsy", "store": "…", "status": "error", "error": "invalid_credentials", "message": "…" }
  ],
  "notice": "Whatnot has no public API — searched the web instead: 3 links."
}
```

**Rules carried over from the FE3 connector law (all live-proven patterns):**
- Every platform fetch: hard 10s `AbortController`, timeout classified as `timeout`, DNS/classify errors as `unreachable` — **honest per-store status, never silently dropped stores**.
- 401 → `invalid_credentials`; 403 (+scope language) → `insufficient_scope`; 429 → `rate_limited` (+Retry-After); other 4xx/5xx → `platform_error` with the platform's own message surfaced verbatim.
- Pagination capped per store (Shopify `products.json` page-walk cap 3; Woo `per_page=100` cap 3) with an honest `truncated: true` note — never fabricate completeness.
- Fan-out: all connected stores queried **in parallel**; per-store failures never fail the tool call; zero connected stores → the tool answers honestly ("no stores connected — open Settings → Connected Stores") instead of erroring.

---

## 5. Store-connection tier (settings + vault + service)

1. **Service layer** (`packages/services/src/stores/`): connection records (`stores.json` pattern — `{id, platform, domain, label, tier, connectedAt, lastCheckedAt, status}`), CRUD + health-check (`store_search`-adjacent HEAD/probe), owned by a `StoresService` following the existing service patterns.
2. **Credentials** (Tier-2 connectors only): stored through the existing `credentialService` vault; never in `stores.json`; never in renderer memory beyond display names; revocation destroys the vault entry (FE3 law: `credentialsDestroyed` honesty).
3. **Settings UI**: a "Connected Stores" section — platform tiles (Tier-1: URL only → "Connect store"; Tier-2: URL + credential form; Whatnot: honest "no public API — agent will search the web" note), connected list with status + revoke, and the "Test connection" action (runs the connector probe live).

---

## 6. Ordered implementation plan

| # | Deliverable | Files (verified seams) | Depends on |
|---|---|---|---|
| **P0** | **Sandbox deployment** (already in flight): Xvfb :100 + `dev:desktop` + MJPEG viewer on :3000, so the operator watches changes land live in the preview panel | `deploy/sandbox/` (viewer + boot scripts) + `scripts/dev-desktop-env.mjs` (existing) | — |
| **P1** | Connector library port: Shopify public catalog + Woo public catalog + Etsy (FE3 connectors adapted to the CLI core: `apps/zcode-cli/packages/core/src/tool/handlers/store-search/` — `types.ts`, `errors.ts`, `shopify.ts`, `woo.ts`, `etsy.ts`) | FE3 prior art (live-proven) | — |
| **P2** | `store_search` builtin tool: handler + registry wiring + input schema + fan-out executor + result contract; agent prompt/mention awareness so the model knows when to call it | `handlers/store-search.ts`, `handlers/index.ts`, `registry.ts` | P1 |
| **P3** | `StoreSearchToolCallBlock` renderer: findings list (image, title, price, store chip, published date), per-store status strip, links open in the **integrated browser** via the open-url seam | `packages/ui/src/ToolCallBlocks/renderers/store-search.tsx` + `resolveRenderer.ts` | P2 |
| **P4** | Stores service + settings section (connect/disconnect/test, vault-backed credentials, honest tier labels) | `packages/services/src/stores/`, settings section, `credentialService` | P1 |
| **P5** | Provider bring-up in the sandbox (so the golden path runs live): configure a working model provider with the operator's OpenRouter key (a supported zcode provider template) — the agent needs a live model to emit thinking traces | provider settings (desktop UI) | P0 |
| **P6** | End-to-end golden-path battery under Xvfb: connect 2–3 real public Shopify sneaker storefronts (Tier-1, zero credentials) → new task → model → *"find me the latest yeezy shoes"* → thinking + todos + `store_search` fan-out → findings with links → open one in the integrated browser; verified through the live MJPEG view + desktop E2E tooling | everything | P0–P5 |

**What we are NOT building (v1 scope discipline):** Whatnot scraping (no API — honest delegated search instead), Amazon SP-API onboarding (Apify tier first), price/cart/checkout actions (search-only v1), MCP-plugin packaging of the connector (documented as the future third-party path).

---

## 7. Risks & mitigations

- **Agent CLI bundle staleness** (the bundling trap): after core-CLI edits the desktop bundle must rebuild — mitigation: dev loop rebuilds it (`dev:desktop` runs `build-desktop-agent-cli.mjs` on boot); add a bundle-freshness check to the verification battery.
- **Sandbox memory (4G, no swap):** the first `pnpm install` was OOM-killed at default concurrency; mitigation in place — install re-run at `--child-concurrency=2` with the console dev server stopped; the deployment keeps only Xvfb + desktop + viewer resident.
- **Pod recycles wipe everything outside `/home/z/my-project`:** mitigation in place — one-command redeploy script persisted at `my-project/download/zcode-deploy/redeploy.sh`; **every artifact is committed + pushed immediately** (the hard lesson of this session: the first version of this report was lost to a recycle).
- **Storefront `products.json` availability:** some Shopify storefronts disable it / Woo shops close public REST — per-store probe classifies honestly (`platform_error` + hint); the UI never fakes connectivity.
- **Model-provider availability for live tasks:** OpenRouter verified reachable from the sandbox and is a supported zcode provider template; the operator's key is on file (never echoed, vault-only).
- **Whatnot expectations:** the UI states the no-API fact plainly (operator-verified negative result) — delegated web search is the honest answer, never a fake connector.

---

## 8. Verification plan (evidence, not claims)

1. **Connector unit level:** the FE3 negative-path battery re-applied per connector (nonexistent shop, garbage token, timeout, rate-limit) — platform messages surfaced verbatim.
2. **Tool level:** schema validation, fan-out with mixed healthy/broken stores, zero-store honesty answer, cap + `truncated` notes.
3. **UI level:** `StoreSearchToolCallBlock` renders findings + per-store chips; link click routes to the integrated browser pane (E2E assertion on the open-url seam).
4. **Golden path E2E (P6):** the full operator story on the live sandbox deployment, observed through the :3000 MJPEG view — screenshots archived to the worklog.
5. **Gates per landing:** desktop dev build clean (`tsup` + `vite` zero errors), agent CLI bundle rebuilt fresh, no console errors in the renderer.
