## Release CI Pitfalls

### 1. `--win.sign=false` 在 CI 中不可用
- `electron-builder --win --win.sign=false` 会导致参数解析失败，因为点号格式不被 CLI 支持
- 根本原因：没有代码签名证书时，electron-builder 会自动跳过签名，不需要显式参数
- **做法**：让 CI 自动处理，不要加 `--win.sign=false`

### 2. Git tag 触发 implicit publishing
- 当存在 git tag 时，electron-builder 会自动尝试发布到 GitHub Releases
- 这需要 `GH_TOKEN` 环境变量，而 CI 中没有
- **做法**：使用 `--publish=never` 禁用自动发布，用 `softprops/action-gh-release` 手动上传

### 3. Tag 更新流程
- 每次修复后：`git push main` → `git tag -d v1.1.1` → `git push origin --delete v1.1.1` → `git tag v1.1.1` → `git push origin v1.1.1`
- 新的 tag 必须指向包含修复的 commit

### 检查清单
- [ ] `dist:ci` script 包含 `--publish=never`
- [ ] 不要加 `--win.sign=false`
- [ ] tag 重新推送后等待 Actions 完成
- [ ] Actions 完成后检查 Release 页面是否有 artifact
