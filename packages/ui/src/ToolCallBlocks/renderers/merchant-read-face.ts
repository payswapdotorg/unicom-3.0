// ============================================================
// merchant_read 的聊天卡 — 纯数据面解析模块
// ============================================================
//
// 从 merchant-read.tsx 拆出的纯数据层（无 JSX、无 React import）：视图类型、
// 防御性载荷读取、结果候选探测与按名身份判定。拆分理由与 store-search/
// commerce-harness 同族——卡片文件要压在 oxlint max-lines(800) 之下（canon
// store-search.tsx 为 793 行），数据面独立成模块后两侧都可独立演进；
// merchant-read.tsx re-export 本模块的 readMerchantReadResult +
// isMerchantReadToolCall，resolveRenderer 与测试的 import 面保持不变。
//
// 纪律与 store-search.tsx 的数据面完全同款：载荷永不轻信（只收字符串/
// 数字/布尔，形状不对就是读不出）；金钱是载荷自己的十进制字符串（
// "45.99"）原样上屏——绝不经 Number 变形；orders 面只认 buyer-less 字段
// （date / receiptId / grandTotal），绝不解析任何买家字段。

// ——— 视图类型（防御性读出的结果） ———

/** 精确金钱：载荷自己的十进制字符串 + 货币码，原样上屏。 */
export interface MerchantMoneyView {
  amount: string;
  currency: string;
}

/** 店铺摘要：平台自己的字段；缺席字段是 null（绝不代造一个值）。 */
export interface MerchantShopSummaryView {
  shopId: number | null;
  shopName: string | null;
  listingActiveCount: number | null;
  listingDraftCount: number | null;
  listingExpiredCount: number | null;
  isVacation: boolean | null;
  currencyCode: string | null;
  createdAt: string | null;
}

/** 单条 catalog/inventory 条目。 */
export interface MerchantInventoryEntryView {
  store: string;
  listingId: number | null;
  title: string;
  state: string | null;
  sku: string | null;
  quantity: number | null;
  price: MerchantMoneyView | null;
  url: string | null;
}

/** 单条 recent order：buyer-less（date / receiptId / grandTotal 之外无面）。 */
export interface MerchantOrderEntryView {
  store: string;
  receiptId: number | null;
  createdAt: string | null;
  grandTotal: MerchantMoneyView | null;
}

/** 逐店状态：ok / error / not_configured 三态（分类码原样保留）。 */
export type MerchantPerStoreStatus = "ok" | "error" | "not_configured";

export interface MerchantPerStoreOkView {
  status: "ok";
  platform: string;
  store: string;
  count: number | undefined;
  truncated: boolean;
}

export interface MerchantPerStoreFailureView {
  status: Exclude<MerchantPerStoreStatus, "ok">;
  platform: string;
  store: string;
  error: string;
  message: string;
}

export type MerchantPerStoreEntryView = MerchantPerStoreOkView | MerchantPerStoreFailureView;

export type MerchantReadOperationView = "shop_summary" | "catalog_inventory" | "recent_orders";

export interface MerchantReadResultView {
  operation: MerchantReadOperationView;
  store: string | undefined;
  platform: string | undefined;
  shopSummary: MerchantShopSummaryView | undefined;
  /** 缺席 ≠ 空数组：载荷没有该通道就不渲染该节。 */
  inventory: MerchantInventoryEntryView[] | undefined;
  orders: MerchantOrderEntryView[] | undefined;
  truncated: boolean;
  perStore: MerchantPerStoreEntryView[] | undefined;
  notice: string | undefined;
}

export type MerchantReadToolCallSource = {
  toolName?: string | null;
  kind?: string | null;
  title?: string | null;
  raw?: unknown;
  input?: unknown;
  output?: unknown;
};

// ——— 基础防御读取（store-search 数据面的同款纪律） ———

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

function readFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** JSON 字符串候选的解析（只有 { / [ 开头的才值得 parse 一次）。 */
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

// ——— 字段读取 ———

/** 精确金钱读取：amount 必须是非空十进制字符串（绝不过 Number — 载荷的
 * 字符串就是渲染文本），currency 必须是非空字符串；否则 null。 */
function readMoney(value: unknown): MerchantMoneyView | null {
  if (!isPlainRecord(value)) return null;
  const amount = readTrimmedString(value.amount);
  const currency = readTrimmedString(value.currency);
  if (amount === undefined || currency === undefined) return null;
  return { amount, currency };
}

function readOperation(value: unknown): MerchantReadOperationView | null {
  if (value === "shop_summary" || value === "catalog_inventory" || value === "recent_orders") {
    return value;
  }
  return null;
}

function readShopSummary(value: unknown): MerchantShopSummaryView | undefined {
  if (!isPlainRecord(value)) return undefined;
  return {
    shopId: readFiniteNumber(value.shopId),
    shopName: readTrimmedString(value.shopName) ?? null,
    listingActiveCount: readFiniteNumber(value.listingActiveCount),
    listingDraftCount: readFiniteNumber(value.listingDraftCount),
    listingExpiredCount: readFiniteNumber(value.listingExpiredCount),
    isVacation: typeof value.isVacation === "boolean" ? value.isVacation : null,
    currencyCode: readTrimmedString(value.currencyCode) ?? null,
    createdAt: readTrimmedString(value.createdAt) ?? null,
  };
}

function readInventoryEntry(entry: unknown): MerchantInventoryEntryView | null {
  if (!isPlainRecord(entry)) return null;
  const title = readTrimmedString(entry.title);
  // 没有 title 的条目无法被指认，上屏只会是一行空白谎话。
  if (title === undefined) return null;
  return {
    store: readTrimmedString(entry.store) ?? "",
    listingId: readFiniteNumber(entry.listingId),
    title,
    state: readTrimmedString(entry.state) ?? null,
    sku: readTrimmedString(entry.sku) ?? null,
    quantity: readFiniteNumber(entry.quantity),
    price: readMoney(entry.price),
    url: readTrimmedString(entry.url) ?? null,
  };
}

function readOrderEntry(entry: unknown): MerchantOrderEntryView | null {
  if (!isPlainRecord(entry)) return null;
  // buyer-less 法条在这里是结构性的：只读 receiptId / createdAt / grandTotal，
  // 其余字段（哪怕载格里有买家姓名）一律不进视图。
  return {
    store: readTrimmedString(entry.store) ?? "",
    receiptId: readFiniteNumber(entry.receiptId),
    createdAt: readTrimmedString(entry.createdAt) ?? null,
    grandTotal: readMoney(entry.grandTotal),
  };
}

function readPerStoreEntry(entry: unknown): MerchantPerStoreEntryView | null {
  if (!isPlainRecord(entry)) return null;
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
  // 与 store-search 同款：not_configured 单独成面；其余非 ok 字符串 status
  // 按失败面渲染，分类码取载荷 error 字段、缺席时退回 status 本身——
  // 不认识的分类码不翻译也不吞掉。
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

// ——— 结果读取 ———

/**
 * 记录级读取。接受判据是契约的骨架：`operation` 必须是三种合法操作之一
 * （§-face 的脊柱字段）。读不出合法 operation 的载荷不承载任何 merchant
 * 事实，回 null 走兜底卡——「读不懂」绝不冒充「没有结果」。
 */
function readMerchantReadResultRecord(candidate: unknown): MerchantReadResultView | null {
  const normalized = parseJsonCandidate(candidate);
  if (!isPlainRecord(normalized)) return null;
  const operation = readOperation(normalized.operation);
  if (operation === null) return null;

  const inventory: MerchantInventoryEntryView[] = [];
  if (Array.isArray(normalized.inventory)) {
    for (const entry of normalized.inventory as unknown[]) {
      const view = readInventoryEntry(entry);
      if (view !== null) inventory.push(view);
    }
  }

  const orders: MerchantOrderEntryView[] = [];
  if (Array.isArray(normalized.orders)) {
    for (const entry of normalized.orders as unknown[]) {
      const view = readOrderEntry(entry);
      if (view !== null) orders.push(view);
    }
  }

  const perStore: MerchantPerStoreEntryView[] = [];
  if (Array.isArray(normalized.per_store)) {
    for (const entry of normalized.per_store as unknown[]) {
      const view = readPerStoreEntry(entry);
      if (view !== null) perStore.push(view);
    }
  }

  return {
    operation,
    store: readTrimmedString(normalized.store),
    platform: readTrimmedString(normalized.platform),
    shopSummary: readShopSummary(normalized.shopSummary),
    inventory: Array.isArray(normalized.inventory) ? inventory : undefined,
    orders: Array.isArray(normalized.orders) ? orders : undefined,
    truncated: normalized.truncated === true,
    perStore: Array.isArray(normalized.per_store) ? perStore : undefined,
    notice: readTrimmedString(normalized.notice),
  };
}

/**
 * 结果读取顺序与 store-search/list-models 同一条：`output` 先行，legacy
 * JSON 探针（raw.rawOutput / raw.output / raw.result）兜老会话与非 v4 宿主，
 * 每个候选都按「record 或 JSON 字符串」探一遍。读不出回 null。
 */
export function readMerchantReadResult(
  toolCall: MerchantReadToolCallSource,
): MerchantReadResultView | null {
  const raw = isPlainRecord(toolCall.raw) ? toolCall.raw : null;
  for (const candidate of [toolCall.output, raw?.rawOutput, raw?.output, raw?.result]) {
    const result = readMerchantReadResultRecord(candidate);
    if (result !== null) {
      return result;
    }
  }
  return null;
}

// ——— 工具身份（按名判定，workflowToolNames 的同款纪律） ———

function normalizeToolToken(value: unknown): string {
  // 抹掉大小写与分隔符：`merchant_read` / `MerchantRead` 两种 wire 写法都命中。
  return typeof value === "string" ? value.toLowerCase().replace(/[^a-z0-9]/gu, "") : "";
}

const MERCHANT_READ_TOOL_TOKENS = new Set(["merchantread", "readstore", "storeinsights"]);

/**
 * `merchant_read`（别名 `read_store` / `store_insights`）的按名识别。
 * 判定必须排在 family 分流之前：这个名字不在 shared 的已知工具表里
 * （identity 回 unknown → raw JSON 兜底卡会把 shopSummary/inventory/
 * orders/per_store 原样摊开）；而一旦将来被登记进某个 family，那个兜底
 * 会画成通用卡，丢掉摘要节、库存清单、订单清单与逐店状态。按名先判定
 * 让「登记前 / 登记后」两种世界都成立（store-search 的同款理由）。
 */
export function isMerchantReadToolCall(source: {
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
    return token !== "" && MERCHANT_READ_TOOL_TOKENS.has(token);
  });
}

// ——— 运行态摘要的输入读取（运行中没有 output） ———

/** 从 input / rawInput 读 operation（+ store），运行态摘要主文本全靠它。 */
export function readMerchantReadOperationInput(
  toolCall: MerchantReadToolCallSource,
): { operation: MerchantReadOperationView | null; store: string | undefined } {
  for (const candidate of [toolCall.input, readRawInput(toolCall.raw)]) {
    const normalized = parseJsonCandidate(candidate);
    if (!isPlainRecord(normalized)) continue;
    const operation = readOperation(normalized.operation);
    if (operation !== null) {
      return { operation, store: readTrimmedString(normalized.store) };
    }
  }
  return { operation: null, store: undefined };
}

function readRawInput(raw: unknown): unknown {
  if (!isPlainRecord(raw)) {
    return undefined;
  }
  return raw.rawInput ?? raw.input;
}
