<div align="center">
  <img src="public/icon/128.png" width="88" height="88" alt="翻翻 Sidekick Logo" />
  <h1>翻翻 Sidekick</h1>
  <p><strong>隐私优先的全能型浏览器 AI 助手（Chrome MV3）</strong><br/>沉浸式网页 / PDF / 视频双语字幕翻译 · 网页与视频音轨总结问答 · 浏览器自主操作 Agent（BYOK）</p>
  <p>
    <a href="./README.md">English</a> | <strong>简体中文</strong>
  </p>
  <p>
    <a href="https://github.com/yoko19191/sidekick-browser-extension/releases"><img src="https://img.shields.io/github/v/release/yoko19191/sidekick-browser-extension?style=flat-square&label=Release" alt="Release" /></a>
    <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-green.svg?style=flat-square" alt="License" /></a>
    <img src="https://img.shields.io/badge/Chrome-MV3-4285F4?style=flat-square&logo=googlechrome&logoColor=white" alt="Chrome MV3" />
    <img src="https://img.shields.io/badge/BYOK-%E7%BA%AF%E6%9C%AC%E5%9C%B0%E7%9B%B4%E8%BF%9E-10b981?style=flat-square" alt="BYOK" />
  </p>
</div>

---

## 为什么选择「翻翻 Sidekick」？

**翻翻 Sidekick** 是一款集成了 **沉浸式网页翻译、视频双语字幕、长文档/PDF/视频总结问答、以及浏览器自动化 Agent** 的开源 Chrome 扩展。

不同于需要绑定账号订阅、或将浏览数据中转至第三方服务器的商业插件，翻翻采用 **100% 纯客户端架构（BYOK — 自带 API Key）**：你的密钥仅保存在本地浏览器中，所有大模型请求由浏览器直接发往你选择的模型服务商，零中间服务器、零遥测追踪。

---

## 核心产品功能

### 1. 沉浸式网页双语翻译与悬浮单段速翻
- **段落级双语对照 / 仅译文切换**：保留原网页排版，提供清爽色带、高亮、虚线、弱化等多种译文视觉样式，支持一键切换「双语对照」与「仅显示译文」或一键恢复原文。
- **鼠标悬浮 + `Shift` 单段速翻**：不想翻译整张网页？只需将鼠标悬浮在任意段落、标题或列表项上，轻按一下 `Shift` 键（可在设置中修改为 `Ctrl`、`Alt`、`~` 或关闭），即可单独翻译该段落；再按一次立即恢复原文。
- **划词翻译与侧栏追问**：选中网页任意词句自动弹出轻量翻译气泡，支持一键复制译文，或一键带入侧栏向 AI 深入追问。
- **防遮挡自适应排版与极速首屏**：自动解除紧凑标题/卡片容器的行数与高度截断（防止多行译文下半部分被遮挡）；基于视口优先微批调度（Micro-batching）与 IndexedDB 本地缓存，首屏约 1 秒即刻出译文。

### 2. 视频双语字幕与专业级样式定制
- **播放器内原生 `CC` 开关 + 按域名记忆**：在 YouTube、Bilibili 等视频播放器控制栏自动挂载专属双语字幕开关，**开启/关闭状态随视频网站域名自动持久化记忆**，刷新页面或切换视频无需重复开启。
- **双引擎智能字幕管线**：
  - **引擎 1（全量字幕轨预取 + 断句重排 + 上下文意译）**：自动提取完整字幕轨（支持 YouTube JSON3/SRV3、HTML5 `<track>` WebVTT 等），智能合并切分过碎的自动语音识别（ASR）短句、修复句中生硬断行，并携带滑动上文窗口允许模型自然调整中英文语序。
  - **引擎 2（实时 DOM 字幕监听兜底）**：在直播或无预取字幕轨的播放器上，自动平滑切换至实时字幕 DOM 监听与即时翻译。
- **自由拖拽位置 + 二级字幕样式面板**：
  - **鼠标自由拖拽**：在视频画面内直接按住字幕框即可任意拖动显示位置（避开视频内嵌硬字幕或关键画面），双击即可复位。
  - **二级可视化设置菜单**：支持实时调整字幕显示类型（双语 / 仅译文 / 仅原文）、译文位置（原文上方 / 原文下方）、背景不透明度，以及主/副字幕各自的字号（`50%–150%`）、颜色、字体与粗细，修改时实时预览。

### 3. 网页、视频字幕与 PDF 深度总结问答（带可点击溯源引用）
- **视频网站一键「总结当前视频」**：在有字幕的视频页面打开侧栏新对话，即可直接点击 **「总结当前视频」**。扩展会自动抓取带时间戳的完整视频字幕文稿，生成结构化核心观点总结。
- **可点击溯源角标（定位原文 / 跳转视频进度 / 跳页）**：
  - 点击回答中的 **网页引用角标**：页面平滑滚动至对应原文段落并高亮闪烁。
  - 点击回答中的 **`[MM:SS]` 视频时间引用**：视频播放器直接跳转到对应秒数播放。
  - 点击回答中的 **`Page N` PDF 引用**：PDF 阅读器直接翻到对应页码。
- **长网页与本地/在线 PDF 阅读问答**：
  - 内置 `pdf.js`（含完整中日韩 CMap 字库），同时支持在线 PDF 与本地 `file://` PDF（最高 100 MB）。
  - 超过 2 万字的长文自动分段提炼汇总；超长文档（最高 100 万字）多轮问答时在本地执行 BM25 相关性检索，精准提取上下文且大幅节省 Token。
- **多模态与自定义角色/提示词**：支持在对话框粘贴/上传图片与附件，支持切换预设人设及自定义总结/翻译 Prompt 模板。

### 4. 浏览器自主操作 Agent（Browser Use）与 MCP 桥接
- **内置网页操作 Agent**：在侧栏输入框切换至 **Agent 模式**，AI 即可读取页面可交互元素，自主执行点击、输入、按键、滚动、提取表格/正文等连续操作，帮你完成跨步网页任务。
- **单标签页连贯执行与安全护栏**：搜索与链接跳转保持在当前标签页内连贯执行，跨标签页切换时侧栏会话依然保持固定；涉及提交表单、付款、删除等高风险动作时自动暂停并弹窗请求人工确认。
- **MCP Server 外部接入（`sidekick-mcp`）**：内置 Model Context Protocol 服务，支持将 Claude Code、Cursor 等本地 AI 编程工具直接桥接到你已登录的真实浏览器环境。

### 5. 自带密钥（BYOK）与多模型精细路由
- **预置 10+ 主流模型服务商**：开箱支持 **DeepSeek、通义千问（百炼）、Kimi（月之暗面）、智谱 GLM、OpenAI、Anthropic (Claude)、Google Gemini、OpenRouter、Ollama（本地模型）** 以及任意 **OpenAI 兼容接口**。
- **分任务独立配置默认模型**：可为「网页与字幕翻译」指定高并发低延迟模型（如 `deepseek-chat` / `qwen-plus`），同时为「侧栏深度对话与 Agent」指定旗舰推理模型。

---

## 安装指南

### 方式一：从 GitHub Releases 下载安装（推荐）
1. 前往仓库的 [**Releases 页面**](https://github.com/yoko19191/sidekick-browser-extension/releases)，下载最新版本的 `sidekick-extension-<version>-chrome.zip`（或 `.crx`）。
2. 将 `.zip` 解压到本地任意文件夹。
3. 在 Chrome / Edge / Brave / Arc 地址栏打开 `chrome://extensions`，开启右上角的 **「开发者模式」**。
4. 点击左上角 **「加载已解压的扩展程序」**，选择刚刚解压出来的文件夹（或者直接将 `.crx` 拖入 `chrome://extensions` 页面）。
5. 点击浏览器工具栏上的 **「翻翻」** 图标打开侧栏，跟随 3 步引导填入你的 API Key 即可开始使用！

### 方式二：从源码构建
```bash
git clone https://github.com/yoko19191/sidekick-browser-extension.git
cd sidekick-browser-extension
npm install
npm run build
```
构建完成后，在 `chrome://extensions` 中点击「加载已解压的扩展程序」并选择 `.output/chrome-mv3` 目录。

---

## 快捷操作一览

| 功能操作 | 默认快捷键 / 触发入口 | 是否可配置 |
| :--- | :--- | :---: |
| **切换整页双语翻译** | `Alt + A`（或点击页面右侧悬浮球） | 可在设置中自定义 |
| **悬浮单独翻译/恢复当前段落** | 鼠标移到段落上 + 轻按 `Shift` | 可选 `Shift` / `Alt` / `Ctrl` / `~` / 关闭 |
| **打开 AI 侧边栏** | 点击浏览器工具栏图标，或右键/长按右侧悬浮球 | — |
| **开启/关闭视频双语字幕** | 点击视频播放器下方控制栏的 `CC` 图标 | 按视频网站域名自动持久记忆 |
| **调整视频字幕样式与位置** | 悬浮或右键点击播放器 `CC` 图标；直接拖拽画面中的字幕框 | 实时预览并自动保存 |

---

## 开发者指南与常用命令

```bash
npm run dev                 # 启动 WXT 开发模式（带热更新）
npm run compile             # TypeScript 类型检查 (tsc --noEmit)
npm test                    # 运行 Vitest 单元测试
npm run build               # 生产环境构建 -> .output/chrome-mv3/
npm run zip                 # 打包 ZIP -> .output/sidekick-extension-<ver>-chrome.zip
npm run crx                 # 打包签名 CRX3 -> .output/sidekick-extension-<ver>-chrome.crx
npm run check:permissions   # 校验构建产物 manifest 权限是否符合白名单
npm run test:e2e            # 运行 Playwright 端到端测试（使用本地 mock 模型服务，零 API 费用）
```

### 更多文档
- [权限与隐私安全说明 (PERMISSIONS.md)](./PERMISSIONS.md)
- [发版前手动验收清单 (MANUAL-QA.md)](./MANUAL-QA.md)

## 开源协议

[MIT](./LICENSE)
