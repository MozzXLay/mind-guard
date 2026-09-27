# 净界 MindGuard

Ubuntu 24.04 优先的离线桌面应用。当前完成 M0：首次引导、响应式桌面壳、锁定与解锁、加密目标存储、今日空态、无需记录的 SOS、主题和自动锁定、加密备份与恢复。产品基线见 [docs/05-Codex开发任务说明.md](docs/05-Codex开发任务说明.md)，安全决定见 [docs/06-M0-安全决策与威胁模型.md](docs/06-M0-安全决策与威胁模型.md)。

## 开发运行

```bash
bash docs/scripts/setup-ubuntu-dev.sh --check
npm ci
npm run tauri dev
```

首次进入选择目标并设置至少 12 字符的主密码。密码丢失无法恢复旧数据库。目标可以暂不选择。应用数据位于 Tauri 的应用数据目录（Ubuntu 通常为 `~/.local/share/app.mindguard.desktop/`）；开发或测试时可设置 `XDG_DATA_HOME` 指向隔离目录。不要用浏览器直接打开 Vite 开发地址来输入真实数据，浏览器没有 Tauri 的本地命令桥。

## 检查与构建

```bash
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml --lib
npm run tauri build -- --no-bundle
```

打包前需要 Ubuntu 24.04 的 WebKitGTK 4.1 开发包、GTK/ayatana、构建工具、Rust 和 Node.js；使用 AppImage 时还需 `patchelf`。`docs/scripts/setup-ubuntu-dev.sh --check` 会检查主要系统依赖。SQLCipher 通过 Rust 依赖捆绑构建，发布包仍需在干净 Ubuntu 24.04 机器上检查动态库、安装、启动、备份与恢复。当前构建目标列出 `.deb` 和 AppImage，发布包尚未完成跨机验收。当前检查记录见 [docs/07-M0-验证记录.md](docs/07-M0-验证记录.md)。

纯前端布局检查可在 Vite 开发服务器下打开 `/tests/ui-preview.html` 和 `/tests/ui-preview.html?view=shell#/today`。此测试页只渲染无数据界面，不连接或创建真实用户库，也不会进入正式前端构建。

## 当前范围与风险

- `records`、`plan` 编辑、`insights`、`journal` 是明确的 M1 空态；今天没有假记录或假统计。引导时选择的目标已加密保存，但编辑目标尚未开放。
- Firefox/Chromium 扩展、Native Messaging、规则及拦截页属于 M2；屏蔽页明确显示未生效。托盘、开机启动、全局快捷键及发布安装包验收属于后续切片。
- 自动锁定默认 10 分钟，可选 5/10/30 分钟；页面收到隐藏事件时立即锁定。系统缩略图、交换区和同一登录会话内的恶意程序不属于可保证保护的范围。
- 备份默认写入应用私有 `backups/`，界面显示完整文件位置；恢复需选择 `.mgb`、输入备份密码、验证并预览后确认替换。M0 备份文件上限 128 MiB。当前不提供明文导出或清空库操作。
- Argon2id 参数、SQLCipher 在 Linux 打包后的行为和断电恢复须在发布前进一步实测，细节见安全决策文档。
