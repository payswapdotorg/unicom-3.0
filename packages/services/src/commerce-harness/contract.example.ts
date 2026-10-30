/**
 * commerce-harness 标准调用示例：agent 靠模仿写代码，这里放的就是该模仿的那份。
 *
 * 最常见的一次完整调用：一条买家 intent 穿过 L1→L5（R4 入口），端口全部由调用方
 * 绑定——本示例绑定的是带标签的 fixture 端口（fixture 域 *.fixture.invalid，绝不
 * 生产可达）。真实调用方把 readStores 绑到 StoresService、executeStep 绑到已交付
 * 的 store_search 连接器——模块本身永不 I/O（见 contract.ts 的前置条件）。
 */
import { runHarnessFlow } from "./planner.js";
import type { ConnectedStoreRecords } from "./planner.js";
import type { StepExecutor } from "./execution.js";
import type { StoreConnectionRecord } from "../stores/stores.js";

const EXAMPLE_FIXTURE_STORE: StoreConnectionRecord = {
  id: "example-fixture",
  platform: "bigcommerce",
  domain: "example.fixture.invalid",
  label: "Example Fixture Store",
  tier: "public",
  connectedAt: "2026-10-30T00:00:00.000Z",
  status: "ok",
};

export async function exampleCommerceHarness(): Promise<void> {
  const result = await runHarnessFlow({
    intent: {
      query: "running shoes",
      maxLandedTotalCost: { amount: "400.00", currency: "HKD" },
      consentBasis: "read-only-search",
      provenance: { surface: "contract example", expressedAt: "2026-10-30T00:00:00.000Z" },
      // 未表达的约束一律记录 UNKNOWN（INV-10），绝不猜测。
      unknowns: ["size", "brand", "condition", "geography", "deadline", "excludedStores"],
    },
    readStores: async (): Promise<ConnectedStoreRecords> => ({
      stores: [EXAMPLE_FIXTURE_STORE],
    }),
    executeStep: (async () => {
      throw new Error("bind the committed store_search connectors here");
    }) as StepExecutor,
    now: () => new Date("2026-10-30T00:00:00.000Z"),
  });

  // L5 法则：observed shortlist 与 conditional/predicted opportunities 永不混排。
  console.log(result.outcome.success, result.shortlist.length, result.opportunities.length);
}
