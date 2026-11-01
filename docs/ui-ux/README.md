# UNiCOM Product UI/UX Design Package

**Tracking issue:** [payswapdotorg/UniCom#24](https://github.com/payswapdotorg/UniCom/issues/24)  
**Parent mission:** [payswapdotorg/UniCom#23](https://github.com/payswapdotorg/UniCom/issues/23)  
**Status:** Approved design / TL implementation handoff. The current product UI has not yet been converted.  
**Inspected implementation baseline:** `67d463798e9c98a8b86cef759e462a3386dee372`; design-only commits have since advanced implementation-repo main. TL must refresh HEAD before work.

This is the canonical design-to-implementation package for turning the current ZCode-derived product UI into UNiCOM while preserving its runtime.

## Start here

1. [Design contract](UNiCOM-UI-UX-DESIGN-CONTRACT.md) — visual language, information architecture, screen-by-screen behavior and My Store listing rules.
2. [Implementation map](UNiCOM-UI-UX-IMPLEMENTATION-MAP.md) — current shared React UI/runtime surfaces to reuse and proposed ownership boundaries.
3. [Acceptance matrix](UNiCOM-UI-UX-ACCEPTANCE-MATRIX.md) — 40 browser-visible journeys and regression gates. All are OPEN until accepted on the merged app.
4. [Interactive prototype](prototype/UNiCOM-Interactive-UI-Prototype.html) — dependency-free, locally runnable reference. Open directly in a modern browser.
5. [Prototype usage and limits](prototype/README.md).
6. [Reference screenshot index](references/REFERENCE-SCREENSHOT-INDEX.md) and [contact sheet](references/reference-contact-sheet.webp).

## Design authority

The interactive prototype is a design and interaction reference. The supplied Meshwork/ZCode screenshots establish the visual grammar and reusable page patterns. When a reference has ZCode/Meshwork product naming, the implementation must use UNiCOM branding. Reuse current React runtime, services, state, navigation and shared components; do not create a parallel application.

The source archive `unicom.zip` supplied the six screenshots listed in the reference index. A compact contact sheet is committed here; individual original-resolution screenshots are not yet mirrored into this repository. The reference register is explicit about that limitation.

The prototype contains **local demo data only**. It is not a connected commerce client; it does not call live providers, publish listings, broadcast to nodes, send messages, reserve inventory, order/pay or execute swaps/rentals. Those behaviors must use the canonical service and approval contracts when implemented in the real product.
