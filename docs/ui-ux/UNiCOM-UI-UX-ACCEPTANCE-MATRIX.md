# UNiCOM UI/UX Acceptance Matrix

**Authority:** [issue #24](https://github.com/payswapdotorg/UniCom/issues/24)  
**Design source:** `docs/ui-ux/UNiCOM-UI-UX-DESIGN-CONTRACT.md` and the committed interactive prototype.  
**Status key:** all rows below are **OPEN** until the TL records evidence from the merged implementation. This matrix is a test specification, not a pass report.

| ID | Surface / journey | Required browser-visible assertion | Evidence required |
| --- | --- | --- | --- |
| UIX-001 | App entry | Ordinary application entry loads a UNiCOM-branded workspace; no ZCode/Meshwork product copy leaks into the user-facing chrome | Web screenshot + DOM assertion |
| UIX-002 | Workspace shell | Left navigation, central content and optional right tool dock render without overlap at desktop viewport | Screenshot at reference viewport |
| UIX-003 | Logo dock/undock | Clicking the UNiCOM logo collapses/expands the left navigation; current page/task survives; accessible label and keyboard path work | Interaction trace + before/after screenshots |
| UIX-004 | Browser dock | Browser tab is accessible from toolbar and right dock; dock opens/closes without losing workspace state | E2E trace |
| UIX-005 | Terminal dock | Terminal tab is visible alongside Browser, opens from toolbar/dock and remains usable; terminal commands still flow through the existing safe runtime | E2E trace + existing terminal regression |
| UIX-006 | Settings transition | Settings removes the workspace navigation pane and displays only its own settings navigation/content | Screenshot + DOM assertion |
| UIX-007 | Back to Workspace | Return restores prior page, sidebar expanded/collapsed state, tool dock visibility/tab and task/session context | State snapshot + E2E trace |
| UIX-008 | New Task page | “What would you like to get done?” composer, project context and quick actions render; submit creates an actual existing runtime task, not a demo-only task | E2E trace + task lifecycle assertion |
| UIX-009 | Home quick actions | Best offer, supplier discovery, opportunities, group buy and My Store actions navigate/pre-fill the intended flows | Interaction tests |
| UIX-010 | Buying intent | Product/variant, location, currency, landed-cost limit and optional deadline are captured without fabricated defaults | Form tests + intent object evidence |
| UIX-011 | Offer comparison | Price components, source, time/freshness, delivery/returns and evidence class display accurately | Fixture-driven E2E + render assertion |
| UIX-012 | Unknown costs | Unknown shipping/tax/duty cannot be rendered as zero or a verified landed total; subtotal-only offers are identified as incomparable | Negative tests + screenshot |
| UIX-013 | Opportunities list | Candidate opportunities visibly distinguish observed, conditional, predicted and recommended; list filters/search work | E2E trace + state fixtures |
| UIX-014 | Opportunity details | Facts, changed assumptions, predicted result/uncertainty, prerequisites, evidence lineage, expiry and required consent are all visible | Detail screenshot + DOM assertion |
| UIX-015 | Opportunity controls | Inspect, simulate, re-evaluate, compare and explicit opt-in share/revoke controls have real, policy-respecting behavior | E2E trace; no external side effect |
| UIX-016 | Group buying | Proposal, opt-in interest, target, merchant confirmation and commitment are separate states; interest is never rendered as a committed order | Contract fixture + E2E trace |
| UIX-017 | My Store overview | Store identity, open/paused state, audience, listing counts, search/filter, Add listing, enquiries and listing cards render | Screenshot + E2E trace |
| UIX-018 | Sale listing | One-time price, currency, quantity, condition and location are validated and displayed | Form tests |
| UIX-019 | Rental listing | Rate amount/currency/interval, deposit, minimum period, availability window and return terms are present | Form tests + screenshot |
| UIX-020 | Permanent swap | Item offered and wanted, condition and exchange terms are present; it is not accidentally treated as time-bounded | Form tests |
| UIX-021 | Temporary swap/loan | Exchange window and return-by date/time are required; missing return-by blocks save/publish; invalid earlier-than-start dates are rejected | Negative + positive validation tests |
| UIX-022 | Free/wanted listing | Free listing and wanted/request have distinct form fields, status and presentation | Form tests |
| UIX-023 | Listing lifecycle | Draft, preview, publish-to-demo, edit, pause/resume, expiry/revalidate, close/withdraw and removal update visible state correctly | Full lifecycle E2E |
| UIX-024 | Store privacy | Trusted nodes/all opted-in/selected nodes/private draft audience choices work; discovery does not grant transaction authority or private-data access | E2E + privacy assertions |
| UIX-025 | Storefront preview | Preview shows only currently discoverable/published listings and selected audience; no live broadcast occurs in fixture mode | Screenshot + trace |
| UIX-026 | Enquiry inbox | Enquiry references listing/type/terms/received time; opening it does not send a message or create a transaction | E2E + side-effect assertion |
| UIX-027 | Node discovery | Node trust/connection/privacy status is distinguishable; revoked/expired/unknown states are honest | Fixture E2E + screenshot |
| UIX-028 | Connections | Capability readiness is shown per operation; API read capability does not imply write or publication capability | Contract-backed UI test |
| UIX-029 | Automations | Existing schedule/templates/enable-pause/delete behavior remains discoverable and usable | Existing regression + screenshot |
| UIX-030 | Plugin Marketplace | Existing search/category/detail/install/enable/source behavior remains usable; distinct from commerce Marketplace | Existing regression + screenshot |
| UIX-031 | Commerce Marketplace | Commerce listings discovery is separate from plugin discovery and identifies listing type, seller/store and conditions | Browser E2E |
| UIX-032 | Responsive shell | Sidebar and tool dock collapse accessibly; forms/listing cards remain readable without horizontal page overflow | Screenshots at desktop/tablet/mobile |
| UIX-033 | Accessibility | All controls reachable by keyboard, clear focus, semantic labels, dialog focus handling and announced status changes | Accessibility audit + keyboard trace |
| UIX-034 | Honesty states | Demo, observed, conditional, predicted, recommended, unknown, stale, unavailable, unsupported, permission-denied and pending are not conflated | Fixture matrix + screenshot assertions |
| UIX-035 | Runtime preservation | Task lifecycle, project context, providers/models, approvals, skills/plugins, browser, terminal and workspace behavior still work | Existing preservation/battery results |
| UIX-036 | Architecture gate | New modules follow the dependency graph and managed-module adoption law; no `--no-verify` bypass | Architecture check + pre-push success |
| UIX-037 | Web acceptance | All claimed-present destinations are reached by ordinary app navigation in the running web product | Playwright screenshots/traces |
| UIX-038 | Desktop acceptance | Actual packaged desktop app launches and key workspace/store/settings/terminal journeys work | Packaged app run + screenshots/traces |
| UIX-039 | Regression battery | Typecheck, lint, unit/contract, architecture, CI battery and relevant E2E regressions pass on merged tree | Exact commands, exit codes and commit SHA |
| UIX-040 | No external side effects | No unintended live publish, node broadcast, order, payment, message or reservation occurs during UI acceptance | Network/effect audit + approval log |

## Browser evidence package

The TL acceptance record must include:
- Implementation base SHA and final merged SHA.
- Web/desktop build identity and browser/device viewport.
- Screenshots for New Task, Buying, Opportunities detail, My Store overview, each listing form, node discovery, Connections, Automations, Plugin Marketplace, Settings, and the restored Workspace.
- Playwright/Agent Browser traces for key transitions.
- Exact commands and exit codes for lint, typecheck, tests, architecture and battery.
- Explicit fixture/demo vs live evidence tier.
- Open defects, blocked capabilities and unsupported states.

No row is green solely because a component exists, a unit test passes, a worker says it is complete or a deep link renders. The TL must verify user-visible behavior from the normal application entry on the merged tree.
