import type { ToolCallBlockRenderContext } from "../../shared.js";

// ============================================================
// find_best_offer 聊天卡的视图模型（数据面 + 展示格式化，纯函数、无 React）
// ============================================================
//
// 从 commerce-harness.tsx 拆出的数据面（文件行数法 ≤ 800）：视图类型、防御性
// 读取器与展示格式化。纪律不变（store-search 同款）：渲染层永不信载荷形状——
// 每个字段按「record 或 JSON 字符串」防御性读出，读不懂的条目整个丢弃，绝不猜。
// 证据诚实法条（HARNESS-CONTRACT §1 L5 + INV-16/17/30）在这里同样成立：
// evidenceClass 只认 conditional/predicted；observed 是载荷违规，原样暴露但
// 永不被渲染成在售报价。金钱走 INV-14 精确路径（十进制字符串 → BigInt 分）。

// ——— 视图类型 ———

/** 精确金额（INV-14）：十进制字符串 + 货币码。渲染层同样不碰浮点。 */
export interface HarnessMoneyView {
  amount: string;
  currency: string;
}

/** 短名单报价（store_search finding 字段 + rank；防御性读出，永不信载荷形状）。 */
export interface OfferView {
  platform: string;
  store: string;
  title: string;
  url: string;
  price: number | null;
  currency: string | null;
  imageUrl: string | null;
  publishedAt: string | null;
  truncated: boolean;
}

/** 逐店状态（store-search 同款三态；错误分类码原样保留，永不翻译、永不吞掉）。 */
export type PerStoreStatus = "ok" | "error" | "not_configured";

export interface PerStoreOkView {
  status: "ok";
  platform: string;
  store: string;
  count: number | undefined;
  truncated: boolean;
}

export interface PerStoreFailureView {
  status: Exclude<PerStoreStatus, "ok">;
  platform: string;
  store: string;
  error: string;
  message: string;
}

export type PerStoreEntryView = PerStoreOkView | PerStoreFailureView;

/** 意图级约束满足状态（L3 evaluation.constraintSatisfaction 的防御性读出）。 */
export interface ConstraintSatisfactionView {
  constraint: string;
  status: "satisfied" | "unknown" | "violated";
  detail: string;
}

/** 反事实机会候选（六段记录的防御性读出；evidenceClass 只认 conditional/predicted）。 */
export interface OpportunityView {
  family: string;
  title: string;
  feasibility: string;
  evidenceClass: string;
  reason: string;
  observedFacts: string;
  changedAssumptions: string;
  predictedOutcome: string;
  preconditions: string[];
  freshness: string;
  expiresAt: string | undefined;
  consentRequired: string;
  authorityRequired: string;
}

export interface CommerceHarnessResultView {
  query: string | undefined;
  budget: HarnessMoneyView | undefined;
  size: string | undefined;
  brand: string | undefined;
  condition: string | undefined;
  deadline: string | undefined;
  offers: OfferView[];
  opportunities: OpportunityView[];
  /** 缺席 ≠ 空数组：缺席 = 载荷没有逐店通道（老宿主/手写载荷），计数降级到分组数。 */
  perStore: PerStoreEntryView[] | undefined;
  constraintSatisfaction: ConstraintSatisfactionView[];
  notice: string | undefined;
}

export type CommerceHarnessToolCallSource = ToolCallBlockRenderContext["toolCallNode"]["toolCall"];

// ——— 防御性读取器 ———

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** JSON 字符串候选的解析（list-models 同款：只有 { / [ 开头的才值得 parse 一次）。 */
function parseJsonCandidate(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

function readPriceValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readMoneyView(value: unknown): HarnessMoneyView | undefined {
  if (!isPlainRecord(value)) {
    return undefined;
  }
  const amount = readTrimmedString(value.amount);
  const currency = readTrimmedString(value.currency);
  return amount !== undefined && currency !== undefined ? { amount, currency } : undefined;
}

function readOfferEntry(entry: unknown): OfferView | null {
  if (!isPlainRecord(entry)) {
    return null;
  }
  const title = readTrimmedString(entry.title);
  const url = readTrimmedString(entry.url);
  // 标题与 URL 至少得有一个（store-search 同款）：两个都没有的条目无法被指认。
  const displayTitle = title ?? url;
  if (displayTitle === undefined) {
    return null;
  }
  return {
    platform: readTrimmedString(entry.platform) ?? "",
    store: readTrimmedString(entry.store) ?? "",
    title: displayTitle,
    url: url ?? "",
    price: readPriceValue(entry.price),
    currency: readTrimmedString(entry.currency) ?? null,
    imageUrl: readTrimmedString(entry.image_url) ?? null,
    publishedAt: readTrimmedString(entry.published_at) ?? null,
    truncated: entry.truncated === true,
  };
}

function readPerStoreEntry(entry: unknown): PerStoreEntryView | null {
  if (!isPlainRecord(entry)) {
    return null;
  }
  const status = entry.status;
  const platform = readTrimmedString(entry.platform) ?? "";
  const store = readTrimmedString(entry.store) ?? "";
  if (status === "ok") {
    return {
      status,
      platform,
      store,
      count:
        typeof entry.count === "number" && Number.isFinite(entry.count) && entry.count >= 0
          ? entry.count
          : undefined,
      truncated: entry.truncated === true,
    };
  }
  // 契约里 status 只有 ok / error / not_configured（store-search 同款）：不认识的分类码
  // 不翻译也不吞掉——按失败面渲染，分类码取载荷 error 字段、缺席时退回 status 本身。
  if (typeof status === "string") {
    return {
      status: status === "not_configured" ? "not_configured" : "error",
      platform,
      store,
      error: readTrimmedString(entry.error) ?? status,
      message: readTrimmedString(entry.message) ?? "",
    };
  }
  return null;
}

function readConstraintEntry(entry: unknown): ConstraintSatisfactionView | null {
  if (!isPlainRecord(entry)) {
    return null;
  }
  const constraint = readTrimmedString(entry.constraint);
  if (constraint === undefined) {
    return null;
  }
  const status = entry.status;
  return {
    constraint,
    status: status === "satisfied" || status === "violated" ? status : "unknown",
    detail: readTrimmedString(entry.detail) ?? "",
  };
}

function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: string[] = [];
  for (const item of value) {
    const text = typeof item === "string" ? item.trim() : "";
    if (text.length > 0) {
      out.push(text);
    }
  }
  return out;
}

function readOpportunityEntry(entry: unknown): OpportunityView | null {
  if (!isPlainRecord(entry)) {
    return null;
  }
  const family = readTrimmedString(entry.family) ?? "";
  const title = readTrimmedString(entry.title) ?? family;
  if (title.length === 0) {
    return null;
  }
  const evidence = isPlainRecord(entry.evidence) ? entry.evidence : {};
  return {
    family,
    title,
    feasibility: readTrimmedString(entry.feasibility) ?? "",
    // 证据类别原样上屏（conditional/predicted；observed 是载荷违规，也原样暴露，
    // 绝不静默吞掉——但渲染层永不把它画成在售报价，见卡面区段标题与虚线小签）。
    evidenceClass: readTrimmedString(entry.evidenceClass) ?? "",
    reason: readTrimmedString(entry.reason) ?? "",
    observedFacts: readTrimmedString(entry.observedFacts) ?? "",
    changedAssumptions: readTrimmedString(entry.changedAssumptions) ?? "",
    predictedOutcome: readTrimmedString(entry.predictedOutcome) ?? "",
    preconditions: readStringList(entry.preconditions),
    freshness: readTrimmedString(evidence.freshness) ?? "",
    expiresAt: readTrimmedString(evidence.expiresAt),
    consentRequired: readTrimmedString(entry.consentRequired) ?? "",
    authorityRequired: readTrimmedString(entry.authorityRequired) ?? "",
  };
}

function readCommerceHarnessResultRecord(candidate: unknown): CommerceHarnessResultView | null {
  const normalized = parseJsonCandidate(candidate);
  if (!isPlainRecord(normalized)) {
    return null;
  }
  const hasResults = Array.isArray(normalized.results);
  const hasOpportunities = Array.isArray(normalized.opportunities);
  // 接受判据就是契约骨架（store-search 同款）：results[] 与 opportunities[] 是
  // harness JSON 面恒在的两张脸（零店/空结果也带空数组）。两者都不在的载荷读不出
  // 任何度量事实，回去走兜底卡——「读不懂」不冒充「没有结果」。
  if (!hasResults || !hasOpportunities) {
    return null;
  }

  const offers: OfferView[] = [];
  for (const entry of normalized.results as unknown[]) {
    const offer = readOfferEntry(entry);
    if (offer !== null) {
      offers.push(offer);
    }
  }

  const opportunities: OpportunityView[] = [];
  for (const entry of normalized.opportunities as unknown[]) {
    const opportunity = readOpportunityEntry(entry);
    if (opportunity !== null) {
      opportunities.push(opportunity);
    }
  }

  const perStore: PerStoreEntryView[] = [];
  const hasPerStore = Array.isArray(normalized.per_store);
  if (hasPerStore) {
    for (const entry of normalized.per_store as unknown[]) {
      const view = readPerStoreEntry(entry);
      if (view !== null) {
        perStore.push(view);
      }
    }
  }

  const constraintSatisfaction: ConstraintSatisfactionView[] = [];
  const evaluation = isPlainRecord(normalized.evaluation) ? normalized.evaluation : {};
  if (Array.isArray(evaluation.constraintSatisfaction)) {
    for (const entry of evaluation.constraintSatisfaction as unknown[]) {
      const view = readConstraintEntry(entry);
      if (view !== null) {
        constraintSatisfaction.push(view);
      }
    }
  }

  // L1 意图字段：嵌在 intent 里（契约面）；防御性地也接受顶层 query（宽容读老载荷）。
  const intent = isPlainRecord(normalized.intent) ? normalized.intent : {};
  const query = readTrimmedString(intent.query) ?? readTrimmedString(normalized.query);
  const deadline = readTrimmedString(intent.deadline);

  return {
    query,
    budget: readMoneyView(intent.maxLandedTotalCost),
    size: readTrimmedString(intent.size),
    brand: readTrimmedString(intent.brand),
    condition: readTrimmedString(intent.condition),
    deadline,
    offers,
    opportunities,
    perStore: hasPerStore ? perStore : undefined,
    constraintSatisfaction,
    notice: readTrimmedString(normalized.notice),
  };
}

/**
 * 结果读取顺序与 list-models / store-search 同一条：`output` 先行，legacy JSON 探针
 * （raw.rawOutput / raw.output / raw.result）兜老会话与非 v4 宿主，每个候选都按
 * 「record 或 JSON 字符串」探一遍。读不出结构化结果回 null——兜底卡负责展示原始载荷。
 */
export function readCommerceHarnessResult(
  toolCall: CommerceHarnessToolCallSource,
): CommerceHarnessResultView | null {
  const raw = isPlainRecord(toolCall.raw) ? toolCall.raw : null;
  for (const candidate of [toolCall.output, raw?.rawOutput, raw?.output, raw?.result]) {
    const result = readCommerceHarnessResultRecord(candidate);
    if (result !== null) {
      return result;
    }
  }
  return null;
}

/** 从 input / rawInput 读 query（运行态没有 output，摘要主文本全靠它）。 */
export function readCommerceHarnessQuery(toolCall: CommerceHarnessToolCallSource): string | undefined {
  for (const candidate of [toolCall.input, readRawInput(toolCall.raw)]) {
    const normalized = parseJsonCandidate(candidate);
    if (!isPlainRecord(normalized)) {
      continue;
    }
    const query = readTrimmedString(normalized.query);
    if (query !== undefined) {
      return query;
    }
  }
  return undefined;
}

function readRawInput(raw: unknown): unknown {
  if (!isPlainRecord(raw)) {
    return undefined;
  }
  return raw.rawInput ?? raw.input;
}

// ——— 展示格式化 ———

/** 报价价格：显式 en-US 两位小数（模块级单例，不随界面 locale 漂移）；缺价画 "—"。 */
const PRICE_FORMATTER = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatOfferPrice(price: number | null, currency: string | null): string {
  if (price === null) {
    return "—";
  }
  const amount = PRICE_FORMATTER.format(price);
  return currency === null ? amount : `${currency} ${amount}`;
}

/**
 * 预算金额（INV-14 精确路径）：十进制字符串 → BigInt 分 → "HKD 400.00"。
 * 绝不 parseFloat——渲染层与工具层同一条钱法。读不出精确形式时原样展示。
 */
export function formatExactMoney(money: HarnessMoneyView): string {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/u.exec(money.amount);
  if (match === null || match[1] === undefined) {
    return `${money.currency} ${money.amount}`;
  }
  const fraction = (match[2] ?? "").padEnd(2, "0");
  const cents = BigInt(match[1]) * 100n + BigInt(fraction);
  return `${money.currency} ${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}

/** 日期只取 ISO 日期前缀（YYYY-MM-DD）：locale 无关，永不被时区/本地化改写。 */
export function formatIsoDatePrefix(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const prefix = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/u.test(prefix) ? prefix : undefined;
}
