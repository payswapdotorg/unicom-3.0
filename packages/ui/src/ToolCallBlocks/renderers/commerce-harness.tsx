import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ImageIcon, InfoIcon, ShoppingBag } from "lucide-react";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { FallbackToolCallBlock } from "@/ToolCallBlocks/renderers/fallback.js";
import { ToolSnapshotFieldNotice } from "@/ToolCallBlocks/ToolSnapshotFieldNotice.js";
import { ToolLayout } from "../ToolLayout.js";
import type { ToolCallBlockRenderContext } from "../shared.js";

const COMMERCE_HARNESS_TOOL_ICON = <ShoppingBag className="size-4 shrink-0 text-foreground-subtle" />;

// ============================================================
// find_best_offer 的聊天卡（HARNESS-CONTRACT 五层结果的忠实投影）
// ============================================================
//
// store-search.tsx 同款纪律，多一层要摊开的事实：工具输出不是一次搜索，而是一份
// L1→L5 的度量结果——意图硬约束、可行报价短名单、逐店诚实状态，以及八族反事实
// 机会候选（六段记录）。这张卡把同一份载荷重排成四件人读的事实：约束小签（只在场
// 的约束）、按店分组的短名单卡片（store-search 卡式）、逐店状态条、机会候选集。
// 证据诚实法条（HARNESS-CONTRACT §1 L5 + INV-16/17/30）：机会候选永不渲染成在售
// 报价——它们住在自己的区段里，带虚线证据小签（conditional/predicted，NEVER
// observed）与「非在售报价」字样；缺价画 "—"，未知落 unknown，绝不猜。
// 读不懂结构化结果就交回兜底卡（list-models 纪律），绝不画空卡冒充「查过了」。

// ——— 数据面 ———

/** 精确金额（INV-14）：十进制字符串 + 货币码。渲染层同样不碰浮点。 */
interface HarnessMoneyView {
  amount: string;
  currency: string;
}

/** 短名单报价（store_search finding 字段 + rank；防御性读出，永不信载荷形状）。 */
interface OfferView {
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
type PerStoreStatus = "ok" | "error" | "not_configured";

interface PerStoreOkView {
  status: "ok";
  platform: string;
  store: string;
  count: number | undefined;
  truncated: boolean;
}

interface PerStoreFailureView {
  status: Exclude<PerStoreStatus, "ok">;
  platform: string;
  store: string;
  error: string;
  message: string;
}

type PerStoreEntryView = PerStoreOkView | PerStoreFailureView;

/** 意图级约束满足状态（L3 evaluation.constraintSatisfaction 的防御性读出）。 */
interface ConstraintSatisfactionView {
  constraint: string;
  status: "satisfied" | "unknown" | "violated";
  detail: string;
}

/** 反事实机会候选（六段记录的防御性读出；evidenceClass 只认 conditional/predicted）。 */
interface OpportunityView {
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

interface CommerceHarnessResultView {
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

type CommerceHarnessToolCallSource = ToolCallBlockRenderContext["toolCallNode"]["toolCall"];

function isPlainRecord(value: unknown): value is Record<string, unknown> {
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
    // 绝不静默吞掉——但本卡永不把它渲染成在售报价，见区段标题与虚线小签）。
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

// ——— 工具身份（按名判定，store-search 同款纪律） ———

function normalizeToolToken(value: unknown): string {
  // 抹掉大小写与分隔符：`find_best_offer` / `FindBestOffer` 两种 wire 写法都命中。
  return typeof value === "string" ? value.toLowerCase().replace(/[^a-z0-9]/gu, "") : "";
}

const COMMERCE_HARNESS_TOOL_TOKENS = new Set(["findbestoffer", "findbestdeal", "shopintent"]);

/**
 * `find_best_offer`（别名 `find_best_deal` / `shop_intent`）的按名识别。
 * 判定必须排在 family 分流之前：这个名字不在 shared 的已知工具表里（identity 回
 * unknown → raw JSON 兜底卡把五层度量结果原样摊开）；而一旦将来被登记进某个
 * family（如 search），那个兜底会画一张通用搜索卡，把约束、短名单、逐店状态与
 * 机会候选全部丢掉。按名先判定让「登记前 / 登记后」两种世界都成立。
 */
export function isCommerceHarnessToolCall(source: {
  toolName?: string | null;
  kind?: string | null;
  title?: string | null;
  raw?: unknown;
}): boolean {
  const rawNames = isPlainRecord(source.raw)
    ? [source.raw.toolName, source.raw.tool_name, source.raw.name]
    : [];
  return [source.toolName, source.kind, source.title, ...rawNames].some((value) => {
    const token = normalizeToolToken(value);
    return token !== "" && COMMERCE_HARNESS_TOOL_TOKENS.has(token);
  });
}

// ——— 展示格式化 ———

/** 报价价格：显式 en-US 两位小数（模块级单例，不随界面 locale 漂移）；缺价画 "—"。 */
const PRICE_FORMATTER = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatOfferPrice(price: number | null, currency: string | null): string {
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
function formatExactMoney(money: HarnessMoneyView): string {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/u.exec(money.amount);
  if (match === null || match[1] === undefined) {
    return `${money.currency} ${money.amount}`;
  }
  const fraction = (match[2] ?? "").padEnd(2, "0");
  const cents = BigInt(match[1]) * 100n + BigInt(fraction);
  return `${money.currency} ${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}

/** 日期只取 ISO 日期前缀（YYYY-MM-DD）：locale 无关，永不被时区/本地化改写。 */
function formatIsoDatePrefix(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const prefix = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/u.test(prefix) ? prefix : undefined;
}

// ——— 分组 ———

interface OfferGroup {
  key: string;
  platform: string;
  store: string;
  offers: OfferView[];
  truncated: boolean;
}

/** 按 (platform, store) 分组并保持首次出现顺序（list-models / store-search 的分组纪律）。 */
function groupOffersByStore(offers: OfferView[]): OfferGroup[] {
  const groups: OfferGroup[] = [];
  const byKey = new Map<string, OfferGroup>();
  for (const offer of offers) {
    const key = `${offer.platform}\u0000${offer.store}`;
    let group = byKey.get(key);
    if (group === undefined) {
      group = { key, platform: offer.platform, store: offer.store, offers: [], truncated: false };
      byKey.set(key, group);
      groups.push(group);
    }
    group.offers.push(offer);
    if (offer.truncated) {
      group.truncated = true;
    }
  }
  return groups;
}

// ——— 小签与链接样式（语义 token，无内联颜色） ———

/** 平台小签（store-search 同款镌刻小签）：中性色——平台名只是事实标签。 */
const PLATFORM_CHIP_CLASSNAME =
  "shrink-0 rounded-xs border border-border px-1.5 py-0.5 font-mono text-ui-xs uppercase leading-none text-foreground-subtle";

/** 错误分类码小签（store-search 同款 warning 变体）：分类码原样上屏，完整消息挂 title=。 */
const ERROR_CHIP_CLASSNAME =
  "shrink-0 rounded-xs border border-warning/40 px-1.5 py-0.5 font-mono text-ui-xs uppercase leading-none text-warning";

/** 意图约束小签：满足=中性、未知=最弱、违反=warning（先说违反的硬约束）。 */
const CONSTRAINT_CHIP_CLASSNAME =
  "shrink-0 rounded-xs border border-border px-1.5 py-0.5 font-mono text-ui-xs leading-none text-foreground-subtle";
const CONSTRAINT_CHIP_UNKNOWN_CLASSNAME =
  "shrink-0 rounded-xs border border-border px-1.5 py-0.5 font-mono text-ui-xs leading-none text-foreground-subtlest";
const CONSTRAINT_CHIP_VIOLATED_CLASSNAME =
  "shrink-0 rounded-xs border border-warning/40 px-1.5 py-0.5 font-mono text-ui-xs leading-none text-warning";

/**
 * 证据类别小签（反事实专用）：虚线边框 + 中性色——与任何在售报价元素刻意不同形
 * （INV-16/17/30：反事实价格永不长得像实价）。旁边永远跟着「非在售报价」字样。
 */
const EVIDENCE_CHIP_CLASSNAME =
  "shrink-0 rounded-xs border border-dashed border-border px-1.5 py-0.5 font-mono text-ui-xs uppercase leading-none text-foreground-subtle";

/** 可行性小签：可行=中性；不支持/需批准=warning 变体（诚实拒绝要被看见）。 */
const FEASIBILITY_CHIP_CLASSNAME =
  "shrink-0 rounded-xs border border-border px-1.5 py-0.5 font-mono text-ui-xs leading-none text-foreground-subtle";
const FEASIBILITY_CHIP_REFUSED_CLASSNAME =
  "shrink-0 rounded-xs border border-warning/40 px-1.5 py-0.5 font-mono text-ui-xs leading-none text-warning";

/** 商品链接（store-search 同款）：messageLinkClassName 视觉，落点是 <button> 进内置浏览器。 */
const OFFER_LINK_CLASSNAME =
  "min-w-0 cursor-pointer break-words text-left font-medium text-ui-base text-icon-blue no-underline decoration-dotted underline-offset-4 hover:underline";

const OFFER_TITLE_FALLBACK_CLASSNAME =
  "min-w-0 break-words text-ui-base font-medium text-foreground-subtle";

/** 六段记录的小标签（机会候选卡内）：最弱色标签 + 载荷原文（永不翻译载荷文本）。 */
const OPPORTUNITY_LABEL_CLASSNAME = "shrink-0 font-medium text-foreground-subtlest";
const OPPORTUNITY_TEXT_CLASSNAME = "min-w-0 break-words text-foreground-subtle";

// ——— 子组件 ———

/** 固定 size-11 的缩略图（store-search 同款）：加载失败/URL 缺席换图标兜底，外框恒定。 */
function OfferThumbnail({ url, alt }: { url: string | null; alt: string }) {
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => {
    setImageFailed(false);
  }, [url]);
  return (
    <span
      className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-surface"
      aria-hidden="true"
    >
      {url === null || imageFailed ? (
        <ImageIcon className="size-4 shrink-0 text-foreground-subtlest" />
      ) : (
        <img
          src={url}
          alt={alt}
          className="size-11 object-cover"
          onError={() => setImageFailed(true)}
          loading="lazy"
        />
      )}
    </span>
  );
}

/** 机会候选的六段记录一行（label: payload text；标签最弱色，正文 subtle）。 */
function OpportunityLine({ label, text }: { label: string; text: string }) {
  if (text.length === 0) {
    return null;
  }
  return (
    <p className="flex min-w-0 items-baseline gap-1.5 text-ui-xs">
      <span className={OPPORTUNITY_LABEL_CLASSNAME}>{label}:</span>
      <span className={OPPORTUNITY_TEXT_CLASSNAME}>{text}</span>
    </p>
  );
}

// ——— 主组件 ———

/**
 * find_best_offer 的聊天卡。
 *
 * 状态面四条（store-search 同款，每条独立成立）：
 * 1. 失败 + 读不出结构化结果 → 紧凑失败面（摘要行只有种类词与状态词）；
 * 2. 运行中 → 待定面：种类词扫光 + query 主文本 + 无内容体；
 * 3. 非运行 + 读不出（老会话/降级宿主）→ 交回兜底卡带着本工具图标展示原始载荷；
 * 4. 读出结果 → 完整卡面：约束小签 + 分组短名单 + 逐店状态条 + 机会候选集 + notice。
 */
export function CommerceHarnessToolCallBlock(context: ToolCallBlockRenderContext) {
  const { intl } = useZCodeIntl();
  const formatMessage = intl.formatMessage;
  const { toolCall } = context.toolCallNode;

  const result = useMemo(() => readCommerceHarnessResult(toolCall), [toolCall]);
  const groups = useMemo(
    () => (result === null ? [] : groupOffersByStore(result.offers)),
    [result],
  );

  const kindLabel =
    context.kindLabelOverride ?? formatMessage({ id: "chat.toolCall.commerceHarness.kind" });
  const planningLabel = formatMessage({ id: "chat.toolCall.commerceHarness.planning" });
  const noMatchesLabel = formatMessage({ id: "chat.toolCall.commerceHarness.noMatches" });
  const notConfiguredLabel = formatMessage({ id: "chat.toolCall.commerceHarness.notConfigured" });
  const notLiveOfferLabel = formatMessage({ id: "chat.toolCall.commerceHarness.notLiveOffer" });
  const offersHeadingLabel = formatMessage({ id: "chat.toolCall.commerceHarness.offersHeading" });
  const opportunitiesHeadingLabel = formatMessage({
    id: "chat.toolCall.commerceHarness.opportunitiesHeading",
  });

  // 轻量 intl 没有 ICU 复数，单复数各用独立 message key（list-models 同款先例）。
  const offerCountLabel = useCallback(
    (count: number) =>
      formatMessage(
        {
          id:
            count === 1
              ? "chat.toolCall.commerceHarness.offerCount.one"
              : "chat.toolCall.commerceHarness.offerCount.other",
        },
        { count },
      ),
    [formatMessage],
  );
  const opportunityCountLabel = useCallback(
    (count: number) =>
      formatMessage(
        {
          id:
            count === 1
              ? "chat.toolCall.commerceHarness.opportunityCount.one"
              : "chat.toolCall.commerceHarness.opportunityCount.other",
        },
        { count },
      ),
    [formatMessage],
  );
  const foundCountLabel = useCallback(
    (count: number) =>
      formatMessage(
        {
          id:
            count === 1
              ? "chat.toolCall.commerceHarness.found.one"
              : "chat.toolCall.commerceHarness.found.other",
        },
        { count },
      ),
    [formatMessage],
  );
  const truncatedLabel = useCallback(
    (count: number) =>
      formatMessage({ id: "chat.toolCall.commerceHarness.truncated" }, { count }),
    [formatMessage],
  );
  const constraintLabel = useCallback(
    (constraint: string) => {
      const id = CONSTRAINT_LABEL_KEYS[constraint];
      return id === undefined
        ? constraint
        : formatMessage({ id }, { constraint });
    },
    [formatMessage],
  );
  const underBudgetLabel = useCallback(
    (budget: string) =>
      formatMessage({ id: "chat.toolCall.commerceHarness.underBudget" }, { budget }),
    [formatMessage],
  );

  const evidenceClassLabel = useCallback(
    (value: string) => {
      const id = EVIDENCE_CLASS_LABEL_KEYS[value];
      return id === undefined ? value : formatMessage({ id });
    },
    [formatMessage],
  );
  const feasibilityLabel = useCallback(
    (value: string) => {
      const id = FEASIBILITY_LABEL_KEYS[value];
      return id === undefined ? value : formatMessage({ id });
    },
    [formatMessage],
  );

  // 空态的商店数 N：per_store 在场时按它数（失败的店也数——它们确实被搜过）；
  // 通道缺席才降级到分组数（store-search 同款）。
  const searchedStoreCount =
    result?.perStore !== undefined ? result.perStore.length : groups.length;

  // 先说违反的硬约束（工作单法条）：第一个 violated 的意图级约束是瓶颈，
  // 带它的 payload detail（载荷文本原样上屏——它就是工具的诚实原话）。
  const violatedConstraint = useMemo(
    () =>
      result?.constraintSatisfaction.find((entry) => entry.status === "violated") ?? undefined,
    [result],
  );

  const emptyLabel = useMemo(() => {
    if (violatedConstraint !== undefined) {
      return formatMessage(
        { id: "chat.toolCall.commerceHarness.empty.violated" },
        { constraint: constraintLabel(violatedConstraint.constraint) },
      );
    }
    if (searchedStoreCount === 0) {
      return formatMessage({ id: "chat.toolCall.commerceHarness.empty.noStores" });
    }
    return formatMessage(
      {
        id:
          searchedStoreCount === 1
            ? "chat.toolCall.commerceHarness.empty.one"
            : "chat.toolCall.commerceHarness.empty.other",
      },
      { count: searchedStoreCount },
    );
  }, [constraintLabel, formatMessage, searchedStoreCount, violatedConstraint]);

  const query = result?.query ?? readCommerceHarnessQuery(toolCall);

  // ToolLayout 是 memo 组件：内联 JSX prop 每次渲染都是新引用，会让记忆化失效。
  const primaryText = useMemo(
    () => <span className="min-w-0 truncate">{query ?? kindLabel}</span>,
    [kindLabel, query],
  );

  const secondaryText = useMemo(() => {
    if (result === null) {
      return undefined;
    }
    if (result.offers.length === 0) {
      // 空态那句话也是折叠摘要的次级文本：不展开也知道「查过、没有可行的」。
      return <span className="truncate text-foreground-subtlest">{emptyLabel}</span>;
    }
    const budgetLine =
      result.budget !== undefined
        ? ` · ${underBudgetLabel(formatExactMoney(result.budget))}`
        : "";
    return (
      <span className="truncate text-foreground-subtlest">
        {offerCountLabel(result.offers.length)} ·{" "}
        {opportunityCountLabel(result.opportunities.length)}
        {budgetLine}
      </span>
    );
  }, [emptyLabel, offerCountLabel, opportunityCountLabel, result, underBudgetLabel]);

  const onOpenBrowserUrl = context.onOpenBrowserUrl;
  const renderContent = useCallback(() => {
    if (result === null) {
      return null;
    }

    const sections: ReactNode[] = [];

    // 意图约束小签（只在场的约束；状态分级：violated → warning 最先被看见）。
    const intentConstraints: { constraint: string; value: string }[] = [
      ...(result.budget !== undefined
        ? [{ constraint: "budget", value: formatExactMoney(result.budget) }]
        : []),
      ...(result.size !== undefined ? [{ constraint: "size", value: result.size }] : []),
      ...(result.brand !== undefined ? [{ constraint: "brand", value: result.brand }] : []),
      ...(result.condition !== undefined
        ? [{ constraint: "condition", value: result.condition }]
        : []),
      ...(result.deadline !== undefined
        ? [{ constraint: "deadline", value: formatIsoDatePrefix(result.deadline) ?? result.deadline }]
        : []),
    ];
    if (intentConstraints.length > 0) {
      sections.push(
        <div
          key="constraints"
          className="flex flex-wrap items-center gap-1.5"
          data-commerce-harness-constraints="true"
        >
          {intentConstraints.map(({ constraint, value }) => {
            const status = result.constraintSatisfaction.find(
              (entry) => entry.constraint === constraint,
            )?.status;
            const className =
              status === "violated"
                ? CONSTRAINT_CHIP_VIOLATED_CLASSNAME
                : status === "satisfied"
                  ? CONSTRAINT_CHIP_CLASSNAME
                  : CONSTRAINT_CHIP_UNKNOWN_CLASSNAME;
            return (
              <span key={constraint} className={className}>
                {constraintLabel(constraint)} {value}
              </span>
            );
          })}
        </div>,
      );
    }

    // 分组短名单（store-search 卡式：缩略图 + 内置浏览器链接 + 精确价格 + ISO 日期）。
    if (groups.length > 0) {
      sections.push(
        <div key="offers" className="space-y-2.5" data-commerce-harness-offers="true">
          <p className="text-ui-xs font-medium text-foreground-subtle">{offersHeadingLabel}</p>
          {groups.map((group) => (
            <div key={group.key} className="min-w-0 space-y-1.5" data-commerce-harness-group="true">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <span className={PLATFORM_CHIP_CLASSNAME}>{group.platform}</span>
                <span className="min-w-0 truncate text-ui-xs font-medium text-foreground-subtle">
                  {group.store}
                </span>
                <span className="shrink-0 text-ui-xs text-foreground-subtlest">
                  {foundCountLabel(group.offers.length)}
                </span>
                {group.truncated ? (
                  <span className="shrink-0 text-ui-xs text-foreground-subtlest">
                    {truncatedLabel(group.offers.length)}
                  </span>
                ) : null}
              </div>
              {group.offers.map((offer, index) => {
                const publishedDate = formatIsoDatePrefix(offer.publishedAt);
                return (
                  <div
                    key={`${group.key}\u0000${index}`}
                    className="flex min-w-0 items-start gap-2.5"
                    data-commerce-harness-offer="true"
                  >
                    <OfferThumbnail url={offer.imageUrl} alt={offer.title} />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      {offer.url.length > 0 && onOpenBrowserUrl !== undefined ? (
                        <button
                          type="button"
                          className={OFFER_LINK_CLASSNAME}
                          title={offer.url}
                          onClick={() => onOpenBrowserUrl(offer.url)}
                        >
                          <span className="line-clamp-2">{offer.title}</span>
                        </button>
                      ) : (
                        // 只读宿主（分享页等）没有内置浏览器回调：标题退化为纯文本（store-search 同款）。
                        <span
                          className={OFFER_TITLE_FALLBACK_CLASSNAME}
                          title={offer.url.length > 0 ? offer.url : undefined}
                        >
                          <span className="line-clamp-2">{offer.title}</span>
                        </span>
                      )}
                      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 font-mono text-ui-xs tabular-nums text-foreground-subtlest">
                        <span className="shrink-0">{formatOfferPrice(offer.price, offer.currency)}</span>
                        {publishedDate !== undefined ? (
                          <span className="shrink-0">{publishedDate}</span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>,
      );
    }

    // 逐店状态条（store-search 同款：错误分类码原样上屏，消息挂 title=）。
    if (result.perStore !== undefined && result.perStore.length > 0) {
      sections.push(
        <div
          key="per-store"
          className="flex flex-wrap items-center gap-x-3 gap-y-1.5"
          data-commerce-harness-strip="true"
        >
          {result.perStore.map((entry, index) => (
            <span
              key={`${entry.platform}\u0000${entry.store}\u0000${index}`}
              className="inline-flex min-w-0 max-w-full items-center gap-1.5"
            >
              <span className={PLATFORM_CHIP_CLASSNAME}>{entry.platform}</span>
              <span className="min-w-0 truncate text-ui-xs text-foreground-subtle">
                {entry.store}
              </span>
              {entry.status === "ok" ? (
                <>
                  {entry.count === undefined ? null : entry.count === 0 ? (
                    <span className="shrink-0 text-ui-xs text-foreground-subtlest">
                      {noMatchesLabel}
                    </span>
                  ) : (
                    <span className="shrink-0 text-ui-xs text-foreground-subtlest">
                      {foundCountLabel(entry.count)}
                    </span>
                  )}
                  {entry.truncated ? (
                    <span className="shrink-0 text-ui-xs text-foreground-subtlest">
                      {truncatedLabel(entry.count ?? 0)}
                    </span>
                  ) : null}
                </>
              ) : entry.status === "not_configured" ? (
                <span className="shrink-0 text-ui-xs text-foreground-subtlest">
                  {notConfiguredLabel}
                </span>
              ) : (
                <>
                  <span
                    className={ERROR_CHIP_CLASSNAME}
                    title={entry.message.length > 0 ? entry.message : undefined}
                  >
                    {entry.error}
                  </span>
                  {entry.message.length > 0 ? (
                    <span
                      className="min-w-0 max-w-72 truncate text-ui-xs text-foreground-subtlest"
                      title={entry.message}
                    >
                      {entry.message}
                    </span>
                  ) : null}
                </>
              )}
            </span>
          ))}
        </div>,
      );
    }

    // 机会候选集（L5 法条：与短名单永不同形——虚线证据小签 + 「非在售报价」+ 六段记录）。
    if (result.opportunities.length > 0) {
      sections.push(
        <div key="opportunities" className="space-y-2" data-commerce-harness-opportunities="true">
          <p className="text-ui-xs font-medium text-foreground-subtle">
            {opportunitiesHeadingLabel}
          </p>
          {result.opportunities.map((opportunity, index) => {
            const refused =
              opportunity.feasibility === "not_supported" ||
              opportunity.feasibility === "approval_required";
            const expiryDate = formatIsoDatePrefix(opportunity.expiresAt);
            return (
              <div
                key={`${opportunity.family}\u0000${index}`}
                className="min-w-0 space-y-1 rounded-md border border-border border-dashed p-2"
                data-commerce-harness-opportunity="true"
              >
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="min-w-0 truncate text-ui-sm font-medium text-foreground">
                    {opportunity.title}
                  </span>
                  {opportunity.evidenceClass.length > 0 ? (
                    <span className={EVIDENCE_CHIP_CLASSNAME}>
                      {evidenceClassLabel(opportunity.evidenceClass)}
                    </span>
                  ) : null}
                  <span className="shrink-0 text-ui-xs text-foreground-subtlest">
                    {notLiveOfferLabel}
                  </span>
                  {opportunity.feasibility.length > 0 ? (
                    <span
                      className={
                        refused ? FEASIBILITY_CHIP_REFUSED_CLASSNAME : FEASIBILITY_CHIP_CLASSNAME
                      }
                    >
                      {feasibilityLabel(opportunity.feasibility)}
                    </span>
                  ) : null}
                </div>
                {refused && opportunity.reason.length > 0 ? (
                  // 诚实拒绝的判定理由必须在场（families 法条：拒绝要带确切原因）。
                  <OpportunityLine
                    label={formatMessage({ id: "chat.toolCall.commerceHarness.opportunity.reason" })}
                    text={opportunity.reason}
                  />
                ) : null}
                <OpportunityLine
                  label={formatMessage({
                    id: "chat.toolCall.commerceHarness.opportunity.observedFacts",
                  })}
                  text={opportunity.observedFacts}
                />
                <OpportunityLine
                  label={formatMessage({
                    id: "chat.toolCall.commerceHarness.opportunity.changedAssumption",
                  })}
                  text={opportunity.changedAssumptions}
                />
                <OpportunityLine
                  label={formatMessage({
                    id: "chat.toolCall.commerceHarness.opportunity.predictedOutcome",
                  })}
                  text={opportunity.predictedOutcome}
                />
                {opportunity.preconditions.length > 0 ? (
                  <OpportunityLine
                    label={formatMessage({
                      id: "chat.toolCall.commerceHarness.opportunity.preconditions",
                    })}
                    text={opportunity.preconditions.join(" · ")}
                  />
                ) : null}
                <OpportunityLine
                  label={formatMessage({ id: "chat.toolCall.commerceHarness.opportunity.evidence" })}
                  text={[
                    opportunity.freshness,
                    expiryDate !== undefined
                      ? formatMessage(
                          { id: "chat.toolCall.commerceHarness.opportunity.expiry" },
                          { date: expiryDate },
                        )
                      : formatMessage({
                          id: "chat.toolCall.commerceHarness.opportunity.noExpiry",
                        }),
                    opportunity.consentRequired.length > 0 || opportunity.authorityRequired.length > 0
                      ? formatMessage(
                          { id: "chat.toolCall.commerceHarness.opportunity.consentAuthority" },
                          {
                            consent: opportunity.consentRequired,
                            authority: opportunity.authorityRequired,
                          },
                        )
                      : "",
                  ]
                    .filter((part) => part.length > 0)
                    .join(" · ")}
                />
              </div>
            );
          })}
        </div>,
      );
    }

    if (result.offers.length === 0) {
      sections.push(
        <p key="empty" className="text-ui-sm text-foreground-subtle">
          {emptyLabel}
          {violatedConstraint !== undefined && violatedConstraint.detail.length > 0 ? (
            <span className="block text-ui-xs text-foreground-subtlest">
              {violatedConstraint.detail}
            </span>
          ) : null}
        </p>,
      );
    }

    if (result.notice !== undefined) {
      sections.push(
        <p
          key="notice"
          className="flex items-start gap-1.5 text-ui-sm text-foreground-subtle"
          data-commerce-harness-notice="true"
        >
          <InfoIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 break-words">{result.notice}</span>
        </p>,
      );
    }

    return (
      <div className="mb-2 space-y-2.5" data-commerce-harness="true">
        {sections}
      </div>
    );
  }, [
    constraintLabel,
    emptyLabel,
    evidenceClassLabel,
    feasibilityLabel,
    formatMessage,
    foundCountLabel,
    groups,
    noMatchesLabel,
    notConfiguredLabel,
    notLiveOfferLabel,
    offersHeadingLabel,
    onOpenBrowserUrl,
    opportunitiesHeadingLabel,
    result,
    truncatedLabel,
    violatedConstraint,
  ]);

  const snapshotNotice = (
    <ToolSnapshotFieldNotice
      refs={toolCall.snapshotRefs ?? []}
      onLoadFullToolCallFields={
        context.onLoadFullToolCallFields
          ? () => context.onLoadFullToolCallFields?.(toolCall.toolId)
          : undefined
      }
    />
  );

  // 失败 + 读不出结构化结果（list-models 的紧凑失败面）：摘要行只有种类词与状态词。
  if (result === null && toolCall.status === "failed") {
    return (
      <>
        <ToolLayout
          toolId={toolCall.toolId}
          icon={COMMERCE_HARNESS_TOOL_ICON}
          showIcon={context.showIcon !== false}
          canToggle={false}
          forceOpen={false}
          kindLabel={kindLabel}
          sourceLabel={context.sourceLabel}
          primaryText={null}
          statusLabel={context.statusLabel}
          statusTooltip={context.errorText}
          showFailureStatus
          isRunning={context.isRunning}
          title={toolCall.title}
        />
        {snapshotNotice}
      </>
    );
  }

  // 运行中（search.tsx 的待定面）：种类词由 ToolLayout 扫光，query 做主文本，无内容体。
  if (context.isRunning) {
    return (
      <>
        <ToolLayout
          toolId={toolCall.toolId}
          icon={COMMERCE_HARNESS_TOOL_ICON}
          showIcon={context.showIcon !== false}
          canToggle={false}
          forceOpen={false}
          kindLabel={context.kindLabelOverride ?? planningLabel}
          sourceLabel={context.sourceLabel}
          primaryText={primaryText}
          statusLabel={context.statusLabel}
          statusTooltip={toolCall.status === "failed" ? context.errorText : undefined}
          showFailureStatus={toolCall.status === "failed"}
          isRunning={context.isRunning}
          title={toolCall.title}
          content={null}
        />
        {snapshotNotice}
      </>
    );
  }

  // 读不出结构化结果（老会话、降级宿主）就交回通用卡展示原始载荷
  // （store-search 同款）：「读不懂」与「没有结果」必须可分辨。
  if (result === null) {
    return <FallbackToolCallBlock {...context} iconOverride={COMMERCE_HARNESS_TOOL_ICON} />;
  }

  return (
    <>
      <ToolLayout
        toolId={toolCall.toolId}
        icon={COMMERCE_HARNESS_TOOL_ICON}
        showIcon={context.showIcon !== false}
        canToggle={context.canToggle ?? true}
        forceOpen={context.forceOpen ?? false}
        kindLabel={kindLabel}
        sourceLabel={context.sourceLabel}
        primaryText={primaryText}
        secondaryText={secondaryText}
        statusLabel={context.statusLabel}
        statusTooltip={toolCall.status === "failed" ? context.errorText : undefined}
        showFailureStatus={toolCall.status === "failed"}
        isRunning={context.isRunning}
        title={toolCall.title}
        renderContent={renderContent}
      />
      {snapshotNotice}
    </>
  );
}

// ——— 标签映射（i18n key 的封闭集合；未知值原样上屏——证据诚实优先） ———

const CONSTRAINT_LABEL_KEYS: Record<string, string> = {
  budget: "chat.toolCall.commerceHarness.constraint.budget",
  size: "chat.toolCall.commerceHarness.constraint.size",
  brand: "chat.toolCall.commerceHarness.constraint.brand",
  condition: "chat.toolCall.commerceHarness.constraint.condition",
  deadline: "chat.toolCall.commerceHarness.constraint.deadline",
};

const EVIDENCE_CLASS_LABEL_KEYS: Record<string, string> = {
  conditional: "chat.toolCall.commerceHarness.evidenceClass.conditional",
  predicted: "chat.toolCall.commerceHarness.evidenceClass.predicted",
};

const FEASIBILITY_LABEL_KEYS: Record<string, string> = {
  feasible: "chat.toolCall.commerceHarness.feasibility.feasible",
  not_supported: "chat.toolCall.commerceHarness.feasibility.notSupported",
  approval_required: "chat.toolCall.commerceHarness.feasibility.approvalRequired",
};

/** 从 input / rawInput 读 query（运行态没有 output，摘要主文本全靠它）。 */
function readCommerceHarnessQuery(toolCall: CommerceHarnessToolCallSource): string | undefined {
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
