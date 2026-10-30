/**
 * commerce-harness 对外契约：调用方要想正确调用就必须知道的一切都写在这里；其余对外不可见。
 * 每个方法注释写清：前置/后置条件、幂等性、发出哪些事件、是否等待持久化。
 *
 * 本文件是模块的"一个意图一个方法"门面——真实类型与实现分散在 L1→L5 的各文件里
 * （intent/plan/evaluation/execution/families/outcome/planner/opportunity-lifecycle/
 * federation(-wire)/browser-transport/merchant-execution/benchmark(-corpus)），本契约
 * 只钉住调用方的四个入口与它们的法则。完整契约文档：HARNESS-CONTRACT.md（UniCom
 * 仓库 spec/architecture/）+ 本目录 CONTRACT.md。
 */
import type { HarnessFlowInput, HarnessFlowResult } from "./planner.js";
import type { BenchmarkRunResult } from "./benchmark.js";
import type {
  HarnessOpportunityCandidate,
} from "./families.js";
import type {
  GeneralizedDemandShape,
  OpportunityLifecycleRecord,
  ShareConsent,
} from "./opportunity-lifecycle.js";
import type { FederationNode, FederationNodeOptions } from "./federation.js";

/** The module's opaque record id (a stable content hash — never user data). */
export type CommerceHarnessId = string & { readonly __brand: "CommerceHarnessId" };

export interface CommerceHarnessContract {
  /**
   * L1→L5 buyer flow（R4 入口）。前置：intent 合法（未知约束已落 unknowns）、
   * readStores/executeStep 由调用方绑定（本模块不 I/O）。后置：OutcomeRecord 含
   * shortlist（observed）与 opportunities（conditional/predicted）——两者永不混排。
   * 幂等：纯函数式编排；authority gate 在任何 transport 调用之前。
   */
  runBuyerIntentFlow(input: HarnessFlowInput): Promise<HarnessFlowResult>;

  /**
   * L5 benchmark（R7 入口）。前置：固定 now 则字节可复现。后置：meta.tier === "fixture"、
   * comparatorsSimulated === true、liveTierOwed === true；无任何倍数语言。
   */
  runBenchmarkCorpus(input?: { now?: () => Date }): Promise<BenchmarkRunResult>;

  /**
   * W2 lifecycle：候选 → 持久化记录（active/expired/revoked/realized/abandoned）。
   * 后置：原始 candidate 永不被突变；每次转换产生审计事件。"currently available"
   * 只有在新鲜独立观察（verifyFreshnessGate）之后才允许（issue #23 W2 法）。
   */
  registerOpportunityCandidate(
    candidate: HarnessOpportunityCandidate,
    consent: ShareConsent,
    now: Date,
    generalized?: GeneralizedDemandShape,
  ): OpportunityLifecycleRecord;

  /**
   * W2/W3 federation：发布 → 隐私门 → 校验链 → 本地条件记录 → 匹配/撤销/过期传播。
   * 前置：transport port + 注入时钟。后置：私有 intent 永不上线；远端记录永远
   * conditional；match 是纯读，绝不预留/购买/发布/授权。
   */
  createFederationNode(options: FederationNodeOptions): FederationNode;
}
