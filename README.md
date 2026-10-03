# Codex Reset Monitor

监控单个 Tibo X 账号，按发布时间识别新推文，交给 DeepSeek 分析并保存到 Supabase。Dashboard 首次打开时读取数据库；已打开页面在新推文成功入库后收到 Realtime 更新信号，再读取最新相关信息和最近 30 条处理记录。

## 当前实现与验收边界

- 已实现 Next.js 页面、受保护检查接口、Python/Scrapling 抓取服务、DeepSeek 严格 JSON 校验、推文／监控状态／页面更新信号三张数据库表与并发保护。
- 本地无凭据时显示等待连接，不使用虚构推文、重置时间或监控成功状态。
- 自动化测试使用明确的测试夹具和本地 PGlite PostgreSQL；不等同于真实 Supabase/DeepSeek/X 联调。
- 监控账号已确认：`https://x.com/thsottiaux`。X 的匿名公开时间线可能随时改变或不可读，不能把一次成功抓取当作长期可用保证。
- 仓库内的 SQL 与环境变量模板不会自动修改线上 Supabase、Vercel 或 Cloud Run；应按下文步骤分别部署并验收。
- 当前公开详情页仅显示到分钟。浏览器明确使用 UTC 时区和 en-US 语言后提取页面时间，秒记为 00，不通过推文 ID 推算时间；未结束的当前分钟暂缓处理，同一分钟成组保存后推进游标。

## 适配 Vercel Hobby 的架构

```text
Supabase Cron（每 90 分钟；UTC 整点、半点交替）
  → GET /api/cron/check-tibo（Vercel Hobby / Node.js）
  → getLatestTweets() → 独立 Python 容器 / Scrapling / Chromium
  → published_at 时间比较 → 仅分析新推文 → DeepSeek
  → Supabase tweets + monitor_state
  → dashboard_updates 递增版本信号（新推文入库或覆盖缺口变化时变化）
  → 已打开页面收到 Supabase Realtime 事件 → /api/dashboard → Next.js Dashboard
```

本项目使用 Supabase Cron + pg_net 定时触发，`vercel.json` 不包含 `crons`。`supabase/schedule.sql` 用两个任务实现每 90 分钟检查一次：UTC 00:00、01:30、03:00、04:30……（北京时间 08:00、09:30、11:00、12:30……）。标准 Cron 不能让每次 90 分钟检查都恰好落在整点。安装数据库表不会自动启用调度。Vercel 使用 Fluid Compute，检查接口最长 300 秒；应用会提前结束超出预算的批次，留下未处理推文供下次重试。

定时检查无新推文时不调用 DeepSeek、不写 `tweets`、不触发 Dashboard 全量读取；仍会更新 `monitor_state` 的检查时间。因此，持续打开且没有新推文的页面，其“最近检查”显示的是本页上次同步时看到的时间。新访客打开网页时，Next.js 服务器读取数据库并生成页面；已打开页面在收到新推文入库的 Realtime 信号或切回标签页时请求 `/api/dashboard`。主动点击“检查并刷新”则会先运行完整检查流程，结束后读取数据库，无新推文也会同步最新检查时间。公开客户端只能读取单行版本信号，不能直接读取 `tweets`、`monitor_state` 或服务端密钥。

该方案不需要购买 Vercel Pro。容器宿主、DeepSeek 调用以及超出所用平台额度的资源另计。免费云资源不提供全天不中断保证；Supabase Free 存在闲置暂停规则，部署时应检查实际项目状态。

## 本地启动

需要 Node.js 22+、Python 3.12。无环境变量也可预览真实空状态：

```powershell
npm ci
npm run dev -- --port 3102
```

复制 `.env.example` 为 `.env.local` 并在本地填写。不要把密钥发到聊天、提交 Git 或放在 `NEXT_PUBLIC_` 变量中。

| 环境变量                    | 用途                                                         |
| --------------------------- | ------------------------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`  | 当前项目的 Supabase URL                                      |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | 浏览器 Realtime 公钥（`sb_publishable_...`），仅用于订阅更新信号 |
| `SUPABASE_SECRET_KEY`       | 优先使用的新式服务端密钥，仅在服务器使用                     |
| `SUPABASE_SERVICE_ROLE_KEY` | 兼容旧式服务端密钥，与上一项选填一个即可                     |
| `DEEPSEEK_API_KEY`          | DeepSeek 凭据                                                |
| `DEEPSEEK_MODEL`            | 默认 `deepseek-flash`，可按实际账号支持情况调整              |
| `CRON_SECRET`               | 检查接口 Bearer 密钥，至少 32 个字符                         |
| `TIBO_X_URL`                | 经确认的唯一目标主页，例如 `https://x.com/thsottiaux`        |
| `SCRAPER_URL`               | Python 容器 HTTPS 根地址；开发时可用 `http://127.0.0.1:8000` |
| `SCRAPER_SECRET`            | 独立随机 Bearer 密钥，与 Python 容器一致，至少 32 个字符     |

推文与监控状态由服务端读取，浏览器只用 publishable key 订阅 `dashboard_updates` 的递增版本。`tweets`、`monitor_state` 和监控 RPC 对 `anon` / `authenticated` 仍不可访问。若未设置浏览器公钥，页面仍能打开并支持手动/切回刷新，但不会收到自动更新事件。绝不能把 Secret Key 或 service_role key 放进 `NEXT_PUBLIC_` 变量。

Python 本地启动（仓库根目录）：

```powershell
python -m venv scraper/.venv
scraper/.venv/Scripts/python.exe -m pip install -r scraper/requirements-dev.txt
scraper/.venv/Scripts/python.exe -m playwright install chromium
# 在当前终端环境中配置 TIBO_X_URL、SCRAPER_SECRET，或使用平台的环境变量管理。
scraper/.venv/Scripts/python.exe -m uvicorn scraper.app:app --host 127.0.0.1 --port 8000 --no-access-log
```

Next.js 自动加载 `.env.local`，独立 Python 进程不会自动读取该文件。将 Python 所需的两个变量配置在它的运行环境中。

## Python 容器

以 `scraper` 为构建上下文：

```text
docker build -t tibo-scraper ./scraper
docker run --init --pids-limit 256 --memory 2g --cpus 1 -p 8000:8000 --env-file scraper/.env tibo-scraper
```

`scraper/.env` 由 `.env.example` 复制，只配置 `TIBO_X_URL` 和 `SCRAPER_SECRET`。部署平台暴露端口 8000，并配置 HTTPS。`GET /health` 只代表服务进程在线，不能证明 X 抓取成功。`POST /tweets` 使用 `Authorization: Bearer <SCRAPER_SECRET>`，请求体为 `{"latestTweetTime":null}` 或已处理时间，返回 `sourceUrl`、`tweets`、`coverageComplete` 和 `oldestOrdinaryPublishedAt`。

容器不含 Supabase 或 DeepSeek 密钥。服务只访问预配置目标，拒绝请求自行指定 URL。每次浏览器运行有硬超时，单进程同时只允许一次抓取。标准部署使用一个 Uvicorn worker。

### 抓取边界

- 使用 Scrapling `DynamicFetcher` 获取公开页面，按时间线有界滚动，提取目标作者的正文、时间和规范化原始链接。
- 不使用登录 Cookie、代理轮换或自动解验证码。登录墙、挑战页面、缺少正文和折叠长文仍视为抓取失败；可解析但历史覆盖不足的时间线会明确标为部分结果。
- 检查非置顶帖是否按新到旧顺序返回。置顶帖不作为已经覆盖上次处理时间的证据。
- 首次仅处理当前可见的近期样本，不回填全部历史。后续若抓不到 `latest_tweet_time`，仍保存当前可见且尚未分析的新推文，但记录未核实区间、保持游标原位；后续重新抓到完整覆盖时才推进游标并清除告警。长时间停机造成的历史积压仍可能需要人工核实。
- 公开页面只能证明观察到的内容；删除、隐藏、X 未返回的推文无法恢复。仅依赖发布时间，也无法发现之后才出现且时间不大于游标的内容，这是原始 V1 时间模型的限制。
- 不会把空抓取、历史热门帖或访问失败报告为“没有新推文”。如果目标匿名时间线不可读，需先解决受允许的数据访问方式，不能用样例数据冒充生产抓取成功。

## 数据库与调度部署

1. 选定此项目的 Supabase 数据库，审阅并执行 `supabase/migrations/20260920142258_monitor_v1.sql`。它只创建本产品的两张表及辅助 RPC，不会操作其他项目。
2. 部署 Python 容器，先从云端运行一次真实 `POST /tweets`，核对原文、时间、作者与 URL。
3. 从 GitHub 仓库部署 Next.js 到 Vercel Hobby，配置环境变量并确认启用 Fluid Compute。
4. 用 `CRON_SECRET` 调用 `/api/cron/check-tibo`，检查推文与进度实际入库。重复调用，确认已处理推文不会再次分析。
5. 在 Supabase Dashboard 启用 Cron（pg_cron）、pg_net 和 Vault。在 Vault 添加 `tibo_monitor_url`（生产检查接口完整 URL）与 `tibo_cron_secret`（同一个 `CRON_SECRET`）。不要将密钥直接写在 SQL 文件里。
6. 在 SQL Editor 执行 `supabase/migrations/20260929170036_dashboard_updates_realtime.sql`，确认 `public.dashboard_updates` 在 `supabase_realtime` publication 中；再执行 `supabase/migrations/20260930163914_incomplete_timeline_partial_processing.sql`。先完成数据库迁移，再部署新版 Cloud Run 抓取容器与 Next.js 应用。在 Vercel Production 设置 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` 并重新部署。
7. 执行 `supabase/schedule.sql`。它创建 `tibo-monitor-90m-hour` 与 `tibo-monitor-90m-half-hour` 两个任务，并原子移除旧的两小时／五分钟任务。**只修改仓库文件不会自动改动线上任务，必须在实际项目 SQL Editor 执行。**
8. 查看至少两个相隔约 90 分钟的实际检查：`cron.job_run_details` 只证明调度执行，还需核对 `net._http_response` 的 HTTP 结果，以及 `monitor_state.last_success_at`。HTTP 202 表示部分工作延期，200 的 `busy` 表示已有任务在运行，都不等同于一次完整成功。开两个浏览器标签页，在下一条新推文完成分析入库后确认两页自动更新；无新推文时页面不请求 `/api/dashboard`。

这份仓库没有自动购买服务、创建数据库项目或启用定时任务的脚本。暂停调度可在 Supabase Cron 页面关闭此任务。

## 数据一致性

### 手动检查并刷新

页面“检查并刷新”按钮发送同源 `POST /api/monitor/check`，执行与 Cron 相同的 Cloud Run 抓取、发布时间比较、DeepSeek 分析和数据库保存流程，然后读取 `/api/dashboard`。没有新推文时跳过 AI，但仍更新检查时间并向点击者同步当前数据库结果。页面显示正在检查、没有新推文、处理条数、已有检查运行、冷却中或失败提示。

部署前在 SQL Editor 执行 `supabase/migrations/20260929172245_manual_monitor_cooldown.sql`，再部署代码。新增 RPC 仅允许 service_role 调用；浏览器没有 CRON_SECRET，也不能直接运行数据库 RPC。手动请求与定时请求共用数据库租约，所有访客共享从上次检查开始计时的 5 分钟冷却，包括失败检查；正常的 90 分钟 Cron 仍按原计划执行。冷却在数据库中原子校验，因此跨浏览器、跨 Vercel 实例也有效。按钮属于公开功能，同源校验防止跨站网页触发，不代表访客身份认证；机器人仍可在冷却后调用，最坏可把抓取频率提高到约每 5 分钟一次。

Realtime 通知和切回页面只读取数据库，绝不会再次触发 Cloud Run，避免“入库 → 刷新 → 再抓取”的循环。未安装手动检查迁移时接口返回失败，不会绕过冷却直接启动抓取。

### 中文界面与可选推文译文

界面使用简体中文，保留 Codex、ChatGPT、Reset、Usage limit 等专业名称。英文原文始终显示；每张卡片的“翻译成中文”按钮展开中文译文，再次点击可收起。

先执行 Reset 状态迁移，再执行 `supabase/migrations/20260927094104_chinese_content.sql`。新帖在原有一次 DeepSeek 分析中同时生成中文摘要和 `tweet_translation`，不会因访客点击或页面刷新调用 AI。迁移按原始 URL、正文、旧摘要精确匹配，一次性转换当前 7 条历史记录的摘要并补上译文，不改英文原文、分类、时间或监控游标。未迁移时页面仍可读，按钮提示译文尚未保存；新字段不会自动补到其他历史记录。

译文仅作阅读辅助，以英文原文为准。此功能不新增公开付费 AI 接口，也不将密钥发送到浏览器。

### LED 重置状态屏升级

在已有数据库的 SQL Editor 执行 `supabase/migrations/20260927092842_reset_status.sql`（新项目先执行 V1 建表迁移）。新增 `reset_status` 并升级保存 RPC，不修改调度或时间游标。迁移仅按原文和 URL 精确补标已核实的 “Resets all propagated” 旧帖，其他旧帖保持 `unknown`，不会重复调用 AI。

新推文分析增加第六个字段：`completed`（绿色，明确已重置）、`upcoming`（青色，明确将重置）、`possible`（琥珀色，措辞不确定）；另外 `unknown` / `none` 用于信息不足及无关讨论。LED 独立读取最新 reset 类推文，不会被后续普通 Codex 推文替代。无数据或未迁移时显示待确认，而非已重置。

仅 `upcoming` 且原文明示完整时间时显示本地倒计时；归零后显示等待完成确认，不会自动变成已重置。检查周期显示 90 分钟；页面不再定时轮询数据库，倒计时也不访问后端。

- `published_at > latest_tweet_time` 是唯一的新旧判断规则，比较真实时间值而非字符串，旧 → 新处理。
- 每条分析成功后持久化；完整覆盖时，一组相同发布时间的推文全部保存后才推进游标。历史覆盖不足时，已见新推文仍按旧到新保存，但不推进游标，网页显示未核实时间段；中途分析失败仍立即停止。
- `tweet_url` 唯一约束与分析前查重共同保护重试；即使保存成功后进度更新失败，也不会重新分析已保存记录。
- `monitor_state` 额外包含租约 token 和到期时间。数据库 RPC 原子获取租约、校验写入归属，过期进程无法继续写入。
- 没有新推文也更新检查成功时间，不调用 DeepSeek。服务故障仅保存固定错误码，浏览器不显示内部错误信息。
- 外部 AI 调用与数据库不是同一事务。如果 AI 已返回但写库前进程崩溃，这条尚未成功保存的推文可能在下次重新分析；无法承诺跨外部服务的绝对 exactly-once。

## 验证

```text
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
scraper/.venv/Scripts/python.exe -m unittest discover -s scraper/tests -v
```

首次浏览器测试先运行 `npx playwright install chromium`。E2E 需要端口 3102；无配置测试应在不加载生产凭据的开发环境运行。测试内容包括真实页面空状态、桌面/手机布局、已保存数据展示、过滤、刷新失败时保留记录，以及 Cron 未授权返回 401。填充内容仅存在于测试代码。

## 已核实的官方参考

- [Vercel Cron 套餐限制](https://vercel.com/docs/cron-jobs/usage-and-pricing)
- [Supabase Cron](https://supabase.com/docs/guides/cron) 与 [pg_net](https://supabase.com/docs/guides/database/extensions/pg_net)
- [Vercel Functions 时长限制](https://vercel.com/docs/functions/limitations)
- [Scrapling DynamicFetcher](https://scrapling.readthedocs.io/en/latest/fetching/dynamic.html)
- [DeepSeek Chat Completions / JSON 输出](https://api-docs.deepseek.com/api/create-chat-completion/)
