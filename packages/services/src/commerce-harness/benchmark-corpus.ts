// ============================================================
// Commerce harness — the R7 benchmark corpus (HARNESS-CONTRACT.md §1 L5 + §3)
// ============================================================
//
// The fixed 10-case intent corpus the R7 benchmark runs: each case is a
// labelled fixture (intent envelope + connected fixture stores + a fixture
// (storeDomain, query) → findings map + the fixture author's omniscient
// ground truth). Never production-reachable: every store domain is
// *.fixture.invalid, every observation is produced by the fixture map, and
// the SAME fixture observations feed every comparator (benchmark.ts) so the
// comparison measures POLICY differences, not data differences.
//
// LAWS (HARNESS-CONTRACT §1 L5 + §2):
//   - INV-10 UNKNOWN: a ground-truth saving that is unknowable in principle
//     (the wait-or-buy class) stays null — never a guessed magnitude; the
//     corpus's expectedSuccess says what the REAL harness must answer, not
//     what any comparator may fake.
//   - INV-14 money: every fixture price is projected ONCE to exact string
//     decimals + an explicit currency (fixtureFinding); cross-currency
//     fixtures exist precisely to score FX-invention as a violation.
//   - INV-51: the fixture tier is a deployment constraint of this benchmark
//     (the campaign authorizes no live provider credentials), never domain
//     semantics.

import type { StoreConnectionRecord } from "../stores/stores.js";
import type {
  CapabilityFailureCode,
  CapabilityObservation,
  ObservedFinding,
  StepExecutor,
} from "./execution.js";
import { COMMERCE_INTENT_UNKNOWN_FIELDS } from "./intent.js";
import type { CommerceIntentEnvelope, HarnessMoney } from "./intent.js";
import type { OpportunityFamilyId } from "./families.js";
import type { ConnectedStoreTarget } from "./plan.js";

// ——— the corpus types (labelled fixture data — never production-reachable) ———

/** What ground truth certifies for one case: the savings lane that ACTUALLY exists. */
export interface BenchmarkGroundTruth {
  /** The one family ground truth certifies as realizable, or null (none is). */
  realizableFamily: OpportunityFamilyId | null;
  /**
   * The true saving the realizable family yields, in the case's baseline
   * currency — or null when the magnitude is unknowable in principle (the
   * wait-or-buy class) or no family is realizable. Null unless
   * realizableFamily is non-null (INV-10 — never a guessed magnitude).
   */
  trueSavings: HarnessMoney | null;
  /** What the REAL harness must answer on task success for this case. */
  expectedSuccess: boolean;
  /** Why ground truth says what it says (fixture-author's omniscient note). */
  note: string;
}

/** One fixture-map entry: what (storeDomain, query) answers when searched. */
export interface BenchmarkFindingFixture {
  storeDomain: string;
  query: string;
  findings: ObservedFinding[];
}

/** One fixture-map error entry: a store that answers a taxonomy failure. */
export interface BenchmarkStoreErrorFixture {
  storeDomain: string;
  code: CapabilityFailureCode;
  message: string;
}

/** One benchmark case: the intent, the connected stores, the fixture map, the truth. */
export interface BenchmarkIntentCase {
  id: string;
  label: string;
  intent: CommerceIntentEnvelope;
  stores: StoreConnectionRecord[];
  findings: BenchmarkFindingFixture[];
  storeErrors?: BenchmarkStoreErrorFixture[];
  groundTruth: BenchmarkGroundTruth;
}

/** The modeled per-step fixture latency — one fixture catalog read (NOT live; the run meta labels the basis). */
export const FIXTURE_STEP_LATENCY_MS = 25;

// ——— the labelled fixture stores / helpers (R5 fixture style, fixture domains only) ———

const ALPHA: StoreConnectionRecord = {
  id: "r7-alpha",
  platform: "bigcommerce",
  domain: "alpha.fixture.invalid",
  label: "Fixture Alpha Store",
  tier: "public",
  connectedAt: "2026-10-28T00:00:00.000Z",
  status: "ok",
};

const BETA: StoreConnectionRecord = {
  id: "r7-beta",
  platform: "shopify",
  domain: "beta.fixture.invalid",
  label: "Fixture Beta Store",
  tier: "public",
  connectedAt: "2026-10-28T00:00:00.000Z",
  status: "ok",
};

function fixtureFinding(
  store: StoreConnectionRecord,
  title: string,
  price: number,
  currency: string,
): ObservedFinding {
  return {
    platform: store.platform,
    store: store.label,
    store_domain: store.domain,
    title,
    price,
    currency,
    url: `https://${store.domain}/${title.toLowerCase().replace(/[^a-z0-9]+/gu, "-")}`,
    image_url: null,
    published_at: "2026-10-01T00:00:00.000Z",
  };
}

/** The intent envelope with every ABSENT constraint recorded unknown (INV-10 — never assumed). */
function fixtureIntent(input: { query: string; maxLandedTotalCost?: HarnessMoney }): CommerceIntentEnvelope {
  const unknowns = COMMERCE_INTENT_UNKNOWN_FIELDS.filter(
    (field) => field !== "maxLandedTotalCost" || input.maxLandedTotalCost === undefined,
  );
  return {
    query: input.query,
    consentBasis: "read-only-search",
    ...(input.maxLandedTotalCost !== undefined
      ? { maxLandedTotalCost: input.maxLandedTotalCost }
      : {}),
    provenance: { surface: "r7 benchmark fixture", expressedAt: "2026-10-28T00:00:00.000Z" },
    unknowns,
  };
}

// ——— the corpus: EXACTLY 10 cases, the fixed set the benchmark runs ———

export const BENCHMARK_CORPUS: readonly BenchmarkIntentCase[] = [
  {
    id: "r7-01",
    label: "budget satisfied, group-buy lane realizable",
    intent: fixtureIntent({ query: "running shoes", maxLandedTotalCost: { amount: "400.00", currency: "HKD" } }),
    stores: [ALPHA],
    findings: [
      {
        storeDomain: ALPHA.domain,
        query: "running shoes",
        findings: [fixtureFinding(ALPHA, "Fixture Runner Pro", 380, "HKD"), fixtureFinding(ALPHA, "Fixture Runner Classic", 395, "HKD")],
      },
      { storeDomain: ALPHA.domain, query: "shoes", findings: [fixtureFinding(ALPHA, "Fixture Trail Shoe Premium", 450, "HKD")] },
    ],
    groundTruth: {
      realizableFamily: "group_buy_threshold",
      trueSavings: { amount: "40.00", currency: "HKD" },
      expectedSuccess: true,
      note: "Ground truth: the merchant's group-buy lane clears a 6-buyer threshold at HKD 340.00 — HKD 40.00 under the best observed offer (HKD 380.00). The fixture-tier capability cannot observe or draft that lane; the benchmark reports the miss, never hides it.",
    },
  },
  {
    id: "r7-02",
    label: "budget violated on every observed offer",
    intent: fixtureIntent({ query: "running shoes", maxLandedTotalCost: { amount: "400.00", currency: "HKD" } }),
    stores: [ALPHA, BETA],
    findings: [
      {
        storeDomain: ALPHA.domain,
        query: "running shoes",
        findings: [fixtureFinding(ALPHA, "Fixture Race Flat", 500, "HKD"), fixtureFinding(ALPHA, "Fixture Race Flat XL", 560, "HKD")],
      },
      { storeDomain: ALPHA.domain, query: "shoes", findings: [fixtureFinding(ALPHA, "Fixture Trail Trainer", 480, "HKD")] },
      { storeDomain: BETA.domain, query: "running shoes", findings: [fixtureFinding(BETA, "Fixture Road Runner", 550, "HKD")] },
      { storeDomain: BETA.domain, query: "shoes", findings: [fixtureFinding(BETA, "Fixture Trail Runner", 520, "HKD")] },
    ],
    groundTruth: {
      realizableFamily: null,
      trueSavings: null,
      expectedSuccess: false,
      note: "Every observed offer exceeds the budget on the subtotal alone — the honest answer is an empty shortlist and success=false, never a fabricated in-budget offer.",
    },
  },
  {
    id: "r7-03",
    label: "offers and budget denominated in different currencies",
    intent: fixtureIntent({ query: "running shoes", maxLandedTotalCost: { amount: "400.00", currency: "HKD" } }),
    stores: [ALPHA, BETA],
    findings: [
      {
        storeDomain: ALPHA.domain,
        query: "running shoes",
        findings: [fixtureFinding(ALPHA, "Fixture Imported Runner", 30, "USD"), fixtureFinding(ALPHA, "Fixture Imported Runner Mid", 45, "USD")],
      },
      { storeDomain: BETA.domain, query: "running shoes", findings: [fixtureFinding(BETA, "Fixture Euro Runner", 35, "EUR")] },
      { storeDomain: ALPHA.domain, query: "shoes", findings: [fixtureFinding(ALPHA, "Fixture Imported Trainer", 40, "USD")] },
      { storeDomain: BETA.domain, query: "shoes", findings: [fixtureFinding(BETA, "Fixture Imported Trainer Mid", 55, "USD")] },
    ],
    groundTruth: {
      realizableFamily: null,
      trueSavings: null,
      expectedSuccess: true,
      note: "The offers are denominated off the budget's currency and the two stores disagree with each other — with no FX source connected, the honest verdict is unknown totals, never an invented exchange rate.",
    },
  },
  {
    id: "r7-04",
    label: "coupon promotion lane realizable",
    intent: fixtureIntent({ query: "canvas sneakers", maxLandedTotalCost: { amount: "400.00", currency: "HKD" } }),
    stores: [ALPHA],
    findings: [
      { storeDomain: ALPHA.domain, query: "canvas sneakers", findings: [fixtureFinding(ALPHA, "Fixture Canvas Court", 390, "HKD")] },
      { storeDomain: ALPHA.domain, query: "sneakers", findings: [fixtureFinding(ALPHA, "Fixture Court Sneaker Premium", 450, "HKD")] },
    ],
    groundTruth: {
      realizableFamily: "coupon_promotion_eligibility",
      trueSavings: { amount: "39.00", currency: "HKD" },
      expectedSuccess: true,
      note: "Ground truth: a 10% site coupon applies at checkout — HKD 39.00 off the observed HKD 390.00 price. The Tier-1 public catalog exposes no promotions surface, so the harness honestly refuses to predict it; the benchmark reports the miss.",
    },
  },
  {
    id: "r7-05",
    label: "wait-or-buy lane realizable",
    intent: fixtureIntent({ query: "winter jacket", maxLandedTotalCost: { amount: "400.00", currency: "HKD" } }),
    stores: [ALPHA],
    findings: [
      { storeDomain: ALPHA.domain, query: "winter jacket", findings: [fixtureFinding(ALPHA, "Fixture Alpine Parka", 380, "HKD")] },
      { storeDomain: ALPHA.domain, query: "jacket", findings: [fixtureFinding(ALPHA, "Fixture Shell Jacket", 460, "HKD")] },
    ],
    groundTruth: {
      realizableFamily: "wait_or_buy",
      trueSavings: null,
      expectedSuccess: true,
      note: "Ground truth: waiting is realizable (the season-end sale reliably reprises this class of item), but the eventual price is unknowable in advance — the true saving stays honestly unknown, exactly as the harness's prediction refuses a magnitude.",
    },
  },
  {
    id: "r7-06",
    label: "no realizable savings family",
    intent: fixtureIntent({ query: "office chair", maxLandedTotalCost: { amount: "400.00", currency: "HKD" } }),
    stores: [ALPHA],
    findings: [
      { storeDomain: ALPHA.domain, query: "office chair", findings: [fixtureFinding(ALPHA, "Fixture Task Chair", 350, "HKD")] },
      { storeDomain: ALPHA.domain, query: "chair", findings: [fixtureFinding(ALPHA, "Fixture Executive Chair", 450, "HKD")] },
    ],
    groundTruth: {
      realizableFamily: null,
      trueSavings: null,
      expectedSuccess: true,
      note: "The observed in-budget price is already the cheapest path in this fixture world — no coupon, group-buy, counteroffer, or cheaper substitute exists to realize, so false savings must be zero here.",
    },
  },
  {
    id: "r7-07",
    label: "one store answers rate_limited (failure tolerance)",
    intent: fixtureIntent({ query: "running shoes", maxLandedTotalCost: { amount: "400.00", currency: "HKD" } }),
    stores: [ALPHA, BETA],
    findings: [
      { storeDomain: ALPHA.domain, query: "running shoes", findings: [fixtureFinding(ALPHA, "Fixture Daily Runner", 380, "HKD")] },
      { storeDomain: ALPHA.domain, query: "shoes", findings: [fixtureFinding(ALPHA, "Fixture Basic Trainer", 350, "HKD")] },
    ],
    storeErrors: [
      {
        storeDomain: BETA.domain,
        code: "rate_limited",
        message: "Fixture rate limit: the beta store's public catalog answers 429 rate_limited on both of its steps (fixture tier — no live provider was contacted).",
      },
    ],
    groundTruth: {
      realizableFamily: "approved_substitutes",
      trueSavings: { amount: "30.00", currency: "HKD" },
      expectedSuccess: true,
      note: "The observed substitute (HKD 350.00) beats the best exact offer (HKD 380.00) by HKD 30.00. Meanwhile the second store answers rate_limited on both of its steps — the harness must record that failure honestly in the per-store strip while the first store still shortlists.",
    },
  },
  {
    id: "r7-08",
    label: "zero findings anywhere (honest empty)",
    intent: fixtureIntent({ query: "vintage typewriter", maxLandedTotalCost: { amount: "500.00", currency: "HKD" } }),
    stores: [ALPHA, BETA],
    findings: [],
    groundTruth: {
      realizableFamily: null,
      trueSavings: null,
      expectedSuccess: false,
      note: "Both fixture catalogs answer ok with zero matching items — an honest empty with success=false, never a fabricated offer and never a silently missing family answer.",
    },
  },
  {
    id: "r7-09",
    label: "minimal intent — every constraint unknown",
    intent: fixtureIntent({ query: "sneakers" }),
    stores: [ALPHA],
    findings: [
      {
        storeDomain: ALPHA.domain,
        query: "sneakers",
        findings: [fixtureFinding(ALPHA, "Fixture Retro Sneaker", 320, "HKD"), fixtureFinding(ALPHA, "Fixture Court Classic", 410, "HKD")],
      },
    ],
    groundTruth: {
      realizableFamily: null,
      trueSavings: null,
      expectedSuccess: true,
      note: "No constraint was expressed — the harness must mark every field unknown and never guess one; success here only means offers were observed. The single-token query also means no broadened substitutes probe runs.",
    },
  },
  {
    id: "r7-10",
    label: "cheaper in-budget offer lives on the second store",
    intent: fixtureIntent({ query: "running shoes", maxLandedTotalCost: { amount: "400.00", currency: "HKD" } }),
    stores: [ALPHA, BETA],
    findings: [
      { storeDomain: ALPHA.domain, query: "running shoes", findings: [fixtureFinding(ALPHA, "Fixture Premium Runner", 480, "HKD")] },
      { storeDomain: BETA.domain, query: "running shoes", findings: [fixtureFinding(BETA, "Fixture Value Runner", 360, "HKD")] },
      { storeDomain: ALPHA.domain, query: "shoes", findings: [fixtureFinding(ALPHA, "Fixture Alpha Trail Shoe", 490, "HKD")] },
      { storeDomain: BETA.domain, query: "shoes", findings: [fixtureFinding(BETA, "Fixture Beta Trail Shoe", 420, "HKD")] },
    ],
    groundTruth: {
      realizableFamily: null,
      trueSavings: null,
      expectedSuccess: true,
      note: "The only in-budget offer lives on the second store — a single-store policy cannot find it; the harness's cross-store plan does. This is the incumbent comparator's own simulated limitation, not a rigged failure.",
    },
  },
];

// ——— shared fixture plumbing (the SAME observations feed every comparator) ———

/** The fixture map's answer for one (target, query) step — errors win over findings. */
export function fixtureObservation(input: {
  stepId: string;
  target: ConnectedStoreTarget;
  query: string;
  caseData: BenchmarkIntentCase;
  now: () => Date;
}): CapabilityObservation {
  const error = input.caseData.storeErrors?.find((entry) => entry.storeDomain === input.target.domain);
  if (error !== undefined) {
    return {
      stepId: input.stepId,
      target: input.target,
      operation: "store_search",
      outcome: error.code,
      observedAt: input.now().toISOString(),
      error: { code: error.code, message: error.message },
    };
  }
  const entry = input.caseData.findings.find(
    (candidate) => candidate.storeDomain === input.target.domain && candidate.query === input.query,
  );
  return {
    stepId: input.stepId,
    target: input.target,
    operation: "store_search",
    outcome: "ok",
    observedAt: input.now().toISOString(),
    findings: entry === undefined ? [] : [...entry.findings],
  };
}

/** Bind the fixture map as the StepExecutor double (deterministic, clock-driven). */
export function makeFixtureStepExecutor(caseData: BenchmarkIntentCase, now: () => Date): StepExecutor {
  return async (step) =>
    fixtureObservation({ stepId: step.id, target: step.target, query: step.query, caseData, now });
}
