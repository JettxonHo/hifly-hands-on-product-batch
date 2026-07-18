# GUI Artifact Download Design

## Goal

让运营在本地 GUI 中直接下载已生成的视频产物，同时保持现有安全边界：前端不能拿到批次内部 artifact 路径映射表，也不能用任意路径读取本地文件。

## Scope

- 后端继续使用现有 `GET /api/artifacts/:batchId/:artifactId` 路由。
- 路由只接受已登记在 batch manifest 里的 artifact。
- GUI 在已完成任务和抓包 HTTP 成功摘要中展示“下载产物”按钮。
- 保留现有“复制路径”按钮，便于运营做本地排障或交付记录。

## Public Data Contract

`publicBatch()` 仍只在 `artifacts` 数组里公开 `artifact_id`，不公开 `relative_path`。为了让任务行能找到下载入口，服务端会在公开任务对象中为匹配 `output_path` 的任务补充：

```json
{
  "output_path": "artifacts/video.mp4",
  "output_artifact_id": "640509"
}
```

该字段只来自当前批次已登记 artifact 的精确路径匹配。没有匹配时不展示下载按钮。

## Backend Behavior

Artifact 下载路由在返回文件前必须校验：

- `batchId` 合法。
- `artifactId` 存在于当前 batch。
- artifact 路径是 batch-relative safe path。
- realpath 仍在当前 batch 目录内。
- 文件是普通文件，且不是 symlink。

响应使用 `Content-Disposition: attachment`，文件名来自已校验路径的 basename，避免浏览器直接预览或使用不清晰的下载名。

## GUI Behavior

- 任务行：有 `output_artifact_id` 时展示“下载产物”和“复制路径”。
- 抓包 HTTP 成功摘要：优先从该批次已完成任务里查找同路径 artifact ID，展示“下载产物”和“复制路径”。
- 运行记录复用相同组件。
- 不做“打开 Finder/Explorer”，避免跨平台和浏览器权限差异。

## Verification

- API 安全测试覆盖授权 artifact 下载、跨批次 artifact 拒绝、traversal 拒绝、下载响应头。
- API 测试覆盖 public item 的 `output_artifact_id` 映射且不泄露 artifact `relative_path`。
- GUI smoke 覆盖完成任务和抓包 HTTP 摘要里的“下载产物”按钮。
- 该改动不访问飞影、不跑真实 HTTP、不消耗积分。
