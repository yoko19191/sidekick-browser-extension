# 权限说明 · 翻翻 Sidekick v1

第一版只申请下面这些权限，**不申请** `userScripts`、`debugger`，也不在 manifest 里声明内容脚本。
权限集合由 `scripts/permissions.allowlist.json` 锁定，`npm run check:permissions` 会在构建产物的 manifest 与清单不一致时失败（CI 里应在 `npm run build` 之后执行）。新增权限必须同时修改清单和本文件，并经人工确认。

## 安装时（required）

| 权限 | 用来做什么 | 不用会怎样 |
|---|---|---|
| `sidePanel` | 侧栏主界面（`chrome.sidePanel`），点工具栏图标打开 | 没有主界面 |
| `storage` | 设置、Provider 配置、API Key 存在 `chrome.storage.local`（**不用 sync**）；`storage.session` 传递“右键总结 / 发到侧栏追问”这类一次性动作 | 无法保存任何配置 |
| `activeTab` | 用户点击工具栏图标、右键菜单或快捷键时，临时获得**当前标签页**的访问权，用来提取正文和注入翻译脚本 | 不授权任何网站就无法读取页面 |
| `scripting` | 按需注入内容脚本（`chrome.scripting.executeScript`），而不是在所有网站常驻 | 只能在 manifest 里对所有网站常驻注入，权限更大 |
| `contextMenus` | 右键菜单：翻译此页 / 翻译选中文字 / 在侧栏总结此页 | 少一个入口 |

## 可选（optional，运行时由用户点击后申请）

| 权限 | 何时申请 | 用来做什么 |
|---|---|---|
| `optional_host_permissions: <all_urls>` | ① 在页面上点“允许访问此网站”或打开“本站自动翻译”时，只申请**该站点**的 origin；② 在设置 → 数据与隐私里打开“允许在所有网站上运行”时才申请全部网站 | 已授权的网站上：页面加载后自动出现悬浮按钮和划词翻译、按站点规则自动翻译 |
| 模型 API 的 origin（同样落在 `<all_urls>` 的可选范围内） | 添加 / 测试 Provider 时申请该 API 的 origin | 让后台 Service Worker 可以跨域调用你的模型服务（多数服务商本身支持 CORS，拒绝也能用） |

## 不申请的

- `tabs`：只在已获授权的标签页上读取 URL，不需要。
- `userScripts`、`debugger`：第二版（油猴脚本、CDP 网页操作）再加，届时同步更新清单。
- `content_scripts`（manifest 声明）：不声明，全部按需注入；`check:permissions` 会拒绝出现在 manifest 里的内容脚本。

## 关于 E2E 构建

`npm run build:e2e`（`SIDEKICK_E2E=1`）会额外加一条 `host_permissions: ["http://127.0.0.1/*"]`，只因 Playwright 无法点击 Chrome 的权限弹窗。输出到 `.output-e2e/`，**不能用于发布**；正式构建 `npm run build` / `npm run zip` 不包含它。
