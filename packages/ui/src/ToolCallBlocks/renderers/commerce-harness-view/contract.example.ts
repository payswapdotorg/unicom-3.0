/**
 * commerce-harness-view 标准调用示例：agent 靠模仿写代码，这里放的就是该模仿的那份。
 */
import type { CommerceHarnessViewContract } from "./contract.js";

export function exampleCommerceHarnessView(contract: CommerceHarnessViewContract): void {
  // 最常见的一次完整调用：把 ToolCallBlockRenderContext 的 toolCall 交给读取器，
  // 读不出结构化结果（null）时由调用方回退到兜底卡——本模块不渲染、不猜。
  const toolCall = undefined as never; // 示例占位：真实调用方持有 ToolCallBlockRenderContext
  const view = contract.readCommerceHarnessResult(toolCall);
  if (view === null) {
    return; // 「读不懂」≠「没有结果」：交回兜底卡展示原始载荷
  }
  // view.offers / view.opportunities / view.perStore / view.constraintSatisfaction …
  // 消费方（../commerce-harness.tsx）按证据诚实法条渲染：短名单与机会候选永不混排。
  void view;
}
