import { describe, expect, it } from "vitest";

import { genUiServiceModule } from "./module.js";
import { IGenUiService } from "./contract.js";

// 契约测试只 import contract 与 module，不知道实现是谁；同一份测试应同时跑真实现与跨进程代理。
// （补齐 managed 模块五件套缺失的 contract.test.ts —— 架构门禁 missing-module-artifact 的诚实修复；
// 由 TL 于 2026-10-30 添加，只钉住清单与描述符，不改任何实现。）
describe("gen-ui-service contract", () => {
  it("declares its module manifest", () => {
    expect(genUiServiceModule.id).toBe("gen-ui-service");
    expect([...genUiServiceModule.requires]).toContain("services");
    expect([...genUiServiceModule.provides]).toContain("gen-ui-service");
  });

  it("exposes the gen-ui service descriptor on its declared channel", () => {
    expect(IGenUiService.channelName).toBe("gen-ui");
  });
});
