# REVIEW RESPONSE — 2026-10-31

**Responding to:** the operator-side TL progress review dated 31 October 2026
("UniCom TL progress review — 31 October 2026").
**Campaign state at response time:** unicom-3.0 `d3a71259` · UniCom `09a9907`
(both committed-not-pushed; the push needs a PAT — see §4).

---

## 1. The review's evidentiary baseline, and why it is stale

The review states: *"The latest implementation commit I could verify is 29
October 2026"* and cites `c7bda090` (R6) as the latest implementation commit.
That is the **remote GitHub main** of both repos. The campaign's actual head on
2026-10-30 was:

- `unicom-3.0`: `c7bda09 → 4cc530c8 → dcd2cf4d → ed71a38f → d3a71259`
- `UniCom`: `34585f1 → 4b7150a → 72bd2e9 → 523e7fd → 09a9907`

Four commits per repo sit **committed-not-pushed** because no GitHub PAT is
recoverable in this environment (recorded, not excused, since 2026-10-30).
Every "🔴 not yet demonstrated" finding in the review was made against the
pre-R8 remote state. Claim-by-claim:

| Review claim | Evidence at campaign HEAD | Verdict |
|---|---|---|
| "Opportunity network/federation — not demonstrated" | R8 @ `4cc530c8`: `packages/services/src/commerce-harness/federation.ts` (489 lines, `createFederationNode`, receive verdicts, publish results), `opportunity-lifecycle.ts` (531 lines: active/expired/revoked/realized/abandoned, canonical identity via FNV-1a over canonical JSON, reconciliation blocks feeding R7 true/false-savings denominators), `federation-wire.ts`; 29 + 21 tests in the TL battery (249/249) | **STALE** — delivered at fixture tier |
| "No demonstrated browser/computer-use fallback" | R9 @ `4cc530c8`: `browser-transport.ts` (731 lines) + `merchant-execution.ts`; 32 + 24 tests; authority gate refuses BEFORE any page interaction; a click is never proof — read-back decides | **STALE** — delivered at fixture tier |
| "R7 benchmark remains outstanding" | R10 @ `4cc530c8`: `scripts/commerce-harness/run-benchmark.ts` + byte-reproducible `docs/benchmark-r7-2026-10-30.json` (second run diff identical); one real comparator + two labelled simulations; no multiplier claim | **STALE** — delivered at fixture tier |
| "Latest implementation commit 29 October" | `d3a71259` is dated 2026-10-30 | **STALE** |
| "Packaged desktop acceptance was blocked by an upstream Chromium readiness issue" | Overturned `dcd2cf4d` 2026-10-30: production build boots `file://` under Xvfb, live rpc round-trips; then deb `ed71a38f` (150.0 MiB, sha256 `0bd27b03…`) and AppImage `d3a71259` (203.3 MiB, sha256 `af6a4fc4…`), packaged app.asar booted local-live | **STALE** (superseded diagnosis) |
| "Progress tables not updated for R4–R6; no issue-23 progress update" | `docs/SOURCE-OF-TRUTH-2026-10-30.md`, `docs/TL-VERIFICATION-BATTERY-2026-10-30.md`, and four UniCom registry closures — all in the unpushed set | **STALE** |
| "35–40% complete" | Measures the remote-visible state, not the campaign record | See §3 — no counter-percentage is asserted |

None of the above upgrades any tier: R8/R9/R10 are **fixture-tier** deliveries,
and the fixture tier remains the ceiling by issue #23 law.

## 2. Confirmed-valid criticisms — adopted, with reproduction

The review's substantive technical criticisms were re-verified at `d3a71259`
and are **accepted**:

### 2.1 The money boundary defect — REPRODUCED at HEAD

`finding.price.toFixed(2)` projects a JS `number` into the strict decimal
parser's input at three sites:

- `packages/services/src/commerce-harness/planner.ts:232`
- `packages/services/src/commerce-harness/families.ts:126`
- `packages/services/src/commerce-harness/benchmark.ts:241`

Reproduction (node, at the boundary as written):

```
source number 400.005  -> toFixed(2) "400.00"   # silently rounded DOWN into valid money
source number 400.045  -> toFixed(2) "400.05"   # silently rounded UP into valid money
```

`parseMoneyToCents` would have **rejected** `"400.005"` (INV-14: "never parses
silently, never rounds") — but the boundary launders it into `"400.00"` one
step upstream, so the parser never gets the chance. The reviewer's proposed
test ("a value such as `400.005` must not be silently rounded into a valid
price") fails today. Severity is currently latent — live connector payloads
observed so far carry at most 2 decimal places — but it is a violation of the
pipeline's own law and becomes observable the moment any connector emits
sub-cent precision (discount splits, FX-converted prices, computed prices).

**W1 first target:** preserve source monetary values as decimal strings at the
connector boundary (or convert to exact minor units under a currency-aware
policy), plus the boundary test above. Filed as the opening item of W1.

### 2.2 Group-buy counterfactual calculation — CONFIRMED OPEN

R8 delivered the opportunity **lifecycle, federation, and privacy mechanics**
(§1) — including `ShareConsent` ("private unless opted in", the issue #23 W2
default) and `GeneralizedDemandShape` (the generalized projection that travels
the wire, never the private intent; the reviewer's "distribute the opportunity,
not the intent" demand is the implemented shape). But the group-buy family at
HEAD still refuses to predict: *"A group-buy price is not predicted or
simulated"* (`families.ts`, group_buy_threshold family). The reviewer's central
opportunity-engine gap — **calculating and validating** threshold price,
required participants, and expected saving — remains open. That is W2's core,
unchanged by this response.

### 2.3 Other accepted items

- **Landed cost:** shipping/tax/duties remain unobserved; the budget check is
  subtotal-only with INV-10 unknowns recorded. The harness must not claim
  "within total budget" until landed cost is observed. → W1.
- **Merchant write plane:** R9 covers governed fixture-tier merchant
  *execution* (authority gate + read-back verification); the full
  Scenario-4 store-operating workflow (edit/inventory/orders/listings) is
  next-phase scope. → W3/W1 extension.
- **CI enforcement:** fair. Gates run as TL verification batteries recorded
  in-repo, not CI-enforced (CI is documented as not configured). Recorded as a
  governance open gate.
- **Live tier:** owed by law — issue #23 requires fixtures + read-only first;
  the reviewer's Scenarios 1–5 at live tier are exactly the live lane that
  needs separate operator authorization.
- **Push:** the root cause of §1 itself. The PAT open gate stands.

## 3. On the 35–40% figure

The review measures the GitHub-visible remote state. The campaign record —
R2–R10 + packaged-app + installer at fixture/local-live tier, 249/249 battery,
byte-reproducible benchmark — stands materially further along than the remote
shows. **No percentage counter-claim is made here:** that would be exactly the
assertion-without-artifact the evidence-chain law prohibits. What is asserted,
at SHAs, is §1.

The review's substantive conclusion is nonetheless accepted: the fixture tier
is not the product. The two headline delivery obligations it names —
opportunity federation economics and universal browser/computer-use execution —
are precisely the W2/W3 lanes below.

## 4. Next phase — proposed lane structure (awaiting operator approval)

The W1/W2/W3 frame is adopted as the proposed structure, mapped to the
reviewer's five acceptance scenarios:

| Lane | Scope | First concrete target |
|---|---|---|
| **W1 — Commerce truth** | Exact money pipeline end-to-end; genuine product/variant matching; landed-cost correctness; stronger buyer workflow | The reproduced boundary defect (§2.1) + its boundary test |
| **W2 — Opportunity engine & federation** | Real counterfactual calculations (group-buy threshold/participants/expected-saving with merchant-agreement prerequisites); persistent canonical opportunities; consented cross-node publication & matching | The group-buy calculation the current family honestly refuses (§2.2) |
| **W3 — Universal connectors** | Operation-level API/MCP/browser/computer-use selection; governed execution, traces, post-action verification; honest recovery | Raising `browser-transport.ts` from fixture tier toward the live lane, under the same authority-gate-first law |

No lane starts without operator approval; nothing in this response upgrades
any tier. Standing law unchanged: fixture ceiling, privacy gate before the
wire, authority gate before page interaction, INV-10/INV-14/INV-15, no
multiplier claims.

---

*Evidence-chain law: progress claims cite in-repo artifacts at SHAs — this
response cites `4cc530c8`, `dcd2cf4d`, `ed71a38f`, `d3a71259` (unicom-3.0) and
`4b7150a`, `72bd2e9`, `523e7fd`, `09a9907` (UniCom). Worker reports are
dispatch artifacts; only the TL battery recorded in-repo closes a lane.*
