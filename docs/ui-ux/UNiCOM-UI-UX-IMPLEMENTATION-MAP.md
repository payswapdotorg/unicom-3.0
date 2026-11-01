# UNiCOM UI/UX Implementation Map

**Inspected repo:** `payswapdotorg/unicom-3.0`  
**Inspected main:** `67d463798e9c98a8b86cef759e462a3386dee372`  
**Tracking:** [UniCom issue #24](https://github.com/payswapdotorg/UniCom/issues/24)  
**Warning:** these paths are the current code map discovered during handoff preparation. TL must re-fetch HEAD and confirm no newer implementation before assigning workers.

## 1. Current implementation surfaces discovered

The actual product UI is a shared React application, not a new standalone website. Web and desktop hosts consume the existing shared UI.

| Current path | Existing responsibility / reuse instruction |
| --- | --- |
| `packages/ui/src/App.tsx` | Root application composition, workspace/page state, navigation and shell wiring. TL-owned integration hotspot; do not let multiple workers edit concurrently. |
| `packages/ui/src/app-shell/WorkspaceShellLayout.tsx` | Workspace shell layout including sidebar, chat, terminal and browser pane coordination. Reuse and extend; preserve pane lifecycle/state. |
| `packages/ui/src/WorkspaceSidebar.tsx` | Public workspace sidebar export (currently delegates to ProjectSidebar). Follow the actual ProjectSidebar module path when modifying. |
| `packages/ui/src/SettingsPage.tsx` | Existing settings experience; make its entry/exit match the design contract instead of replacing its settings state. |
| `packages/ui/src/NewTaskButtonGroup.tsx` | Existing New Task entry control; keep it connected to the canonical task creation flow. |
| `packages/ui/src/WorkspaceTerminalToggleButton.tsx` | Existing terminal toggle and keyboard affordance; terminal is required and must remain accessible. |
| `packages/ui/src/settings/PluginStorePage.tsx` | Existing Plugin Marketplace/store page; preserve plugin semantics and align presentation/navigation. |
| `packages/ui/src/settings/AutomationsSection.tsx` | Existing scheduled automation/workflow UI; reuse its state/lifecycle. |
| `packages/ui/src/ToolCallBlocks/renderers/commerce-harness.tsx` | Existing inline commerce-harness result renderer; keep it truthful and reuse its view model. It is not a replacement for full Buying or Opportunities destinations. |
| `packages/ui/src/ToolCallBlocks/renderers/commerce-harness-view/` | Existing commerce result presentation contract/view. Reuse; do not duplicate evidence/offer parsing. |
| `packages/web/src/main.tsx` | Web host bootstrapping of the shared UI; include ordinary-entry web browser acceptance. |
| `packages/desktop/` | Electron shell, tool pane host, terminal, browser and installable desktop build. Preserve existing desktop behavior and release gates. |

The repo also contains canonical commerce services/contracts under `packages/services/src/commerce-harness/` and core tool handlers under `apps/zcode-cli/packages/core/src/tool/handlers/`. UI facts must be projected from those contracts/services, not re-authored in local component state.

## 2. Existing commerce/runtime assets to reuse

The latest source-of-truth record at the inspected baseline reports these modules as delivered at the fixture/contract tier:
- Exact money boundary and landed-total calculation.
- Buyer intent planner and offer evaluation.
- Group-buy counterfactual calculation.
- Persistent opportunity lifecycle and two-node federation fixture.
- Operation-level transport selection and governed browser fallback.
- Merchant execution state separation: recommend/prepare/preview/approve/execute/verify.
- Scenario and R7 benchmark artifacts.

The implementation may expose these through UI, but it must preserve their evidence tier. Fixture/contract demonstration is not a live provider/network claim.

Useful source paths include:
- `packages/services/src/commerce-harness/finding-money.ts`
- `packages/services/src/commerce-harness/offer-evaluation.ts`
- `packages/services/src/commerce-harness/group-buy.ts`
- `packages/services/src/commerce-harness/opportunity-store.ts`
- `packages/services/src/commerce-harness/federation.ts`
- `packages/services/src/commerce-harness/transport-selector.ts`
- `packages/services/src/commerce-harness/browser-recovery.ts`
- `packages/services/src/commerce-harness/merchant-execution.ts`
- `apps/zcode-cli/packages/core/src/tool/handlers/merchant-read.ts`

## 3. UI ownership and proposed boundaries

TL owns the shared shell API, page/route integration, cross-lane state contracts and independent acceptance. Do not assign the same root integration file to multiple workers.

| Lane | Primary ownership | Do not own |
| --- | --- | --- |
| **W1 — Shell/navigation** | App entry/page registry, workspace shell, left-nav dock behavior, Settings layout transition, toolbar and Browser/Terminal dock integration, shared route contract, responsive shell | Buyer domain UI, My Store listing domain UI |
| **W2 — Buyer/opportunities** | Buying intent capture, offer comparison, Opportunities list/detail, evidence and consent displays, group-buy presentation and their focused tests | App.tsx/root route wiring, store owner/listing components |
| **W3 — My Store/network** | My Store overview, listing form/type validation/lifecycle UI, storefront preview, enquiry inbox, node discovery/privacy, connection state presentation; reuse existing Automations and Plugin Marketplace | App.tsx/root route wiring, W2 buyer/opportunity components |

### Integration law

1. TL inventories the actual page/router/state composition and all in-flight work first.
2. W1 publishes a typed, tested page/route/navigation integration contract.
3. W2 and W3 build within pairwise-disjoint feature modules and consume that contract; they must not edit `App.tsx` or W1-owned shell files.
4. TL alone integrates route registration if that is not already covered by W1's contract, resolves merge conflicts and accepts the merged tree.

## 4. Architecture and quality gate

The implementation repo's current source-of-truth record requires the battery and architecture gates to remain authoritative. New source files must be in architecture-managed/adopted modules, with dependency direction declared. The previous campaign explicitly prohibits using `--no-verify` to bypass an architecture blocker.

Before worker code dispatch:
- inspect `AGENTS.md`, `docs/SOURCE-OF-TRUTH-2026-10-31.md`, architecture registries and the current module map;
- identify the approved managed module location for the new React feature modules;
- if an existing UI root is not architecture-managed, use the repo's formal module-adoption process or an already-managed approved surface; do not bypass the hook;
- record each lane's exclusive paths and expected dependencies.

## 5. Host and platform acceptance

The shared React UI must be tested in:
- Web, entered through the normal web app route/entry.
- Desktop, launched as the actual packaged application for desktop-specific shell and panel behavior.

Preserve existing keyboard shortcuts, task/project state, model/provider selection, skills/plugins, automations, browser, terminal, approval surfaces and remote workspace flows. No packaging/release regression is acceptable. A successful browser-only render is not packaged desktop acceptance.
