/**
 * commerce-harness-view 对外契约：调用方要想正确调用就必须知道的一切都写在这里；其余对外不可见。
 * 本模块只有一个消费者（../commerce-harness.tsx 的聊天卡）；契约面 = 视图读取入口 + 视图类型。
 */
import type {
  CommerceHarnessResultView,
  CommerceHarnessToolCallSource,
} from "./view.js";

/** The view module's opaque record id (unused at runtime — the view is value-typed). */
export type CommerceHarnessViewId = string & { readonly __brand: "CommerceHarnessViewId" };

export interface CommerceHarnessViewContract {
  /**
   * 从 toolCall 的 output / legacy JSON 探针防御性读出五层度量结果的视图。
   * 前置：toolCall 形状由 ToolCallBlockRenderContext 保证；载荷内容不受信。
   * 后置：读不出结构化结果回 null（「读不懂」≠「没有结果」）；读出的视图
   * evidenceClass 永不可能是 observed 的渲染依据（见 view.ts 法条注释）。
   * 幂等：纯函数。
   */
  readCommerceHarnessResult(toolCall: CommerceHarnessToolCallSource): CommerceHarnessResultView | null;
}
