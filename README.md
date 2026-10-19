# 翻翻 Sidekick

浏览器侧栏 AI 助手（Chrome MV3）：**网页双语翻译 · 划词翻译 · 页面总结与问答**。
BYOK（用你自己的 API Key），纯客户端，没有服务器。

- 包名：`sidekick-extension`；扩展名 `翻翻 Sidekick`，short_name `翻翻`（`_locales/zh_CN`、`_locales/en`）
- 技术栈：WXT + React 19 + TypeScript + Tailwind CSS v4 + shadcn/ui 风格组件（Radix Popover / Dropdown）+ lucide 图标
- 模型层：[`@earendil-works/pi-ai`](https://www.npmjs.com/package/@earendil-works/pi-ai)（与 genui 相同），在 Service Worker 里流式调用 OpenAI 兼容 / Anthropic / Gemini
- 规格：`/workspace/docs/browser-sidepanel-extension-v1-spec-v0.2.md`

## 功能（v1）

| 模块 | 说明 |
|---|---|
| 侧栏对话 | 总结本页（Readability → Markdown，>2 万字自动分段总结再合并）、围绕页面多轮问答、快捷指令（总结 / 翻译 / 提取要点）、历史会话（IndexedDB）、流式 Markdown、可随时停止、脚注引用点击定位原文并高亮 2 秒 |
| 全文翻译 | 段落级双语对照或仅译文；批量打包请求（JSON 编号返回）；IntersectionObserver 滚到哪翻到哪；MutationObserver 补翻动态内容；IndexedDB 缓存（原文哈希 + 目标语言 + 模型，LRU）；失败段落可“重试”；一键恢复原文 |
| 划词翻译 | 选中文字出现小图标 → 浮动卡片显示译文 → 复制 / 发到侧栏追问；右键“翻译选中文字” |
| 入口 | 侧栏按钮、网页右侧悬浮按钮（点击切换翻译，右键/长按打开侧栏）、右键菜单、快捷键 `Alt+A` |
| BYOK | 预置 DeepSeek、Kimi、通义、智谱、OpenAI、OpenRouter、Ollama、Anthropic、Gemini、自定义 OpenAI 兼容；多 Provider；测试连接、拉取模型列表；对话 / 总结 / 翻译分别选默认模型 |
| 首次引导 | 三步：选 Provider → 粘贴 Key 并测试（必须通过，失败给出可读原因）→ 选目标语言；可跳过 |

### 界面层级

- **主界面（侧栏）**：只有对话、顶部模型切换、翻译开关、新对话、历史、⚙。
- **一级 · ⚙ 快捷设置浮层**：目标语言、显示方式（双语 / 仅译文）、本站自动翻译、“更多设置 →”。
- **二级 · 设置页**（`options.html`，左侧导航）：模型与密钥 / 翻译 / 对话与提示词 / 外观 / 快捷键 / 数据与隐私。
- **三级**：Provider 详情（展开卡片）、批大小 / 并发 / 站点规则 / 排除元素、提示词模板、缓存与导入导出——都在默认收起、标注“高级”的折叠面板里。
- 所有设置即时生效，没有“保存”按钮；**每一项都有默认值**，只填一个 Key 就能用。

## 开发

```bash
export PATH=~/.local/node22/bin:$PATH
npm install
npm run dev          # WXT 开发模式（会自动打开一个加载了扩展的 Chromium）
npm run build        # 生产构建 → .output/chrome-mv3/
npm run zip          # 打包 → .output/sidekick-extension-0.1.0-chrome.zip
npm run compile      # tsc --noEmit
npm test             # vitest 单元测试
npm run test:e2e     # 构建 e2e 版本并跑 Playwright（本地 mock 模型服务，不调用任何付费 API）
npm run test:e2e:nohost      # 无任何主机权限的构建：授权提示、不注入、不发空页面请求
npm run check:permissions   # manifest 权限必须与 scripts/permissions.allowlist.json 一致
npm run screenshots  # 生成亮/暗两套截图 → /workspace/deliverables/sidepanel-ext（可用 SHOTS_DIR 覆盖）
DEEPSEEK_API_KEY=… npm run test:live   # 可选：用真实 DeepSeek 跑一次连接测试/总结/批量翻译（不在 npm test 里，未设置变量则跳过）
```

> 测试从不调用付费 API：单元测试纯本地，e2e 全部打到 `tests/fixtures/mock-llm.mjs`（本地 OpenAI 兼容 SSE mock）。

### 手动加载

1. `npm run build`
2. 打开 `chrome://extensions`，开启“开发者模式”
3. “加载已解压的扩展程序” → 选择 `.output/chrome-mv3`
4. 点工具栏上的翻翻图标打开侧栏，按引导填 Key

### 本地 mock 模型服务

```bash
node tests/fixtures/mock-llm.mjs     # http://127.0.0.1:8787/v1 ，任意 Key；模型 mock-fast / mock-slow
```

## 架构

```
Side Panel (React) ──port: sidekick-llm──▶ Service Worker ──fetch/SSE──▶ 模型服务商（BYOK）
     │  runtime.sendMessage                    │  读 Key（storage.local）· pi-ai 流式 · 翻译缓存(IndexedDB)
     ▼                                         ▼
Options 页                              Content Script（按需注入）：段落收集/插入译文、Readability、
                                        悬浮按钮 + 划词卡片（Shadow DOM）、引用定位
```

- 模型请求只从 Service Worker 发出，Key 只在那里读取；内容脚本只发送文本、接收译文。
- 侧栏与 SW 之间用长连接端口传流式输出；流式进行中侧栏每 15 秒 ping 一次，保证模型长时间“思考”时 SW 也不会因 30 秒空闲被回收（e2e 里有 45 秒、含 32 秒静默的用例）。
- 网页内容在提示词里用 `<page>` 标签隔离并声明为不可信数据。

## 目录

```
entrypoints/   background.ts · content.ts · sidepanel/ · options/
src/lib/       providers / settings / llm(pi-ai) / batch / cache / db / paragraphs / extract / prompts / page-ui
src/ui/        App · ChatView · Onboarding · options/OptionsApp · components/ui（shadcn 风格）
tests/unit/    vitest：批处理、缓存、Key 处理、设置默认值、段落收集
tests/e2e/     Playwright：引导、对话、全文翻译、划词翻译、设置层级、长流式
scripts/       check-permissions.mjs · permissions.allowlist.json · make-icons.mjs · screenshots.mjs
```

## 界面文案（i18n）

所有界面文案在 `src/i18n/`：`zh_CN.ts` 是完整目录，`en.ts` 目前只有品牌名，缺的 key 自动回退到中文。代码里用 `tr("chat.translating", { done, total })`。
加一种语言 = 加一个目录文件并在 `src/i18n/index.ts` 注册，无需改其它代码；`tests/unit/i18n.test.ts` 会拦截新写进代码里的中文硬编码。
扩展名称、描述、快捷键说明在 `public/_locales/{zh_CN,en}`。

## 其它文档

- 权限说明：[PERMISSIONS.md](./PERMISSIONS.md)
- 发版前手动验收（真实权限弹窗、activeTab 过期等）：[MANUAL-QA.md](./MANUAL-QA.md)

## License

MIT
