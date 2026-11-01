# UNiCOM UI/UX Design Contract

**Authority:** [UI/UX implementation issue #24](https://github.com/payswapdotorg/UniCom/issues/24), subordinate to parent issue #23  
**Design reference:** `prototype/UNiCOM-Interactive-UI-Prototype.html` and the six source screenshots in `references/`  
**Product:** UNiCOM — Commerce Operating System and Commerce Network  
**Implementation:** `payswapdotorg/unicom-3.0` shared React UI and ZCode-derived runtime

## 1. Product design intent

UNiCOM should feel like a focused, capable operating workspace that happens to orchestrate commerce—not like a generic storefront admin, analytics dashboard or chat wrapper.

The central loop remains:

**Goal → Observe → Plan → Simulate → Approve → Execute → Verify → Learn**

The main task workspace stays primary. Commerce destinations—Buying, Opportunities, My Store, Group Buying, Orders & Fulfilment, Network, Connections—are first-class, discoverable destinations within the same application. Existing ZCode task, agent, browser, terminal, provider/model, project, plugin/skill, automation and approval capabilities remain available.

## 2. Visual language from the supplied references

Use the reference screenshots as the visual grammar:

- Dark graphite/charcoal foundation; avoid pure-black backgrounds and high-saturation panels.
- Compact left navigation with grouped destinations, clear active state, small iconography and restrained metadata (counts/status).
- One dominant central content surface with comfortable horizontal padding and a readable maximum width.
- Optional right-side tool dock; the workspace remains useful when the dock is closed.
- Cards are differentiated by subtle surface and border changes, not bright fills or heavy shadows.
- Strong text hierarchy: small section eyebrow, compact page title, muted explanatory copy, then a clear primary action.
- Use dense but readable lists and cards; prefer information-rich compact controls to oversized dashboard tiles.
- Blue is the primary interaction/focus accent; green, orange, red and violet are reserved for meaningful states (ready/success, warning/conditional, danger, special/opportunity).
- Rounded corners are modest and consistent. Avoid oversized pills and decorative gradients.
- Typography should use the existing application font stack and shared design tokens. Do not introduce a second design system.

### Prototype tokens (reference values, not a mandate to hard-code)

The standalone prototype uses these reference values:

| Token | Value |
| --- | --- |
| App background | `#111214` |
| Sidebar | `#1b1c1f` |
| Main panel | `#1b1d20` |
| Secondary panel | `#202226` |
| Raised panel | `#25282d` |
| Border | `#34373d` |
| Soft border | `#292c31` |
| Text | `#eef0f4` |
| Muted text | `#a0a5af` |
| Subtle text | `#727984` |
| Primary blue | `#8db7ff` |
| Success | `#65d6a0` |
| Warning | `#f2ad67` |
| Danger | `#f17b7b` |
| Opportunity accent | `#b8a3ff` |
| Main sidebar width | `244px` |
| Right tool dock width | `296px` |
| Header height | `58px` |
| Standard card radius | `13px` |

Prefer the current shared token system where an equivalent exists. The table records the design reference, not permission to fork app-wide styling.

## 3. Application shell and navigation

### Workspace shell

The target desktop composition is:

1. **Left workspace navigation** — compact, dockable, persistent while in the workspace.
2. **Central workspace** — flexible width; task composer, task transcript, commerce destination or settings content.
3. **Right tool dock** — optional, collapsible dock with Browser and Terminal tabs. The top workspace toolbar exposes both tools, a My Store shortcut, help and dock visibility.
4. **Workspace header** — breadcrumb/title and compact action controls.

The three areas must resize without obscuring primary content. On narrower viewports, side areas collapse into accessible drawers or responsive panels. Do not force the desktop three-column layout onto mobile.

### Logo and sidebar interaction

- The UNiCOM logo/brand control is the left navigation dock/undock control.
- Clicking it changes the sidebar between expanded and docked/collapsed modes without changing the current destination or losing task state.
- Preserve the user's prior width/dock preference across navigation and reload using the application's existing state persistence patterns.
- The docked state must retain accessible labels/tooltips and keyboard navigation.

### Settings is a separate layout state

- Opening Settings removes the **workspace** left navigation pane.
- Settings renders its own grouped settings navigation and content area, following the settings reference.
- A clearly visible **Back to Workspace** action returns to the previous workspace destination.
- Returning restores the prior workspace destination, sidebar dock/width state, open tool dock/tab and active task/pane state.
- Do not leave two competing left navigation systems visible.

### Target navigation information architecture

The prototype is the approved navigation target. The high-level groups are:

**Workspace**
- New Task
- Automations
- Connections
- Marketplace (commerce listings/discovery)
- Plugin Marketplace (extensions and tools)

**Commerce**
- Opportunities
- Buying
- My Store
- Group Buying
- Orders & Fulfilment
- Network Nodes

**Workspace context**
- Projects
- Recent tasks
- Task history / active task state

**Persistent footer**
- My Store summary card: store status and discovery audience
- User/workspace identity
- Settings entry

Important distinction: **Marketplace** is commerce listing discovery; **Plugin Marketplace** is the existing plugin/extension store. They must remain separately labelled and separately routed.

## 4. New Task / Commerce Home

The primary page is a simple, outcome-first entry point. Its central prompt is:

> What would you like to get done?

Include:
- Current workspace/project context.
- Main natural-language composer, connected to the existing task creation/session path.
- Existing model/provider selection, permissions/approval posture, attachments and task controls where supported.
- Quick actions: Find the best offer; Find suppliers; Discover opportunities; Create a group buy; Manage My Store.
- A restrained network/connection status strip.
- An "Orchestrate capabilities" summary to expose relevant capabilities, not a wall of all possible tools.
- A concise activity stream that distinguishes read-only observations, simulations, approvals and completed verified actions.

New Task must continue to create a real application task using the existing runtime; do not substitute a local-only text box.

## 5. Buying workspace

The buying flow gathers only constraints the user actually supplies and makes missing values visible as unknown.

Intent fields:
- Product and variant.
- Size, fit, brand, condition and approved substitutes.
- Destination/geography.
- Currency.
- Maximum **landed total cost**, not just item subtotal.
- Required-by deadline.
- Relevant seller/trust/return preferences.

Offer comparison:
- Merchant/provider and product/variant.
- Item price, shipping, tax/duty and other known charges as separate components.
- Landed total only when all required components are observed and exact.
- Availability and observation time/freshness.
- Delivery estimate and return terms.
- Source/provenance and evidence class.
- Missing/unknown components called out next to the result.

Rules:
- Preserve exact monetary values and one stated currency.
- Unknown shipping/tax/duty means the landed total is unknown/incomparable; never silently treat it as zero.
- Substitutes must be visibly labelled and require user acceptance.
- A conditional opportunity is never displayed as a verified current offer.
- The view should support filter/sort/compare/inspect, but no live purchase is implied by a comparison action.

## 6. Opportunities workspace

The page communicates that UNiCOM evaluates what could happen next, not only what is already listed.

Every opportunity row/card and detail view must clearly expose:

1. Observed facts and their source/time.
2. Changed assumption or intervention from the observed baseline.
3. Predicted outcome, uncertainty and whether it is calculated or only illustrative.
4. Preconditions (participants, merchant confirmation, coupon eligibility, fulfilment, timing, geography or connector capability).
5. Evidence lineage, freshness, expiry and lifecycle status.
6. Consent and authority required; what action remains for the user.

Required actions:
- Inspect details.
- Re-evaluate using current observations.
- Simulate the scenario.
- Compare to the baseline.
- Explicitly opt in to share an eligible generalized opportunity with nodes.
- Revoke/stop sharing where supported.

Evidence states must distinguish **observed**, **conditional**, **predicted** and **recommended**. Never render a predicted saving as guaranteed or a group-buy interest count as a commitment.

## 7. My Store — personal node storefront

### Product concept

**My Store replaces Device as the user's primary commerce destination.** It is a storefront owned by the user's UNiCOM identity, not a representation of the physical computer, phone or node device.

A user should be able to advertise their own products, goods, equipment, services or other eligible assets to other permitted UNiCOM nodes, similar to operating a Jumia store. This is the seller/owner experience; other nodes discover the listing, inspect its terms and may submit an enquiry or proposal within policy.

Do not remove actual device management, pairing or runtime device controls where the underlying product needs them. Replace only the user-facing commerce destination/card/entry with My Store.

### Store overview

The My Store overview contains:
- Store avatar/identity, name and short description.
- Published/paused/private state.
- Selected discovery audience.
- Published/draft/paused/expired listing counts.
- Search, category and listing-type filters.
- Primary **Add listing** action.
- Listing cards with type, price/rate basis, condition, location, quantity/availability, status, freshness/expiry, views/interest and owner controls.
- A node-enquiry inbox/summary.
- Store preview as another authorized node would see it.

### Store discovery audience

A user may choose:
- Trusted nodes.
- All opted-in network nodes.
- Selected nodes only.
- Private draft.

Store audience is about discoverability only. It does not grant a node access to private inventory, customer records, user intent, credentials, transaction authority or unrelated listings. Publishing to real network nodes remains a consequential external action and requires the existing authority/approval path.

### Listing types and required fields

| Listing type | Required/important fields | Time semantics |
| --- | --- | --- |
| **For sale** | Title, category, photos/media, description, condition, one-time price, currency, quantity/stock, location/fulfilment, visibility | Optional listing expiry; item availability must be fresh |
| **For rent** | Title, category, condition, rental rate, currency, rate interval (hour/day/week/month), deposit where applicable, minimum rental period, availability window, location/collection/return terms | Rental start/end or availability window; duration and return are explicit |
| **Permanent swap** | Item offered, condition, item/category wanted, acceptable differences/top-up if permitted, location and exchange terms | No return-by field; exchange is permanent |
| **Temporary swap / loan** | Item offered, condition, wanted return item/terms, exchange window, collection/handback terms | **Mandatory return-by date/time**; form validation blocks publish without it |
| **Free / giveaway** | Item, condition, quantity, location and collection/fulfilment notes | Optional availability/expiry |
| **Wanted / request** | Item/service wanted, variant/specification, acceptable condition, target budget/range, geography, deadline and response preference | Deadline is explicit where supplied; stale requests expire or are revalidated |

A temporary swap and a loan are time-bounded: do not treat them as a permanent swap, and do not permit publish when the return-by date/time is missing or earlier than the exchange start.

### Listing lifecycle and owner controls

Support clear states:
- Draft / Private draft.
- Published / Discoverable.
- Paused / Hidden from discovery.
- Reserved / Under agreed hold (only when a real, authorized reservation exists).
- Closed / Completed or withdrawn.
- Expired / Requires owner review or revalidation.

The UI needs:
- Create.
- Preview before publishing.
- Edit.
- Publish (demo/local state only in fixture mode; live publish requires authority and confirmation).
- Pause/resume without deleting listing data.
- Expire/revalidate.
- Mark closed/withdrawn.
- Delete/hide subject to data-retention rules.

The store-level pause must hide listings from discovery while preserving their records. It must not silently cancel an already agreed rental, swap or sale; those are separate transaction lifecycle records.

### Enquiries and negotiation

The store inbox lists requests from other nodes with:
- Node identity/trust summary, without exposing unrelated private information.
- Listing reference.
- Enquiry type (sale, rental dates, swap proposal, wanted request).
- Proposed terms and time window.
- Received time, status and expiry.

Available actions should follow authority:
- View.
- Draft response.
- Accept/decline/counter-propose (only with a permitted and approved action).
- Ask for more details.
- Report/block.
- Expire/close.

A new enquiry is not an order, reservation, confirmed rental, accepted swap or payment. No messages are sent by simply opening an enquiry or preview.

## 8. Group Buying, Orders & Fulfilment

- Group-buying pages distinguish proposal, opt-in interest, qualified participants, merchant-confirmed terms and commitment. Interest is not a purchase or payment commitment.
- Show target participant count, unit economics basis, prerequisites and expiry.
- Orders & Fulfilment shows only sourced, persisted transaction/order state. Do not fabricate orders or mark a proposal as fulfilled.
- Each action requiring commitment is individually authorized and auditable.

## 9. Network Nodes and Connections

Network Nodes provides a clear view of:
- Nodes known/connected/blocked/unknown.
- Trust and connection state with evidence/freshness.
- What the user has explicitly chosen to share with each audience.
- Which published listings/opportunities are discoverable.
- Revocation/expiry and privacy status.

Connections presents provider/connector readiness at **operation** level where supported. A platform connection for catalogue read does not automatically prove write, order, messaging or listing-publication capability. Surface not_configured, not_supported, insufficient_scope, expired, stale, unavailable and UNKNOWN distinctly.

## 10. Existing Automations and Plugin Marketplace

Reuse existing screens and capabilities; align their framing and navigation with the supplied references rather than rebuilding them.

- Automations: retain schedule/workflow list, enabled/paused state, create/schedule flow, templates and clear empty state.
- Plugin Marketplace: retain category tabs, search, plugin cards, install/enable state, source management and plugin details.
- Plugin Marketplace is for software capabilities/extensions. Commerce Marketplace is for products/assets/services listed by users and merchants.

## 11. Settings and workspace return

The dedicated Settings page follows the reference's grouped left settings navigation and central card/list content. It must be entered as a distinct application layout state, hiding the workspace navigation pane. The visible Back to Workspace action returns to the previous route and restores the prior shell state. Reuse existing settings state; do not fork settings storage.

## 12. Honest state and safety presentation

For every commerce or connector surface:
- Synthetic/demo fixtures have an unmistakable DEMO/SIMULATED label.
- Observed, conditional, predicted and recommended are not interchangeable.
- Unknown is not failure, zero, unavailable or success.
- Pending is not completed.
- A click or submit attempt is not a verified action; writes require read-back.
- Disabled/unavailable controls explain why.
- Consent and authority are visible before any consequential step.
- No real commerce mutation, broadcast, purchase, payment or customer message is authorized by this design issue.

## 13. Responsiveness, accessibility and polish

- Keyboard reachable navigation and every action.
- Visible focus ring using the blue interaction accent.
- Semantic labels for icon-only controls; accessible status announcements for state changes.
- Dialogs manage focus and return focus to the opener.
- Contrast remains readable on dark surfaces; color is never the only status signal.
- Desktop preserves compact left navigation, flexible centre and optional right dock.
- Tablet/mobile collapses dock and sidebar accessibly; content forms become one column; listing cards do not require horizontal scrolling.
- Provide loading, empty, error, unsupported, permission-denied, stale, unknown, draft, paused, expired and success states.

## 14. Do not do

- Do not replace the ZCode runtime or fork a second agent/task lifecycle.
- Do not keep user-facing Device as the commerce destination; My Store is the destination.
- Do not merge Plugin Marketplace with commerce Marketplace.
- Do not use the Meshwork/ZCode name or logo in UNiCOM surfaces.
- Do not make the right tool dock mandatory or remove the terminal.
- Do not hard-code fake connection counts, prices, inventory, orders or savings as live facts.
- Do not publish temporary swaps/loans without return-by date/time.
- Do not bypass capability/consent/approval gates or architecture checks.
