# 远程同步功能计划（探讨稿，暂缓实现）

> 状态：**已搁置（deferred）**。本文档是后续实现参考，不急于开发。

## 1. 目标与背景

- 已有本地增量导入（收件夹 inbox + `mergeDatabase`）
- 需要跨设备远程同步，参考幕布"本地优先 + 云端权威"的同步精神
- 约束：无自有服务器，只能使用免费文件托管作为"远端"
- 用户偏好：**以远程为主（含删除传播）+ 应用提示 + 手动同步**、图片需要同步

## 2. 传输层选型（尚未最终确定）

可行性已分析完毕，统一抽象为 `RemoteTransport` 接口，引擎与之解耦，可后补/替换。

| 方案 | 结论 | 备注 |
|---|---|---|
| GitHub 私有仓库（Contents REST API） | 可行 | 100MB/文件硬限、5000 次/时、需 PAT；国内网络不稳定 |
| Cloudflare R2（S3 兼容） | 可行，推荐候选 | 10GB 免费、按对象存储、无历史膨胀 |
| WebDAV + 坚果云 | 可行，**国内最佳候选** | 免费 1GB 上传/月，Obsidian 生态已验证 |

> 决策待定：优先实现哪个传输层。引擎不受影响。

## 3. 同步算法：三向状态决策矩阵（最终模型）

**原理**：对每个条目记录三方状态——当前本地 L / 当前远端 R / 上次一致时记录 S（`sync-state.json`，**每条目一个状态**，而非单一全局同步时间）。先判存在性，再比修改时间。

```
L 无, R 有, S 无  → 新远端条目     → 拉
L 有, R 无, S 无  → 新本地条目     → 推
L 无, R 有, S 有  → 远端删了       → 删本地（删除传播）
L 有, R 无, S 有  → 本地删了       → 删远端（删除传播）
L 有, R 有：
  仅本地比 S 新 → 推
  仅远端比 S 新 → 拉
  两边都比 S 新 → 冲突 → 裁决
  都没变        → 跳过
```

**冲突裁决**：**后改者胜（`updated_at` 大者赢），平局时以远程为主**。删除用存在性判断，与修改时间互补。

**范围**：
- tasks / categories：逐行走矩阵（`updated_at` 判断改动）
- images：按文件哈希增量上传/删除
- settings：**不同步**（机器偏好，避免跨设备污染）

**运行顺序（先拉后推）**：
1. 拉远端 db + 图片清单
2. 按矩阵判定 → 得到合并后的本地内容 + 待删列表
3. 合并写回本地库
4. 推送：db 整文件覆盖远端 + 图片逐文件增量增/删
5. **全部成功才原子更新 `sync-state.json`**；中途失败不更新（防误判）

**边界**：首次同步（S 空 → 只记录不删，不丢数据）、崩溃/断网重跑、时钟偏移（加宽限值或服务端时间校准）、远端指纹（HEAD 比对即知云端是否变化，作为"应用提示"基础）。

## 4. 架构（待实现）

**新增 `electron/main/remote-sync/`**
- `types.ts`：`RemoteTransport` 接口（拉/推/列/删）、`SyncConfig`、`SyncResult`、进度事件
- `github.ts` / `webdav.ts`（按选型实现其一）
- `manifest.ts`：读写 `sync-state.json`
- `sync-engine.ts`：矩阵编排 + 合并 + 推送，发进度/结果事件

**改动**
- `electron/main/database/import-merge.ts`：抽远程优先合并（或新文件 `remote-merge.ts`）
- `electron/main/ipc.ts`：`sync:getConfig/saveConfig/run/testConnection`
- `electron/main/index.ts`：启动后定时 HEAD 远端指纹，变化时 `webContents.send('sync:available')`（只提示不自动同步）
- `electron/preload/index.ts` + `src/types/electron.d.ts`：`syncRun/getConfig/saveConfig/testConnection/onSyncEvent`
- `src/types/task.ts`：Settings 增加同步字段
- `src/components/settings-dialog.tsx`：远程同步区块（仓库/WebDAV 配置、Token 加密、测试连接、立即同步、状态回显）
- `src/App.tsx`：`onSyncEvent` → toast 提示"云端有新数据，是否同步？"

**安全**：凭据用 Electron `safeStorage`（Windows DPAPI）加密存储，绝不落日志。

**测试**：`tests/remote-merge.test.ts`（矩阵各情形：拉/推/冲突/删除传播/首同步）、`tests/<transport>.test.ts`（mock fetch）。

**依赖**：零新增（fetch / zlib / crypto 内置）。

## 5. 待办决策（实现前需定）

- [ ] 传输层首选：WebDAV(坚果云) / GitHub / R2
- [ ] 同步入口：设置页内按钮 + 启动/定时提示（已定"提示+手动"）
