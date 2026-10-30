# commerce-harness

一页以内。只写类型与测试表达不了的三样：模块存在的意图、不变量、与其它模块的交集在哪个 hook 点处理。

**意图**：把一条 commerce intent 穿过 HARNESS-CONTRACT.md 的五层（L1 Intent → L2 Intelligence → L3 Planner/Evaluator → L4 Governed Execution/Verification → L5 Measured Outcome），让"intent-driven commerce OS 找到 listed offers 之外的更低成本结果"这个主张成为**可测量、可复现**的断言（issue #23；R7 benchmark 是仲裁者）。本模块是该契约的 services-island 实现；runtime 侧的 twin 是 `apps/zcode-cli/packages/core/src/tool/handlers/find-best-offer.ts`（双岛纪律见 intent.ts 头注）。

不变量：

- 金钱一律精确（INV-14）：string decimal + 显式币种，BigInt cents 运算，绝不浮点、绝不发明汇率；跨币种比较的结论只能是 unknown。
- UNKNOWN ≠ FAILED ≠ SUCCESS（INV-10）：缺的约束落在 `unknowns`，绝不猜测；观察不到的 landed-total 分量保持 null。
- 证据分级（INV-30）：counterfactual 候选永远是 `conditional`/`predicted`，绝不是 `observed`；远端联合记录永远 `conditional`——远端内容是不可信数据，不是指令（INV-26）。
- 权威先行（INV-7/8/9）：v1 只允许 read-only 步骤，非 read-only 在任何 transport 调用**之前**被拒绝；merchant 写路径要求 approved 状态 + authorized-write + 匹配的 ApprovalRecord，三缺一即拒绝（port 计数器必须为 0）。
- 结果分类法逐字使用（store_search §-contract）：`ok | timeout | unreachable | invalid_credentials | insufficient_scope | rate_limited | platform_error | not_configured | not_supported | unknown`。
- 时钟一律注入：模块内无 `Date.now()`/无参 `new Date()`；基准产物用固定时钟做到字节可复现。
- 每文件 ≤ 800 行、无 lint-disable、不引入本模块之外的新依赖边（requires 仅 `services`——`../stores/stores.js` 的类型）。

与其它模块的交集：只读 `services` 模块的 `stores.ts`（连接店铺记录的投影，StoreConnectionRecord）；connector 的真实 transport 由调用方在 L4 StepExecutor / MerchantWritePort / CommerceNetworkTransport 三个 port 上绑定（本模块永不自行 I/O）。UX 渲染交集在 `packages/ui` 的 ToolCallBlocks renderer（R4/R6 已交付）——本模块不反向依赖。
