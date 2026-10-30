# commerce-harness-view

一页以内。只写类型与测试表达不了的三样：模块存在的意图、不变量、与其它模块的交集在哪个 hook 点处理。

**意图**：find_best_offer 聊天卡（`../commerce-harness.tsx`，ui 岛 legacy 区）的视图模型——五层 harness 度量结果的防御性读出与展示格式化。拆出为受管模块是为满足两条仓库法：新源码文件必须落在受管模块（unmanaged-new-file），单文件 ≤ 800 行（max-file-lines，原 1170 行的卡面已拆）。

不变量：

- 防御性读取：永不信载荷形状——读不懂的条目整个丢弃，绝不猜、绝不补默认值；「读不懂」与「没有结果」必须可分辨（回 null 交兜底卡）。
- 证据诚实（INV-16/17/30）：evidenceClass 只认 conditional/predicted；observed 是载荷违规，原样暴露但渲染层永不把它画成在售报价。
- 金钱精确（INV-14）：十进制字符串 → BigInt 分；绝不 parseFloat；缺价画 "—"，未知落 unknown。
- locale 纪律：价格固定 en-US 两位小数；日期只取 ISO 前缀——永不被界面 locale / 时区改写。

与其它模块的交集：类型依赖 `ui` 模块的 `ToolCallBlocks/shared.js`（ToolCallBlockRenderContext，type-only）；消费者只有同目录上层的 `commerce-harness.tsx`（其稳定 import 面 `readCommerceHarnessResult` 经它再导出，测试与 resolveRenderer 均不变）。
