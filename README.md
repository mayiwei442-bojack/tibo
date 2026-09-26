# Codex Reset Monitor

监控单个 Tibo X 账号，按发布时间识别新推文，交给 DeepSeek 分析并保存到 Supabase。黑绿 Dashboard 每 45 秒读取数据库，展示最新相关信号和最近 30 条处理记录。

## 当前实现与验收边界

- 已实现 Next.js 页面、受保护检查接口、Python/Scrapling 抓取服务、DeepSeek 严格 JSON 校验、两张数据库表与并发保护。
- 本地无凭据时显示等待连接，不使用虚构推文、重置时间或监控成功状态。
- 自动化测试使用明确的测试夹具和本地 PGlite PostgreSQL；不等同于真实 Supabase/DeepSeek/X 联调。
- 用户已创建 Supabase 项目并报告已填写本地环境变量；只读连接可达，但 `tweets` 和 `monitor_state` 尚不存在。Python v3 容器已部署到 Google Cloud Run，真实请求返回 HTTP 200 和 5 条推文。DeepSeek、数据库写入、Vercel 页面与云端定时任务尚未联调或启用。
- 监控账号已确认：`https://x.com/thsottiaux`。2026-09-26 本地 Scrapling 实际抓取成功返回 5 条推文的正文、发布时间和 URL；云端网络环境仍待验收，不能承诺 X 公开时间线持续可读。
- 当前公开详情页仅显示到分钟。浏览器明确使用 UTC 时区和 en-US 语言后提取页面时间，秒记为 00，不通过推文 ID 推算时间；未结束的当前分钟暂缓处理，同一分钟成组保存后推进游标。

## 适配 Vercel Hobby 的架构

```text
Supabase Cron（每 5 分钟）
  → GET /api/cron/check-tibo（Vercel Hobby / Node.js）
  → getLatestTweets() → 独立 Python 容器 / Scrapling / Chromium
  → published_at 时间比较 → 仅分析新推文 → DeepSeek
  → Supabase tweets + monitor_state
  → /api/dashboard → Next.js Dashboard（45 秒刷新）
```

Vercel Hobby 不支持每 5 分钟运行 Vercel Cron，因此 `vercel.json` 不包含 `crons`。`supabase/schedule.sql` 提供 Supabase Cron + pg_net 替代方案，安装数据库表不会自动启用调度。Vercel 使用 Fluid Compute，检查接口最长 300 秒；应用会提前结束超出预算的批次，留下未处理推文供下次重试。

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
| `SUPABASE_SECRET_KEY`       | 优先使用的新式服务端密钥，仅在服务器使用                     |
| `SUPABASE_SERVICE_ROLE_KEY` | 兼容旧式服务端密钥，与上一项选填一个即可                     |
| `DEEPSEEK_API_KEY`          | DeepSeek 凭据                                                |
| `DEEPSEEK_MODEL`            | 默认 `deepseek-flash`，可按实际账号支持情况调整              |
| `CRON_SECRET`               | 检查接口 Bearer 密钥，至少 32 个字符                         |
| `TIBO_X_URL`                | 经确认的唯一目标主页，例如 `https://x.com/thsottiaux`        |
| `SCRAPER_URL`               | Python 容器 HTTPS 根地址；开发时可用 `http://127.0.0.1:8000` |
| `SCRAPER_SECRET`            | 独立随机 Bearer 密钥，与 Python 容器一致，至少 32 个字符     |

页面通过服务端读取公开展示字段，不需要浏览器 Supabase anon key；数据库表和 RPC 对 `anon` / `authenticated` 均不可访问。

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

`scraper/.env` 由 `.env.example` 复制，只配置 `TIBO_X_URL` 和 `SCRAPER_SECRET`。部署平台暴露端口 8000，并配置 HTTPS。`GET /health` 只代表服务进程在线，不能证明 X 抓取成功。`POST /tweets` 使用 `Authorization: Bearer <SCRAPER_SECRET>`，请求体为 `{"latestTweetTime":null}` 或已处理时间，返回 `sourceUrl` 和 `tweets`。

容器不含 Supabase 或 DeepSeek 密钥。服务只访问预配置目标，拒绝请求自行指定 URL。每次浏览器运行有硬超时，单进程同时只允许一次抓取。标准部署使用一个 Uvicorn worker。

### 抓取边界

- 使用 Scrapling `DynamicFetcher` 获取公开页面，按时间线有界滚动，提取目标作者的正文、时间和规范化原始链接。
- 不使用登录 Cookie、代理轮换或自动解验证码。登录墙、挑战页面、缺少正文、折叠长文和不完整时间线均视为抓取失败。
- 检查非置顶帖是否按新到旧顺序返回。置顶帖不作为已经覆盖上次处理时间的证据。
- 首次仅处理当前可见的近期样本，不回填全部历史。后续必须向下抓到 `latest_tweet_time`，否则拒绝推进游标；长时间停机造成的积压可能需要人工处理。
- 公开页面只能证明观察到的内容；删除、隐藏、X 未返回的推文无法恢复。仅依赖发布时间，也无法发现之后才出现且时间不大于游标的内容，这是原始 V1 时间模型的限制。
- 不会把空抓取、历史热门帖或访问失败报告为“没有新推文”。如果目标匿名时间线不可读，需先解决受允许的数据访问方式，不能用样例数据冒充生产抓取成功。

## 数据库与调度部署

1. 选定此项目的 Supabase 数据库，审阅并执行 `supabase/migrations/20260920142258_monitor_v1.sql`。它只创建本产品的两张表及辅助 RPC，不会操作其他项目。
2. 部署 Python 容器，先从云端运行一次真实 `POST /tweets`，核对原文、时间、作者与 URL。
3. 从 GitHub 仓库部署 Next.js 到 Vercel Hobby，配置环境变量并确认启用 Fluid Compute。
4. 用 `CRON_SECRET` 调用 `/api/cron/check-tibo`，检查推文与进度实际入库。重复调用，确认已处理推文不会再次分析。
5. 在 Supabase Dashboard 启用 Cron（pg_cron）、pg_net 和 Vault。在 Vault 添加 `tibo_monitor_url`（生产检查接口完整 URL）与 `tibo_cron_secret`（同一个 `CRON_SECRET`）。不要将密钥直接写在 SQL 文件里。
6. 执行 `supabase/schedule.sql`。任务名为 `tibo-monitor-every-5-minutes`，表达式 `*/5 * * * *`。
7. 查看至少两个相隔约 5 分钟的实际检查：`cron.job_run_details` 只证明调度执行，还需核对 `net._http_response` 的 HTTP 结果，以及 `monitor_state.last_success_at`。HTTP 202 表示部分工作延期，200 的 `busy` 表示已有任务在运行，都不等同于一次完整成功。

这份仓库没有自动购买服务、创建数据库项目或启用定时任务的脚本。暂停调度可在 Supabase Cron 页面关闭此任务。

## 数据一致性

- `published_at > latest_tweet_time` 是唯一的新旧判断规则，比较真实时间值而非字符串，旧 → 新处理。
- 每条分析成功后持久化；一组相同发布时间的推文全部保存后，才推进游标。中途失败立即停止，较新的内容不会越过失败点。
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
