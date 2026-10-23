# AI 网页操作 · 20 站抽查清单

合入接线 PR 后，用真实模型对下列站点各跑一条短任务。记录：能否观察、是否误触确认、有无卡死、停止是否生效。

| # | 站点 | 任务示例 | 结果 | 备注 |
|---|------|----------|------|------|
| 1 | wikipedia.org | 打开今日条目并摘一段摘要 |  |  |
| 2 | github.com | 在搜索框输入 sidekick |  | 登录墙？ |
| 3 | news.ycombinator.com | 点开第一条 |  |  |
| 4 | reddit.com | 滚动并打开一条帖子 |  |  |
| 5 | stackoverflow.com | 搜索 typescript indexeddb |  |  |
| 6 | mdn.dev | 打开 Array.prototype.map |  |  |
| 7 | amazon.com | 搜索 headphones（勿下单） |  | 支付确认必测 |
| 8 | ebay.com | 搜索 vintage camera（勿出价） |  |  |
| 9 | booking.com | 搜一个城市酒店列表（勿预订） |  |  |
| 10 | airbnb.com | 搜一个城市房源（勿预订） |  |  |
| 11 | google.com/maps | 搜索 coffee near me |  | 重地图 |
| 12 | youtube.com | 搜索一个教程标题（勿登录） |  |  |
| 13 | twitter.com / x.com | 打开探索页 |  | 登录墙？ |
| 14 | linkedin.com | 打开首页 |  | 登录墙？ |
| 15 | notion.so | 打开公开页 |  | |
| 16 | figma.com | 打开社区首页 |  | |
| 17 | arxiv.org | 搜索 agent |  | |
| 18 | pubmed.ncbi.nlm.nih.gov | 搜索 CRISPR |  | |
| 19 | zhihu.com | 打开首页一条回答 |  | |
| 20 | bilibili.com | 搜索一个公开视频标题 |  | |

抽查结论决定是否启动 P3 增强模式（封闭 shadow / 跨源 iframe）。
