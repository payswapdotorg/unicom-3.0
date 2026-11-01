# UNiCOM Product UI/UX Design Package

**Tracking issue:** [payswapdotorg/UniCom#24](https://github.com/payswapdotorg/UniCom/issues/24)  
**Parent mission:** [payswapdotorg/UniCom#23](https://github.com/payswapdotorg/UniCom/issues/23)  
**Status:** Approved design / implementation handoff. This package does not claim that the product UI has been implemented.  
**Inspected implementation baseline:** `67d463798e9c98a8b86cef759e462a3386dee372` (TL must refresh main before dispatch).

This folder is the canonical design-to-implementation package for turning the current ZCode-derived product UI into the UNiCOM experience we approved.

## Start here

1. [Design contract](UNiCOM-UI-UX-DESIGN-CONTRACT.md) — visual language, information architecture, screen-by-screen behavior and My Store listing rules.
2. [Implementation map](UNiCOM-UI-UX-IMPLEMENTATION-MAP.md) — existing UI/runtime surfaces to reuse and proposed ownership boundaries.
3. [Acceptance matrix](UNiCOM-UI-UX-ACCEPTANCE-MATRIX.md) — browser-visible journeys, states and regression gates.
4. [Interactive prototype](prototype/UNiCOM-Interactive-UI-Prototype.html) — standalone, locally runnable design and interaction reference. Open it directly in a modern browser.
5. [Reference screenshots](references/) — the six operator-supplied Meshwork/ZCode UI references and the My Store screen target.

## Reference index

| File | Reference purpose |
| --- | --- |
| [workspace-meshwork-1.webp](references/workspace-meshwork-1.webp) | Existing commerce/workspace view: compact navigation, central work surface and right-side browser dock |
| [workspace-meshwork-2.webp](references/workspace-meshwork-2.webp) | New Task / outcome-first composer and capability overview |
| [workspace-settings-1.webp](references/workspace-settings-1.webp) | Settings inside the workspace shell; use as content hierarchy reference, not as permission to keep workspace navigation visible on Settings |
| [automations.webp](references/automations.webp) | Automation empty state, templates and scheduled task presentation |
| [plugin-marketplace.webp](references/plugin-marketplace.webp) | Plugin Marketplace categories, search, cards and install/enable controls |
| [workspace-settings-2.webp](references/workspace-settings-2.webp) | Dedicated settings navigation and grouped settings controls |
| [my-store-target.webp](references/my-store-target.webp) | UNiCOM My Store screen from the approved interactive design |

The source archive was the six-image operator upload `unicom.zip`. Image references are preserved as optimized WebP copies; the original visual content is unchanged apart from lossy screenshot compression.

## Design authority

The interactive prototype is the primary reference for the approved UNiCOM information architecture and interactions. The supplied screenshots establish the visual grammar and reusable page patterns. When a screenshot has ZCode/Meshwork product naming, the implementation must use UNiCOM branding. The implementation must reuse the current React/ZCode runtime, services, state, navigation and shared component system rather than re-creating them.

The prototype contains **local demo data only**. It is not a connected commerce client and its UI actions are not live network, provider or transaction actions.
