import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ImageIcon, InfoIcon, Store } from "lucide-react";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { FallbackToolCallBlock } from "@/ToolCallBlocks/renderers/fallback.js";
import { ToolSnapshotFieldNotice } from "@/ToolCallBlocks/ToolSnapshotFieldNotice.js";
import { ToolLayout } from "../ToolLayout.js";
import type { ToolCallBlockRenderContext } from "../shared.js";

const STORE_SEARCH_TOOL_ICON = <Store className="size-4 shrink-0 text-foreground-subtle" />;

// ============================================================
// StoreSearch 的聊天卡（REPORT.md §4 结果契约的忠实投影）
// ============================================================
//
// 为什么值得一个专用 renderer：`store_search` 不在 shared 的已知工具表里（identity 回
// unknown），通用路径是 FallbackToolCallBlock 把整个 JSON 摊开——运营者要在一坨原始
// 文本里自己找商品名、价格和逐店失败原因。这张卡把同一份载荷重排成三件人读的事实：
// 按店铺分组的商品清单（标题链接走内置浏览器打开）、逐店的诚实状态（错误分类码原样
// 上屏）、notice 说明行。纪律与 list-models 相同：读不懂结构化结果就交回兜底卡，绝不
// 画一张空搜索卡冒充「查过了、什么都没有」。

// ——— 数据面 ———

/** 单条商品命中（StoreFinding 的防御性读出：只收字符串/数字/布尔，永不信载荷形状）。 */
interface StoreFindingView {
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

/** 逐店状态：ok / error / not_configured 三态（错误分类码原样保留，永不翻译、永不吞掉）。 */
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

interface StoreSearchResultView {
  query: string | undefined;
  findings: StoreFindingView[];
  /** 缺席 ≠ 空数组：缺席 = 载荷没有逐店通道（老宿主/手写载荷），计数要降级到分组数。 */
  perStore: PerStoreEntryView[] | undefined;
  notice: string | undefined;
}

type StoreSearchToolCallSource = ToolCallBlockRenderContext["toolCallNode"]["toolCall"];

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

/** JSON 字符串候选的解析（list-models 的同款：只有 { / [ 开头的才值得 parse 一次）。 */
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

function readFindingEntry(entry: unknown): StoreFindingView | null {
  if (!isPlainRecord(entry)) {
    return null;
  }
  const title = readTrimmedString(entry.title);
  const url = readTrimmedString(entry.url);
  // 标题与 URL 至少得有一个：两个都没有的条目无法被指认，上屏只会是一行空白谎话。
  // 有 URL 没标题时用 URL 当展示文本——诚实优先于好看。
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
  // 契约里 status 只有 ok / error / not_configured。not_configured 单独成面（它有专属
  // 的「未配置」说法）；其余一切非 ok 的字符串 status 都按失败面渲染，分类码取载荷的
  // error 字段、缺席时退回 status 本身——不认识的分类码不翻译也不吞掉（证据诚实优先）。
  if (status === "not_configured" || status === "error" || typeof status === "string") {
    return {
      status: status === "not_configured" ? "not_configured" : "error",
      platform,
      store,
      error: readTrimmedString(entry.error) ?? (typeof status === "string" ? status : "error"),
      message: readTrimmedString(entry.message) ?? "",
    };
  }
  return null;
}

function readStoreSearchResultRecord(candidate: unknown): StoreSearchResultView | null {
  const normalized = parseJsonCandidate(candidate);
  if (!isPlainRecord(normalized)) {
    return null;
  }
  const hasResults = Array.isArray(normalized.results);
  const hasPerStore = Array.isArray(normalized.per_store);
  // 接受判据就是契约的骨架：results[] 与 per_store[] 至少一个在场。
  // 两者都没有的载荷读不出任何搜索事实，回去走兜底卡。
  if (!hasResults && !hasPerStore) {
    return null;
  }

  const findings: StoreFindingView[] = [];
  if (hasResults) {
    for (const entry of normalized.results as unknown[]) {
      const finding = readFindingEntry(entry);
      if (finding !== null) {
        findings.push(finding);
      }
    }
  }

  const perStore: PerStoreEntryView[] = [];
  if (hasPerStore) {
    for (const entry of normalized.per_store as unknown[]) {
      const view = readPerStoreEntry(entry);
      if (view !== null) {
        perStore.push(view);
      }
    }
  }

  return {
    query: readTrimmedString(normalized.query),
    findings,
    perStore: hasPerStore ? perStore : undefined,
    notice: readTrimmedString(normalized.notice),
  };
}

/**
 * 结果读取顺序与 list-models 同一条：`output` 先行，legacy JSON 探针
 * （raw.rawOutput / raw.output / raw.result）兜老会话与非 v4 宿主，每个候选都按
 * 「record 或 JSON 字符串」探一遍。读不出结构化结果回 null——兜底卡负责展示原始载荷，
 * 这里绝不替「读不懂」编一个「没有结果」的说法。
 */
export function readStoreSearchResult(
  toolCall: StoreSearchToolCallSource,
): StoreSearchResultView | null {
  const raw = isPlainRecord(toolCall.raw) ? toolCall.raw : null;
  for (const candidate of [toolCall.output, raw?.rawOutput, raw?.output, raw?.result]) {
    const result = readStoreSearchResultRecord(candidate);
    if (result !== null) {
      return result;
    }
  }
  return null;
}

// ——— 工具身份（按名判定，workflowToolNames 的同款纪律） ———

function normalizeToolToken(value: unknown): string {
  // 抹掉大小写与分隔符：`store_search` / `StoreSearch` 两种 wire 写法都命中。
  return typeof value === "string" ? value.toLowerCase().replace(/[^a-z0-9]/gu, "") : "";
}

const STORE_SEARCH_TOOL_TOKENS = new Set(["storesearch", "searchstores", "storefind"]);

/**
 * `store_search`（别名 `search_stores` / `store_find`）的按名识别。
 * 判定必须排在 family 分流之前：这个名字不在 shared 的已知工具表里（identity 回
 * unknown → raw JSON 兜底卡）；而一旦将来被登记进 `search` family，那个兜底会画一张
 * 通用搜索卡，把分组商品清单、逐店状态与 notice 全部丢掉。按名先判定让
 * 「登记前 / 登记后」两种世界都成立。
 */
export function isStoreSearchToolCall(source: {
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
    return token !== "" && STORE_SEARCH_TOOL_TOKENS.has(token);
  });
}

// ——— 展示格式化 ———

/**
 * 价格固定用显式 en-US 两位小数格式（模块级单例，不随界面 locale 漂移）：
 * 卡片要说的是「平台报了多少」，不是「本地化成什么样」。货币代码放在数字前
 * （"USD 230.00"）；代码缺席时只展示数字——绝不替平台猜一个货币码。
 */
const PRICE_FORMATTER = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatFindingPrice(price: number | null, currency: string | null): string {
  if (price === null) {
    // 价格缺席就说缺席："—" 是观察不到的诚实记录，不是占位装饰。
    return "—";
  }
  const amount = PRICE_FORMATTER.format(price);
  return currency === null ? amount : `${currency} ${amount}`;
}

/** 发布日期只取 ISO 日期前缀（YYYY-MM-DD）：locale 无关，且永不被时区/本地化改写。 */
function formatPublishedDate(publishedAt: string | null): string | undefined {
  if (publishedAt === null) {
    return undefined;
  }
  const prefix = publishedAt.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/u.test(prefix) ? prefix : undefined;
}

// ——— 分组 ———

interface StoreFindingGroup {
  key: string;
  platform: string;
  store: string;
  findings: StoreFindingView[];
  truncated: boolean;
}

/**
 * 按 (platform, store) 分组并保持首次出现顺序（list-models 的分组纪律）——
 * 载荷的顺序就是工具的合并顺序（默认最新优先），卡片不重排、不二次排序。
 */
function groupFindingsByStore(findings: StoreFindingView[]): StoreFindingGroup[] {
  const groups: StoreFindingGroup[] = [];
  const byKey = new Map<string, StoreFindingGroup>();
  for (const finding of findings) {
    const key = `${finding.platform}\u0000${finding.store}`;
    let group = byKey.get(key);
    if (group === undefined) {
      group = {
        key,
        platform: finding.platform,
        store: finding.store,
        findings: [],
        truncated: false,
      };
      byKey.set(key, group);
      groups.push(group);
    }
    group.findings.push(finding);
    if (finding.truncated) {
      group.truncated = true;
    }
  }
  return groups;
}

// ——— 小签与链接样式（语义 token，无内联颜色） ———

/**
 * 平台小签：save-workflow「镌刻小签」同族（rounded-xs + 大写等宽微标签），
 * 去掉 workflow 专属的 tracking-wf-label token。中性色——平台名只是事实标签，
 * 不借 warning / destructive 语义色让区块更响（DESIGN.md 的禁令）。
 */
const PLATFORM_CHIP_CLASSNAME =
  "shrink-0 rounded-xs border border-border px-1.5 py-0.5 font-mono text-ui-xs uppercase leading-none text-foreground-subtle";

/**
 * 错误分类码小签：镌刻小签的 warning 变体（border-warning/40，与 save-workflow 的
 * overwrite 徽标同一族）。分类码原样上屏（CSS 大写只是展示变形，DOM 文本与复制内容
 * 仍是载荷里的原始码）；完整错误消息交给 title=，悬浮可读。
 */
const ERROR_CHIP_CLASSNAME =
  "shrink-0 rounded-xs border border-warning/40 px-1.5 py-0.5 font-mono text-ui-xs uppercase leading-none text-warning";

/**
 * 商品链接的视觉处理复刻 message.tsx 的 messageLinkClassName（text-icon-blue +
 * dotted 下划线 hover），落点是 <button>（走 context.onOpenBrowserUrl 进内置浏览器，
 * node-repl 的直接回调同款先例）——渲染器绝不开外链跳转。
 */
const FINDING_LINK_CLASSNAME =
  "min-w-0 cursor-pointer break-words text-left font-medium text-ui-base text-icon-blue no-underline decoration-dotted underline-offset-4 hover:underline";

const FINDING_TITLE_FALLBACK_CLASSNAME =
  "min-w-0 break-words text-ui-base font-medium text-foreground-subtle";

// ——— 子组件 ———

/**
 * 固定 size-11 的缩略图：img 加载失败（或 URL 缺席）换 ImageIcon 兜底，外框尺寸
 * 恒定不跳——列表里图片有与没有都不该推动布局。URL 变化时重置失败标记。
 */
function FindingThumbnail({ url, alt }: { url: string | null; alt: string }) {
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

// ——— 主组件 ———

/**
 * StoreSearch 的聊天卡。
 *
 * 状态面四条（每条都有独立理由，不可互相顶替）：
 * 1. 失败 + 读不出结构化结果 → list-models 的紧凑失败面：摘要行只有种类词与状态词，
 *    完整错误文本挂到状态词的 tooltip，绝不摊开错误 JSON；
 * 2. 运行中 → search.tsx 的待定面：种类词扫光 + query 主文本 + 无内容体；
 * 3. 非运行 + 读不出（老会话/降级宿主）→ 交回兜底卡带着本工具图标展示原始载荷；
 * 4. 读出结果 → 完整卡面：分组商品清单 + 逐店状态条 + notice 行。
 *
 * 证据诚实（运营者评审 2026-10-28 的法条）：每一条商品都是「平台的观察」，不是「已核
 * 实的事实」——缺价就画 "—"，缺图就画图标，缺货币码就不猜，绝不加任何载荷里没有的
 * 「已验证」徽标或断言。
 */
export function StoreSearchToolCallBlock(context: ToolCallBlockRenderContext) {
  const { intl } = useZCodeIntl();
  const formatMessage = intl.formatMessage;
  const { toolCall } = context.toolCallNode;

  const result = useMemo(() => readStoreSearchResult(toolCall), [toolCall]);
  const groups = useMemo(
    () => (result === null ? [] : groupFindingsByStore(result.findings)),
    [result],
  );

  const kindLabel =
    context.kindLabelOverride ?? formatMessage({ id: "chat.toolCall.storeSearch.kind" });
  const searchingLabel = formatMessage({ id: "chat.toolCall.storeSearch.searching" });
  const noMatchesLabel = formatMessage({ id: "chat.toolCall.storeSearch.noMatches" });
  const notConfiguredLabel = formatMessage({ id: "chat.toolCall.storeSearch.notConfigured" });

  // 轻量 intl 没有 ICU 复数，单复数各用独立 message key（list-models 同款先例）。
  // 这些闭包随 intl 实例稳定（IntlProvider 每个 locale 一份实例，node-repl 同款依赖）。
  const resultCountLabel = useCallback(
    (count: number) =>
      formatMessage(
        {
          id:
            count === 1
              ? "chat.toolCall.storeSearch.resultCount.one"
              : "chat.toolCall.storeSearch.resultCount.other",
        },
        { count },
      ),
    [formatMessage],
  );
  const storeCountLabel = useCallback(
    (count: number) =>
      formatMessage(
        {
          id:
            count === 1
              ? "chat.toolCall.storeSearch.storeCount.one"
              : "chat.toolCall.storeSearch.storeCount.other",
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
              ? "chat.toolCall.storeSearch.found.one"
              : "chat.toolCall.storeSearch.found.other",
        },
        { count },
      ),
    [formatMessage],
  );
  const truncatedLabel = useCallback(
    (count: number) =>
      formatMessage({ id: "chat.toolCall.storeSearch.truncated" }, { count }),
    [formatMessage],
  );

  // 空态的商店数 N：per_store 在场时按它数（失败的店也数——它们确实被搜过）；
  // 通道缺席才降级到分组数（分组来自 findings，空结果时是诚实的下界 0）。
  const searchedStoreCount = result?.perStore !== undefined ? result.perStore.length : groups.length;

  const emptyLabel = useMemo(
    () =>
      formatMessage(
        {
          id:
            searchedStoreCount === 1
              ? "chat.toolCall.storeSearch.empty.one"
              : "chat.toolCall.storeSearch.empty.other",
        },
        { count: searchedStoreCount },
      ),
    [formatMessage, searchedStoreCount],
  );

  // 摘要的「M stores」：有逐店通道时按被搜的店数（含失败店）；否则按分组数（只能为
  // 有命中的店作证）。findings 非空时分组必然非空，不会出现 0。
  const summaryStoreCount =
    result !== null && result.perStore !== undefined && result.perStore.length > 0
      ? result.perStore.length
      : groups.length;

  const query = result?.query ?? readStoreSearchQuery(toolCall);

  // ToolLayout 是 memo 组件：内联 JSX prop 每次渲染都是新引用，会让记忆化失效。
  const primaryText = useMemo(
    () => <span className="min-w-0 truncate">{query ?? kindLabel}</span>,
    [kindLabel, query],
  );

  const secondaryText = useMemo(() => {
    if (result === null) {
      return undefined;
    }
    if (result.findings.length === 0) {
      // 空态的那句话也是折叠摘要的次级文本：不展开也知道「查过、没有」。
      return <span className="truncate text-foreground-subtlest">{emptyLabel}</span>;
    }
    return (
      <span className="truncate text-foreground-subtlest">
        {resultCountLabel(result.findings.length)} · {storeCountLabel(summaryStoreCount)}
      </span>
    );
  }, [emptyLabel, result, resultCountLabel, storeCountLabel, summaryStoreCount]);

  const onOpenBrowserUrl = context.onOpenBrowserUrl;
  const renderContent = useCallback(() => {
    if (result === null) {
      return null;
    }

    const sections: ReactNode[] = [];

    if (result.findings.length === 0) {
      sections.push(
        <p key="empty" className="text-ui-sm text-foreground-subtle">
          {emptyLabel}
        </p>,
      );
    }

    if (groups.length > 0) {
      sections.push(
        <div key="groups" className="space-y-2.5" data-store-search-groups="true">
          {groups.map((group) => (
            <div key={group.key} className="min-w-0 space-y-1.5" data-store-search-group="true">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <span className={PLATFORM_CHIP_CLASSNAME}>{group.platform}</span>
                <span className="min-w-0 truncate text-ui-xs font-medium text-foreground-subtle">
                  {group.store}
                </span>
                <span className="shrink-0 text-ui-xs text-foreground-subtlest">
                  {foundCountLabel(group.findings.length)}
                </span>
                {group.truncated ? (
                  <span className="shrink-0 text-ui-xs text-foreground-subtlest">
                    {truncatedLabel(group.findings.length)}
                  </span>
                ) : null}
              </div>
              {group.findings.map((finding, index) => {
                const publishedDate = formatPublishedDate(finding.publishedAt);
                return (
                  <div
                    key={`${group.key}\u0000${index}`}
                    className="flex min-w-0 items-start gap-2.5"
                    data-store-search-finding="true"
                  >
                    <FindingThumbnail url={finding.imageUrl} alt={finding.title} />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      {finding.url.length > 0 && onOpenBrowserUrl !== undefined ? (
                        <button
                          type="button"
                          className={FINDING_LINK_CLASSNAME}
                          title={finding.url}
                          onClick={() => onOpenBrowserUrl(finding.url)}
                        >
                          <span className="line-clamp-2">{finding.title}</span>
                        </button>
                      ) : (
                        // 只读宿主（分享页等）没有内置浏览器回调：标题退化为纯文本，
                        // URL 放进 title=（web-fetch 的同款降级——绝不开外链跳转）。
                        <span
                          className={FINDING_TITLE_FALLBACK_CLASSNAME}
                          title={finding.url.length > 0 ? finding.url : undefined}
                        >
                          <span className="line-clamp-2">{finding.title}</span>
                        </span>
                      )}
                      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 font-mono text-ui-xs tabular-nums text-foreground-subtlest">
                        <span className="shrink-0">
                          {formatFindingPrice(finding.price, finding.currency)}
                        </span>
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

    if (result.perStore !== undefined && result.perStore.length > 0) {
      sections.push(
        <div
          key="per-store"
          className="flex flex-wrap items-center gap-x-3 gap-y-1.5"
          data-store-search-strip="true"
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
                  {/* count 缺席时什么都不说（决不猜一个数）；0 就是「无匹配」。 */}
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
                  {/* 错误分类码原样上屏；完整消息交给 title=，行内不摊长文。 */}
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

    if (result.notice !== undefined) {
      sections.push(
        <p
          key="notice"
          className="flex items-start gap-1.5 text-ui-sm text-foreground-subtle"
          data-store-search-notice="true"
        >
          <InfoIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 break-words">{result.notice}</span>
        </p>,
      );
    }

    return (
      <div className="mb-2 space-y-2.5" data-store-search="true">
        {sections}
      </div>
    );
  }, [
    emptyLabel,
    foundCountLabel,
    groups,
    noMatchesLabel,
    notConfiguredLabel,
    onOpenBrowserUrl,
    result,
    truncatedLabel,
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

  // 失败 + 读不出结构化结果（list-models 的紧凑失败面）：不退回兜底卡——那张卡会把
  // 错误 JSON 原样摊开，而这里真正要说的是「这次跨店搜索失败了」。计数与空态的话在
  // 这里都是谎话，摘要行只有种类词与状态词。
  if (result === null && toolCall.status === "failed") {
    return (
      <>
        <ToolLayout
          toolId={toolCall.toolId}
          icon={STORE_SEARCH_TOOL_ICON}
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
          icon={STORE_SEARCH_TOOL_ICON}
          showIcon={context.showIcon !== false}
          canToggle={false}
          forceOpen={false}
          kindLabel={context.kindLabelOverride ?? searchingLabel}
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

  // 读不出结构化结果（老会话、降级宿主）就交回通用卡展示原始载荷，
  // 而不是画一张空搜索卡——「读不懂」与「没有结果」必须可分辨。
  if (result === null) {
    return <FallbackToolCallBlock {...context} iconOverride={STORE_SEARCH_TOOL_ICON} />;
  }

  return (
    <>
      <ToolLayout
        toolId={toolCall.toolId}
        icon={STORE_SEARCH_TOOL_ICON}
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

/** 从 input / rawInput 读 query（运行态没有 output，摘要主文本全靠它）。 */
function readStoreSearchQuery(toolCall: StoreSearchToolCallSource): string | undefined {
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
