# dsh-folder-attach

在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 **Web 浏览器界面**里，为对话输入框添加文件夹引用。

> [English](README.en.md) · 需要 dsh `>= 0.2.0-rc.2`

## 背景

DSH 的输入框对"拖入/粘贴文件夹"有一条硬性限制：

```js
const bridge = globalThis.__DSH_HOST_PATHS__;
if (bridge === void 0 && directory) return t("attachment.directoryDesktopOnly");
// → "只有桌面端支持添加文件夹，浏览器里请添加单个文件"
```

浏览器出于安全**不会**给出拖入文件夹的绝对路径，只有桌面端（Electron shell 注入 `__DSH_HOST_PATHS__`）能把 `File` 映射回真实路径。而 `@deepseek-ai/dsh` 目前**没有发布桌面端**：`dsh web` 只有 `--host/--port/--no-open/--trusted-host`，全量搜索也没有任何包写入该全局。

本插件不去绕过这个限制，而是**换一个问题来源**：不问浏览器要路径，问宿主机要。

## 原理

Web 界面分两半：浏览器里的 client，和你机器上的 Node host。浏览器是沙箱化的，**host 不是**。

DSH 已经自带一个宿主目录选择能力（`dsh-host-directory-picker-auto`）。在 macOS + 回环绑定时它解析成 `native` 后端，在**宿主机**上执行：

```
osascript -e 'choose folder' -e 'POSIX path of selectedFolder'
```

返回一个真实的绝对路径。插件把它接到输入框上——桌面端那条判定根本不会被触发。

拖入的文件夹则用 `fileReferences/list`（`@` 补全菜单背后的同一个索引）按名称解析：一次调用，宿主自己的模糊索引，已排除 `node_modules` 等。

## 功能

| 入口 | 行为 |
|---|---|
| 输入框左侧「添加文件夹」 | 在宿主机弹出系统文件夹对话框，选中后插入 `@目录/` |
| `/folder` 命令 | 同上 |
| 拖入 / 粘贴文件夹 | 按名称在工作区内解析，插入 `@目录/`；同批普通文件走原有上传通道 |

插入的是**标准 `@路径` mention**，与桌面端拖文件夹产生的等价：工作区内用相对形式，工作区外保留绝对形式，含空格自动加引号。

## 安装

```bash
dsh plugin --profile web add dsh-folder-attach
```

或在侧边栏 **插件 → 添加插件** 输入 `dsh-folder-attach`。装完刷新浏览器页面。

<details>
<summary>从源码安装</summary>

```bash
git clone https://github.com/sixzjd/dsh-folder-attach.git
cd ~/.dsh/profiles/web        # 或你的 profile 目录
dsh plugin --profile web add /path/to/dsh-folder-attach
```

</details>

## 卸载

```bash
dsh plugin --profile web remove dsh-folder-attach
```

或在插件页关闭开关。插件只在浏览器内注册一个 composer 槽位、一个斜杠命令和两个事件监听器，不写任何全局对象，卸载即无痕。

## 开发

```bash
npm test          # 两个回归测试
npm run check     # 语法检查 + 测试
```

无需构建：`dsh-client-modules` 把 `lib/client.js` **逐字节原样**作为浏览器 bundle 服务，所以它按 `window.__ModuleLoader__.load` 格式手写。

| 文件 | 作用 |
|---|---|
| `lib/index.js` | 空的宿主侧 `apply`，让包成为 Loader 条目、从而被扫描到 |
| `lib/client.js` | 全部行为 |
| `cordis.patch.yml` | 该 bundle 启用时贡献的组合层 |
| `locale/{en,zh}.json` | 插件页显示名（**`en.json` 必须存在**，否则 `zh.json` 不会被读取） |

## 依赖的公开接缝

只用官方声明过的扩展点，不改写官方代码、不打 monkeypatch：

- `ctx.slots.inject("conversation.input.left", …)` — 官方文档点名的 composer 扩展位
- 该座位的标准 props：`sessionId`、`inputActions`、`t`
- `ctx.commandUi.register({ name: "folder", ui: { kind: "action" } })`
- `ctx.remote.directoryPicker.pick()` — 宿主系统对话框，返回绝对路径
- `ctx.remote.fileReferences.list(sessionId, query)` — `@` 菜单背后的索引查询

## 已知限制

- **拖入/粘贴**的文件夹只能按名称在工作区内解析。浏览器不给路径，这无法回避；解析不到时明确报错并提示改用对话框，不会猜一个路径。
- 拖入产生的是 `@目录/` **纯文本 mention**，不是桌面端那种带图标的文件夹 chip——chip 需要真实路径。功能等价，外观不同。
- 索引查询有返回上限，极端情况下同名文件夹可能不在候选里，此时按未解析处理。
- 若 profile 把目录选择解析成 `browse` 后端（远程 / SSH 访问），系统对话框不可用，`pick` 会拒绝并提示；此时仍可用拖拽解析。
- 插件页显示名依赖 `locale/en.json` 存在。

## 为什么它能活过 dsh 升级

兼容性闸门只校验 `peerDependencies` 里 `@deepseek-ai/dsh*` 前缀的版本，本插件不声明它，因此升级不会让 bundle 被跳过。真正的风险是上面那些接缝改名——那时表现是**静默不显示**，不会拖垮 DSH。

## 许可

MIT
