import { useCallback, useMemo, type ReactNode } from "react";
import { InfoIcon, Package, ShoppingCart, Store } from "lucide-react";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { FallbackToolCallBlock } from "@/ToolCallBlocks/renderers/fallback.js";
import { ToolSnapshotFieldNotice } from "@/ToolCallBlocks/ToolSnapshotFieldNotice.js";
import { ToolLayout } from "../ToolLayout.js";
import type { ToolCallBlockRenderContext } from "../shared.js";
import {
  readMerchantReadOperationInput,
  readMerchantReadResult,
  type MerchantInventoryEntryView,
  type MerchantMoneyView,
  type MerchantOrderEntryView,
  type MerchantReadOperationView,
  type MerchantReadResultView,
  type MerchantShopSummaryView,
} from "./merchant-read-face.js";

// The face module re-exports: resolveRenderer's and the tests' import faces
// stay on merchant-read.js (the store-search precedent — one canonical door).
export { readMerchantReadResult, isMerchantReadToolCall } from "./merchant-read-face.js";

const MERCHANT_READ_TOOL_ICON = <Store className="size-4 shrink-0 text-foreground-subtle" />;

// ============================================================
// MerchantRead 的聊天卡（merchant_read 工具 §-face 的忠实投影）
// ============================================================
//
// 为什么值得一个专用 renderer：`merchant_read` 不在 shared 的已知工具表里
// （identity 回 unknown），通用路径是 FallbackToolCallBlock 把整个 JSON 摊
// 开——店主要在原始文本里自己找店铺摘要、库存条目、订单金额与逐店失败原
// 因。这张卡把同一份载荷重排成人读的事实：店铺摘要节（平台自己的字段，
// 缺席字段绝不代造）、库存清单（标题/SKU/状态/数量/精确价格）、订单清单
// （日期 + receipt 编号 + 精确总额——buyer-less 法条）、逐店诚实状态（错误
// 分类码原样上屏）、notice 说明行。纪律与 store-search/list-models 相同：
// 读不懂结构化结果就交回兜底卡，绝不画一张空卡冒充「读过了、什么都没
// 有」；金钱是载荷的十进制字符串原样上屏——绝不经 Number 变形。

// ——— 小签与文本样式（语义 token，无内联颜色） ———

/** 平台小签：store-search 的 PLATFORM_CHIP 同款（中性色事实标签）。 */
const PLATFORM_CHIP_CLASSNAME =
  "shrink-0 rounded-xs border border-border px-1.5 py-0.5 font-mono text-ui-xs uppercase leading-none text-foreground-subtle";

/** 错误分类码小签：store-search 的 ERROR_CHIP 同款（warning 变体）。 */
const ERROR_CHIP_CLASSNAME =
  "shrink-0 rounded-xs border border-warning/40 px-1.5 py-0.5 font-mono text-ui-xs uppercase leading-none text-warning";

/** 店铺摘要/库存/订单条目链接：message.tsx 的 messageLinkClassName 同款。 */
const ENTRY_LINK_CLASSNAME =
  "min-w-0 cursor-pointer break-words text-left font-medium text-ui-base text-icon-blue no-underline decoration-dotted underline-offset-4 hover:underline";

const ENTRY_TITLE_FALLBACK_CLASSNAME =
  "min-w-0 break-words text-ui-base font-medium text-foreground-subtle";

/** 摘要字段小签（active/draft/expired/vacation/currency）：中性事实标签。 */
const SUMMARY_CHIP_CLASSNAME =
  "shrink-0 rounded-xs border border-border px-1.5 py-0.5 font-mono text-ui-xs leading-none text-foreground-subtle";

// ——— 展示格式化 ———

/**
 * 精确金钱：载荷的十进制字符串 + 货币码原样拼接（"USD 45.99"）——
 * 绝不经 Intl.NumberFormat（那是 store-search 数值价格的纪律；merchant 面
 * 的载荷已经是精确字符串，任何再格式化都是变形）。
 */
function formatMoneyExact(money: MerchantMoneyView | null): string {
  if (money === null) {
    return "—"; // 缺席就说缺席：观察不到的诚实记录。
  }
  return `${money.currency} ${money.amount}`;
}

/** ISO 时间戳只取日期前缀（YYYY-MM-DD）：locale 无关。 */
function formatDatePrefix(iso: string | null): string | undefined {
  if (iso === null) return undefined;
  const prefix = iso.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/u.test(prefix) ? prefix : undefined;
}

// ——— 每种操作的图标 ———

function operationIcon(operation: MerchantReadOperationView | null): ReactNode {
  if (operation === "catalog_inventory") {
    return <Package className="size-3.5 shrink-0" aria-hidden="true" />;
  }
  if (operation === "recent_orders") {
    return <ShoppingCart className="size-3.5 shrink-0" aria-hidden="true" />;
  }
  return <Store className="size-3.5 shrink-0" aria-hidden="true" />;
}

// ——— 子组件 ———

/** 店铺摘要节：平台自己的字段逐个上屏；缺席字段绝不代造一行。 */
function ShopSummarySection({
  summary,
  listingActiveLabel,
  listingDraftLabel,
  listingExpiredLabel,
  vacationLabel,
  shopCurrencyLabel,
  sinceLabel,
}: {
  summary: MerchantShopSummaryView;
  listingActiveLabel: string;
  listingDraftLabel: string;
  listingExpiredLabel: string;
  vacationLabel: string;
  shopCurrencyLabel: string;
  sinceLabel: (date: string) => string;
}) {
  const sinceDate = formatDatePrefix(summary.createdAt);
  return (
    <div
      key="shop-summary"
      className="min-w-0 space-y-1.5"
      data-merchant-read-summary="true"
    >
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="min-w-0 break-words text-ui-base font-medium">
          {summary.shopName ?? "—"}
        </span>
        {sinceDate !== undefined ? (
          <span className="shrink-0 text-ui-xs text-foreground-subtlest">
            {sinceLabel(sinceDate)}
          </span>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        {summary.listingActiveCount !== null ? (
          <span className={SUMMARY_CHIP_CLASSNAME}>
            {summary.listingActiveCount} {listingActiveLabel}
          </span>
        ) : null}
        {summary.listingDraftCount !== null ? (
          <span className={SUMMARY_CHIP_CLASSNAME}>
            {summary.listingDraftCount} {listingDraftLabel}
          </span>
        ) : null}
        {summary.listingExpiredCount !== null ? (
          <span className={SUMMARY_CHIP_CLASSNAME}>
            {summary.listingExpiredCount} {listingExpiredLabel}
          </span>
        ) : null}
        {summary.isVacation === true ? (
          <span className={SUMMARY_CHIP_CLASSNAME}>{vacationLabel}</span>
        ) : null}
        {summary.currencyCode !== null ? (
          <span className={SUMMARY_CHIP_CLASSNAME}>
            {shopCurrencyLabel} {summary.currencyCode}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** 库存清单节：title（可点开走内置浏览器）+ SKU/状态/数量/精确价格。 */
function InventorySection({
  entries,
  quantityLabel,
  skuLabel,
  onOpenBrowserUrl,
}: {
  entries: MerchantInventoryEntryView[];
  quantityLabel: string;
  skuLabel: string;
  onOpenBrowserUrl: ((url: string) => void) | undefined;
}) {
  return (
    <div key="inventory" className="space-y-1.5" data-merchant-read-inventory="true">
      {entries.map((entry, index) => {
        const url = entry.url !== null && entry.url.length > 0 ? entry.url : null;
        return (
        <div
          key={`${entry.store}\u0000${index}`}
          className="flex min-w-0 flex-col gap-0.5"
          data-merchant-read-entry="true"
        >
          {url !== null && onOpenBrowserUrl !== undefined ? (
            <button
              type="button"
              className={ENTRY_LINK_CLASSNAME}
              title={url}
              onClick={() => onOpenBrowserUrl(url)}
            >
              <span className="line-clamp-2">{entry.title}</span>
            </button>
          ) : (
            // 只读宿主（分享页等）没有内置浏览器回调：标题退化为纯文本，
            // URL 放进 title=（store-search 的同款降级——绝不开外链跳转）。
            <span
              className={ENTRY_TITLE_FALLBACK_CLASSNAME}
              title={url ?? undefined}
            >
              <span className="line-clamp-2">{entry.title}</span>
            </span>
          )}
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 font-mono text-ui-xs tabular-nums text-foreground-subtlest">
            <span className="shrink-0">{formatMoneyExact(entry.price)}</span>
            {entry.quantity !== null ? (
              <span className="shrink-0">
                {quantityLabel} {entry.quantity}
              </span>
            ) : null}
            {entry.sku !== null ? (
              <span className="shrink-0">
                {skuLabel} {entry.sku}
              </span>
            ) : null}
            {entry.state !== null ? <span className="shrink-0">{entry.state}</span> : null}
            {entry.store.length > 0 ? (
              <span className="min-w-0 truncate">{entry.store}</span>
            ) : null}
          </div>
        </div>
        );
      })}
    </div>
  );
}

/** 订单清单节：日期 + receipt 编号 + 精确总额（buyer-less——别无他物）。 */
function OrdersSection({ orders }: { orders: MerchantOrderEntryView[] }) {
  return (
    <div key="orders" className="space-y-1.5" data-merchant-read-orders="true">
      {orders.map((order, index) => {
        const date = formatDatePrefix(order.createdAt);
        return (
          <div
            key={`${order.store}\u0000${index}`}
            className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5"
            data-merchant-read-order="true"
          >
            {date !== undefined ? (
              <span className="shrink-0 font-mono text-ui-xs tabular-nums text-foreground-subtlest">
                {date}
              </span>
            ) : null}
            {order.receiptId !== null ? (
              <span className="shrink-0 font-mono text-ui-xs text-foreground-subtlest">
                #{order.receiptId}
              </span>
            ) : null}
            <span className="shrink-0 font-mono text-ui-xs tabular-nums text-foreground-subtle">
              {formatMoneyExact(order.grandTotal)}
            </span>
            {order.store.length > 0 ? (
              <span className="min-w-0 truncate text-ui-xs text-foreground-subtlest">
                {order.store}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// ——— 主组件 ———

/**
 * MerchantRead 的聊天卡。
 *
 * 状态面四条（store-search 的同款纪律，每条都有独立理由）：
 * 1. 失败 + 读不出结构化结果 → list-models 的紧凑失败面：摘要行只有种
 *    类词与状态词，完整错误文本挂到状态词的 tooltip；
 * 2. 运行中 → search.tsx 的待定面：种类词扫光 + 操作主文本 + 无内容体；
 * 3. 非运行 + 读不出（老会话/降级宿主）→ 交回兜底卡带着本工具图标展示
 *    原始载荷；
 * 4. 读出结果 → 完整卡面：店铺摘要 / 库存清单 / 订单清单 + 逐店状态条 +
 *    notice 行。
 *
 * 证据诚实：每一行都是「平台的观察」——缺价画 "—"，缺字段就不渲染那一
 * 行，绝不加任何载荷里没有的断言；金额是载荷的精确十进制字符串原样
 * 上屏；订单行 buyer-less。
 */
export function MerchantReadToolCallBlock(context: ToolCallBlockRenderContext) {
  const { intl } = useZCodeIntl();
  const formatMessage = intl.formatMessage;
  const { toolCall } = context.toolCallNode;

  const result = useMemo(() => readMerchantReadResult(toolCall), [toolCall]);

  const kindLabel =
    context.kindLabelOverride ?? formatMessage({ id: "chat.toolCall.merchantRead.kind" });
  const readingLabel = formatMessage({ id: "chat.toolCall.merchantRead.reading" });
  const noMatchesLabel = formatMessage({ id: "chat.toolCall.merchantRead.noMatches" });
  const notConfiguredLabel = formatMessage({ id: "chat.toolCall.merchantRead.notConfigured" });

  const operationLabel = useCallback(
    (operation: MerchantReadOperationView | null): string => {
      if (operation === "catalog_inventory") {
        return formatMessage({ id: "chat.toolCall.merchantRead.operation.catalogInventory" });
      }
      if (operation === "recent_orders") {
        return formatMessage({ id: "chat.toolCall.merchantRead.operation.recentOrders" });
      }
      if (operation === "shop_summary") {
        return formatMessage({ id: "chat.toolCall.merchantRead.operation.shopSummary" });
      }
      // kindLabel 可以是 ReactNode（override），不能进 string 函数——回落到
      // 未本地化的种类词缺席时的 kind 文案本身。
      return formatMessage({ id: "chat.toolCall.merchantRead.kind" });
    },
    [formatMessage],
  );

  // 轻量 intl 没有 ICU 复数，单复数各用独立 message key（list-models 同款）。
  const entryCountLabel = useCallback(
    (count: number) =>
      formatMessage(
        {
          id:
            count === 1
              ? "chat.toolCall.merchantRead.entryCount.one"
              : "chat.toolCall.merchantRead.entryCount.other",
        },
        { count },
      ),
    [formatMessage],
  );
  const orderCountLabel = useCallback(
    (count: number) =>
      formatMessage(
        {
          id:
            count === 1
              ? "chat.toolCall.merchantRead.orderCount.one"
              : "chat.toolCall.merchantRead.orderCount.other",
        },
        { count },
      ),
    [formatMessage],
  );
  const summaryCountLabel = useCallback(
    (count: number) =>
      formatMessage(
        {
          id:
            count === 1
              ? "chat.toolCall.merchantRead.summaryCount.one"
              : "chat.toolCall.merchantRead.summaryCount.other",
        },
        { count },
      ),
    [formatMessage],
  );
  const truncatedLabel = useCallback(
    (count: number) =>
      formatMessage({ id: "chat.toolCall.merchantRead.truncated" }, { count }),
    [formatMessage],
  );
  const sinceLabel = useCallback(
    (date: string) => formatMessage({ id: "chat.toolCall.merchantRead.since" }, { date }),
    [formatMessage],
  );

  const listingActiveLabel = formatMessage({ id: "chat.toolCall.merchantRead.listingActiveCount" });
  const listingDraftLabel = formatMessage({ id: "chat.toolCall.merchantRead.listingDraftCount" });
  const listingExpiredLabel = formatMessage({
    id: "chat.toolCall.merchantRead.listingExpiredCount",
  });
  const vacationLabel = formatMessage({ id: "chat.toolCall.merchantRead.vacation" });
  const shopCurrencyLabel = formatMessage({ id: "chat.toolCall.merchantRead.shopCurrency" });
  const quantityLabel = formatMessage({ id: "chat.toolCall.merchantRead.quantity" });
  const skuLabel = formatMessage({ id: "chat.toolCall.merchantRead.sku" });

  // 被读的店数：per_store 在场时按它数（失败的店也数——它们确实被读过）；
  // 通道缺席时按有 ok 结果的店数（诚实下界）。
  const readStoreCount =
    result?.perStore !== undefined ? result.perStore.length : result !== null ? 1 : 0;

  const emptyLabel = useMemo(
    () =>
      formatMessage(
        {
          id:
            readStoreCount === 1
              ? "chat.toolCall.merchantRead.empty.one"
              : "chat.toolCall.merchantRead.empty.other",
        },
        { count: readStoreCount },
      ),
    [formatMessage, readStoreCount],
  );

  const runningInput = useMemo(
    () => readMerchantReadOperationInput(toolCall),
    [toolCall],
  );

  // 摘要主文本：操作种类词（+ 店名，在场时）。运行态没有 output，靠 input。
  const headline = result?.store ?? runningInput.store;
  const primaryText = useMemo(
    () => (
      <span className="min-w-0 truncate">
        {operationLabel(result?.operation ?? runningInput.operation)}
        {headline !== undefined ? ` · ${headline}` : ""}
      </span>
    ),
    [operationLabel, result?.operation, runningInput.operation, headline],
  );

  /** 摘要行的诚实计数：按操作取对应通道的条数（缺通道 = 没有可数的）。 */
  const countOf = useCallback(
    (view: MerchantReadResultView): number => {
      if (view.operation === "shop_summary") {
        return view.shopSummary !== undefined ? 1 : 0;
      }
      if (view.operation === "recent_orders") {
        return view.orders?.length ?? 0;
      }
      return view.inventory?.length ?? 0;
    },
    [],
  );

  const secondaryText = useMemo(() => {
    if (result === null) {
      return undefined;
    }
    const count = countOf(result);
    if (count === 0) {
      // 空态那句话也是折叠摘要的次级文本：不展开也知道「读过、没有」。
      return <span className="truncate text-foreground-subtlest">{emptyLabel}</span>;
    }
    const countText =
      result.operation === "shop_summary"
        ? summaryCountLabel(count)
        : result.operation === "recent_orders"
          ? orderCountLabel(count)
          : entryCountLabel(count);
    return <span className="truncate text-foreground-subtlest">{countText}</span>;
  }, [countOf, emptyLabel, entryCountLabel, orderCountLabel, result, summaryCountLabel]);

  const onOpenBrowserUrl = context.onOpenBrowserUrl;
  const renderContent = useCallback(() => {
    if (result === null) {
      return null;
    }

    const sections: ReactNode[] = [];

    if (result.shopSummary !== undefined) {
      sections.push(
        <ShopSummarySection
          key="shop-summary"
          summary={result.shopSummary}
          listingActiveLabel={listingActiveLabel}
          listingDraftLabel={listingDraftLabel}
          listingExpiredLabel={listingExpiredLabel}
          vacationLabel={vacationLabel}
          shopCurrencyLabel={shopCurrencyLabel}
          sinceLabel={sinceLabel}
        />,
      );
    }

    if (result.inventory !== undefined && result.inventory.length > 0) {
      sections.push(
        <InventorySection
          key="inventory"
          entries={result.inventory}
          quantityLabel={quantityLabel}
          skuLabel={skuLabel}
          onOpenBrowserUrl={onOpenBrowserUrl}
        />,
      );
    }

    if (result.orders !== undefined && result.orders.length > 0) {
      sections.push(<OrdersSection key="orders" orders={result.orders} />);
    }

    if (
      (result.inventory !== undefined || result.orders !== undefined) &&
      (result.inventory?.length ?? 0) + (result.orders?.length ?? 0) === 0
    ) {
      sections.push(
        <p key="empty" className="text-ui-sm text-foreground-subtle">
          {emptyLabel}
        </p>,
      );
    }

    if (result.truncated) {
      const shown =
        (result.inventory?.length ?? 0) + (result.orders?.length ?? 0) > 0
          ? (result.inventory?.length ?? 0) + (result.orders?.length ?? 0)
          : 1;
      sections.push(
        <p key="truncated" className="text-ui-xs text-foreground-subtlest">
          {truncatedLabel(shown)}
        </p>,
      );
    }

    if (result.perStore !== undefined && result.perStore.length > 0) {
      sections.push(
        <div
          key="per-store"
          className="flex flex-wrap items-center gap-x-3 gap-y-1.5"
          data-merchant-read-strip="true"
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
                      {entry.count}
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
          data-merchant-read-notice="true"
        >
          <InfoIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 break-words">{result.notice}</span>
        </p>,
      );
    }

    return (
      <div className="mb-2 space-y-2.5" data-merchant-read="true">
        {sections}
      </div>
    );
  }, [
    emptyLabel,
    listingActiveLabel,
    listingDraftLabel,
    listingExpiredLabel,
    noMatchesLabel,
    notConfiguredLabel,
    onOpenBrowserUrl,
    quantityLabel,
    result,
    shopCurrencyLabel,
    sinceLabel,
    skuLabel,
    truncatedLabel,
    vacationLabel,
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

  // 失败 + 读不出结构化结果（list-models 的紧凑失败面）：不退回兜底卡——
  // 那张卡会把错误 JSON 原样摊开，而这里真正要说的是「这次读取失败了」。
  if (result === null && toolCall.status === "failed") {
    return (
      <>
        <ToolLayout
          toolId={toolCall.toolId}
          icon={MERCHANT_READ_TOOL_ICON}
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

  // 运行中（search.tsx 的待定面）：种类词由 ToolLayout 扫光，操作词做主文
  // 本，无内容体。
  if (context.isRunning) {
    return (
      <>
        <ToolLayout
          toolId={toolCall.toolId}
          icon={MERCHANT_READ_TOOL_ICON}
          showIcon={context.showIcon !== false}
          canToggle={false}
          forceOpen={false}
          kindLabel={context.kindLabelOverride ?? readingLabel}
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
  // 而不是画一张空读取卡——「读不懂」与「没有结果」必须可分辨。
  if (result === null) {
    return <FallbackToolCallBlock {...context} iconOverride={MERCHANT_READ_TOOL_ICON} />;
  }

  return (
    <>
      <ToolLayout
        toolId={toolCall.toolId}
        icon={MERCHANT_READ_TOOL_ICON}
        showIcon={context.showIcon !== false}
        canToggle={context.canToggle ?? true}
        forceOpen={context.forceOpen ?? false}
        kindLabel={
          <span className="inline-flex min-w-0 items-center gap-1.5">
            {operationIcon(result.operation)}
            <span>{kindLabel}</span>
          </span>
        }
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
