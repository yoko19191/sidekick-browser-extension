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

- **主界面（侧栏）**：参照 Kimi 插件的布局。顶部一排圆形描边按钮（左：新对话、历史；右：翻译开关、⚙）；空状态是吉祥物 + 大标题、一张柔和的当前页面卡片、快捷操作列表（总结本页 / 翻译本页 / 解释选中内容 / 提取要点）；底部大圆角输入框，左下是「引用本页」「引用选中内容」，右下是模型切换和圆形发送按钮。
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
src/ui/        App · ChatView · Onboarding · options/OptionsApp · components/ui（shadcn 风格）· mascot/Mascot · dev/MascotGallery（仅 e2e 构建）
assets/mascot/ 设计师的分层吉祥物 SVG
tests/unit/    vitest：批处理、缓存、Key 处理、设置默认值、段落收集
tests/e2e/     Playwright：引导、对话、全文翻译、划词翻译、设置层级、长流式
scripts/       check-permissions.mjs · permissions.allowlist.json · make-icons.mjs · screenshots.mjs
```

## 吉祥物「翻翻」

组件 `src/ui/mascot/Mascot.tsx`，美术文件 `assets/mascot/fanfan-layered.svg`（构建时以文本内联，换图不用改代码）。工具栏 / 商店图标是设计师给的 `public/icon/{16,32,48,128}.png`（`scripts/make-icons.mjs` 会用 `public/icon.svg` 覆盖它们，别随手跑）。

**SVG 图层约定**（viewBox 0 0 128 128）：

| 节点 | 作用 |
|---|---|
| `#ff-body` | 静态：`#ff-leaf` 绿色翻页角、身体、`#ff-sheen` 高光（单独一层，可替换）、`#ff-rim` |
| `#ff-face`（或 `#ff-eyes`） | 眼睛层。跟随鼠标时整体平移，最大 x 9 / y 7，身体内要留出这个余量 |
| `#ff-face > [data-state="…"]` | 每种表情一个子组；组件只显示匹配的那个，其余设 `display="none"`。没画的表情回退到 `idle` 子组，再叠加代码里的动作。眨眼 = 对 `idle` 子组里的形状做 scaleY |

同样的规则适用于任何子节点带 `data-state` 的组（比如以后在 `#ff-eye-left/right` 里分别放每个状态的形状）。id 会按实例加前缀，同页多个吉祥物的渐变不会冲突。不要在 SVG 里对这些 id 写动画，`transform` 由组件控制。

**状态**（只有一个 `state` prop，由聊天和翻译的真实事件驱动）：

| state | 用的画稿（按顺序找） | 代码里的动作 | 触发 |
|---|---|---|---|
| `idle` | idle | 跟随鼠标、随机眨眼；鼠标离开侧栏时先朝左看网页再回正；60 秒无操作进入 sleeping | 默认 |
| `typing` | typing / listening | 看向下方输入框 | 输入框获得焦点 |
| `waiting` | waiting / thinking | 横条眼左右扫 | 已发送、首个 token 未到 |
| `generating` | generating / working | 轻微上下弹 | 流式输出中 |
| `translating` | translating / working | 看向左边网页 | 整页翻译进行中 |
| `done` | done | `^ ^` + 小跳约 1 秒，然后回 idle | 回答或翻译完成 |
| `needs-action` | needs-action / needs-you | 歪头 | 没配 Key、需要站点权限 |
| `error` | error | 眼睛下垂、摇头一次 | 请求失败 |
| `sleeping` | sleeping / sleep | 闭眼；鼠标移入侧栏时醒来 | idle 超过 60 秒 |
| `surprised` | surprised / listening | 眼睛放大约 0.9 秒 | 收到页面选中的文字 |

开启 `prefers-reduced-motion` 时只切换画稿，不跟随、不眨眼、不弹跳。每个实例一个 rAF 循环，表情稳定后停止。e2e 构建里打开 `sidepanel.html#mascot-gallery`（或 `#mascot-gallery-dark`）可以看到全部表情，`npm run screenshots` 会输出 `*-12-mascot-gallery.png` 和 `*-13-mascot-gallery-reduced-motion.png`。

## 界面文案（i18n）

所有界面文案在 `src/i18n/`：`zh_CN.ts` 是完整目录，`en.ts` 目前只有品牌名，缺的 key 自动回退到中文。代码里用 `tr("chat.translating", { done, total })`。
加一种语言 = 加一个目录文件并在 `src/i18n/index.ts` 注册，无需改其它代码；`tests/unit/i18n.test.ts` 会拦截新写进代码里的中文硬编码。
扩展名称、描述、快捷键说明在 `public/_locales/{zh_CN,en}`。

## 其它文档

- 权限说明：[PERMISSIONS.md](./PERMISSIONS.md)
- 发版前手动验收（真实权限弹窗、activeTab 过期等）：[MANUAL-QA.md](./MANUAL-QA.md)

## License

MIT
