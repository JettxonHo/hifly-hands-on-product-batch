# 2026-08-12 P2-02 企业人物素材登记实现记录

## 范围与身份

- Issue：#128
- 分支：`codex/p2-02-enterprise-avatar-materials`
- 实现角色：`IMPLEMENTER`
- requested custom agent：`luna-worker`
- 配置模型：`gpt-5.6-luna`；配置状态：`CONFIG_VERIFIED`
- 运行时模型元数据不可见：`UNVERIFIED_RUNTIME_MODEL`
- 未使用或生成 Terra。

## 已完成行为

1. 现有资产服务接受 `avatar_image`，缺省 kind 仍是 `product_image`，版本核验继续使用原 SHA-256 checksum。复用现有上传/完成/verification 流程；相同 Asset 上以不同 kind 建新版本会被拒绝。
2. 管理员可登记当前 Organization 内已核验、available 的 `avatar_image` AssetVersion。保存 display name、description、authorization status/expiry、可选显式 verified capability Evidence 和归一化 category tags。没有 Evidence 的登记保持 `unverified`，不自动声明 hands-on-product。
3. AvatarVersion 保存 material link；workspace gate 在 memory 与 PostgreSQL 中根据关联 Asset/AssetVersion 当前状态派生 `materials_accessible`。同一 Organization + material version 重试不新增 AvatarAsset。
4. 仅非 controlled enterprise AvatarAsset 可禁用。禁用提升 revision，历史 selection 不删除，但 catalog gate 阻止新确认；受控 seed 和 public synced records 不允许通过该动作变更。
5. 管理/API/Workspace projection 只返回安全字段；不返回 object key、upload token 字段、provider ID、内部 seed key/material link 或 Mac 路径。公共同步记录 category tags 保持空数组。
6. `web/avatar.html/js/css` 增加管理员上传、核验等待、登记、状态检查、category tags、能力标签和禁用；成员端管理表单/禁用按钮隐藏但仍可浏览/确认。内部 Evidence reference 不在界面展示，公共同步人物与受控预置人物使用不同来源标签。
7. 新增本地-only Local Agent mapping CLI：

   ```bash
   npm run local-agent:avatar-map -- set <avatar_asset_version_id> /absolute/path/to/person.png --config /absolute/path/to/config.local-agent.json
   npm run local-agent:avatar-map -- list --config /absolute/path/to/config.local-agent.json
   npm run local-agent:avatar-map -- remove <avatar_asset_version_id> --config /absolute/path/to/config.local-agent.json
   ```

   CLI 只读写本地 JSON，保持 `avatar_asset_version_paths` 结构，要求绝对存在的本地文件，不执行云端请求或上传路径。
8. 生产 migration 后置新增 `src/work-verification/migrations/003_preserve_avatar_image_kind.sql`，保留 `product_image`、`avatar_image`、`work_video`。不修改已经应用的 work-verification 001/002；先行 assets migration 也保留已有 `work_video`，避免升级时暂时收窄约束；相关 migration order 和 PostgreSQL regression 已补齐。AvatarSelection migration 003 增加 material link/category tags/revision 与 update guard。

## 验证记录

- `node --test test/avatar-materials-service.test.js test/avatar-selection-api.test.js test/local-agent-package-compiler.test.js`：19/19 pass。
- `node --test test/avatar-selection-browser.test.js`：2/2 pass，覆盖管理员登记/禁用与成员只读页面。
- `node --test test/assets-service.test.js test/assets-api.test.js test/avatar-materials-service.test.js test/avatar-selection-api.test.js test/local-agent-package-compiler.test.js test/production-deployment.test.js test/production-start.test.js test/avatar-selection-browser.test.js`：69/69 pass。
- `npm run check`：通过，检查 213 个 JavaScript 文件；`git diff --check` 通过。
- 独立复跑 `node --test --test-concurrency=4 test/*.test.js`：949 total / 935 pass / 14 既有 environment skip / 0 fail；实现代理首次完整运行中的单项失败未复现。
- 使用本机 PostgreSQL 16 隔离 schema 实跑 `test/avatar-selection-postgres.integration.test.js`：1/1 pass。验证 asset schema v2、avatar schema v3、work-verification schema v3 的迁移顺序，并证明企业人物禁用后不能通过数据库更新重新启用。其余关联 PostgreSQL migration tests 同轮为 2 pass / 1 既有环境 skip。
- 本轮未访问真实 Hifly/DeepSeek，未运行真实 Local Agent，未触发 Playwright/Capture production flow，积分消耗 0。

## 独立审查结论与边界

- Sol 独立审查修正三项：企业人物数据库状态只允许 `active -> disabled` 且 revision 精确加一；GUI 不再显示内部 Evidence reference；公共同步人物不再误标为「受控预置」。对应 browser/PostgreSQL 回归已通过。
- 未做 P2-03 品类推荐、自动确认、真实 Provider 能力核验或云端部署；这些仍是后续独立范围。
