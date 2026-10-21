# Windows 安装器

使用项目锁定的 Tauri CLI 2.12.3 的 NSIS 模板。应用显示名称为「梦鲸词汇」，安装目录名为 `Dreamwhale`。

- 当前用户首次安装默认 `%LOCALAPPDATA%\Programs\Dreamwhale`。
- 全机器安装预留使用 `Program Files\Dreamwhale`；当前配置仍是当前用户安装。
- 已有安装沿用注册表中的目录，显式 `/D=` 参数和手动选择继续有效。
- 应用标识、卸载登记、快捷方式和存档位置沿用原配置。

模板来源：[Tauri CLI 2.12.3](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.12.3/crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi)。使用其 [MIT 许可](TAURI-LICENSE-MIT.txt)。

上游模板 SHA-256：`8ae02c66f8adb4a0d15d97f984fbacd2b44262d8a4d03fefaf6177f67f7008e5`。

本地差异是目录名常量、目录选择器的追加名称和各安装模式的默认目录。升级 Tauri CLI 时应对照对应版本模板保留这些差异，并检查首次安装、既有目录恢复及手动指定目录。
