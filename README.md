# dsh-folder-attach

[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com) [![npm version](https://img.shields.io/npm/v/dsh-folder-attach)](https://www.npmjs.com/package/dsh-folder-attach) [![npm downloads](https://img.shields.io/npm/dm/dsh-folder-attach)](https://www.npmjs.com/package/dsh-folder-attach)
[![test](https://github.com/sixzjd/dsh-folder-attach/actions/workflows/test.yml/badge.svg)](https://github.com/sixzjd/dsh-folder-attach/actions/workflows/test.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

DSH 的网页界面拖入文件夹会被拒绝：「只有桌面端支持添加文件夹，浏览器里请添加单个文件」。
这个插件补上拖文件夹、`/folder`、主机文件夹选择框，插入标准 `@路径` 引用。

**浏览器和桌面端都可以用**，不需要某个专门的“桌面版客户端”：这里的“桌面端”限制指的是 Electron 外壳注入的 `__DSH_HOST_PATHS__` 桥，而这个插件正是为**没有那个桥**的环境提供替代路径来源。有桥时（桌面 Electron）插件会优先用真实路径，效果更好；没桥时（纯浏览器）改用宿主目录对话框或按名称解析。

> [English](README.en.md) · 需要 dsh `>= 0.2.0-rc.2`

## 背景

DSH 的输入框对"拖入/粘贴文件夹"有一条硬性限制：

```js
const bridge = globalThis.__DSH_HOST_PATHS__;
if (bridge === void 0 && directory) return t("attachment.directoryDesktopOnly");
// → "只有桌面端支持添加文件夹，浏览器里请添加单个文件"
```

浏览器出于安全**不会**给出拖入文件夹的绝对路径，只有 Electron 外壳注入 `__DSH_HOST_PATHS__` 时能把 `File` 映射回真实路径。本插件不去绕过这个限制，而是**换一个问题来源**：不问浏览器要路径，问宿主机要。

Web 界面本身就运行在你机器上的 Node host 之上（桌面 App 里是内嵌 host，`dsh web` 里是独立 host），两者共用同一套 client/host 远程能力。所以“桌面端 / 浏览器”在这里不是两套客户端，而是**同一个 Web 界面有没有那个路径桥**的区别。

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

插入的是**标准 `@路径` mention**，与 `@` 补全菜单选目录产生的形式一致：工作区内用相对形式，工作区外保留绝对形式，含空格自动加引号。

注意 DSH 的引用识别要求 `@` 位于**行首或空白之后**；因此若输入框里已有文字且末尾不是空白，插件插入前会补一个空格，确保 mention 被识别成蓝色的文件夹引用而不是普通黑字。

## 安装

```bash
dsh plugin --profile web add dsh-folder-attach
```

也可以从 GitHub 装（同一份源码，可钉到某个 tag）：

```bash
dsh plugin --profile web add github:sixzjd/dsh-folder-attach
```

也可以在侧边栏 **插件 → 添加插件** 里填上面的地址。装完刷新浏览器页面。

<details>
<summary>从源码安装</summary>

```bash
git clone https://github.com/sixzjd/dsh-folder-attach.git
cd ~/.dsh/profiles/web        # 或你的 profile 目录
dsh plugin --profile web add ./dsh-folder-attach
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

- **无路径桥时**（纯浏览器）拖入/粘贴的文件夹只能按名称在工作区内解析；有路径桥时（桌面 Electron）优先用拖入项的真实路径，更精确。解析不到时明确报错并提示改用对话框，不会猜一个路径。
- 拖入产生的是标准 `@目录/` mention，在输入框和已发送消息里会渲染成**文件夹引用**。DSH 的文件夹引用是**不可点击跳转**的（官方设计如此，`@` 菜单选出的文件夹也一样），只有文件引用可点开预览；本插件不改写官方渲染，因此保持一致。
- 索引查询有返回上限，极端情况下同名文件夹可能不在候选里，此时按未解析处理。
- 若 profile 把目录选择解析成 `browse` 后端（远程 / SSH 访问），系统对话框不可用，`pick` 会拒绝并提示；此时仍可用拖拽解析。
- 混合拖拽（文件夹 + 图片）时，插件会复刻 composer 的图片数量/体积预检，**但只统计本次拖入的图片**：已挂载的附件没有任何公开接口可读。宿主侧 `validateImageBatch` 仍按整条消息强制校验，所以这不是漏洞，只是提示可能来得更早、口径更宽。
- 插件页显示名依赖 `locale/en.json` 存在。

## 为什么它能活过 dsh 升级

兼容性闸门只校验 `peerDependencies` 里 `@deepseek-ai/dsh*` 前缀的版本，本插件不声明它，因此升级不会让 bundle 被跳过。真正的风险是上面那些接缝改名——那时表现是**静默不显示**，不会拖垮 DSH。

## 许可

MIT
