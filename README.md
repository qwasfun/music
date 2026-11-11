# 余音 · AFTERGLOW

个人音乐播放器 PWA。中文深色界面，支持私人云端曲库、歌单、收藏、在线播放与完整歌曲离线缓存。

线上地址：<https://music.185036.xyz>，原地址 <https://music.qwas.fun> 继续可用。两个域名共用云端曲库；登录状态、本机资料和离线歌曲按域名分别保存，使用新域名时需要重新下载离线歌曲。登录由 Cloudflare Access 邮箱验证码提供，仅允许已配置的个人邮箱。首页静态界面可公开加载，曲库、音频、封面及写入接口均需要鉴权。

## 使用

1. 点击「登录曲库」，使用允许的邮箱接收验证码。
2. 点击「上传音乐」，选择 MP3、AAC 编码的 M4A、FLAC 或 OGG（Vorbis / Opus）；每个文件最多 128 MiB，支持多选与拖放。原音频保留、不转码，支持读取内嵌封面与歌曲资料、在线播放、下载及离线拖动。相同文件重复上传会提示「歌曲已存在，已跳过」，改名也能识别；同名但内容不同的文件可以分别保存。
3. 歌曲会自动读取标题、歌手、专辑、时长与封面。更多菜单可编辑资料、添加到歌单、调整歌单顺序或删除。
4. 点击歌曲旁的下载按钮，将整首歌保存到本机；歌单页面支持批量下载。
5. 在设置中可启用自动缓存，默认关闭。默认容量为 1 GiB；手动下载不会被自动清理。
6. 曲库可以按播放次数排序。「播放统计」显示历史总次数和最常听的 10 首歌。每轮实际播放满 30 秒计一次，短于 60 秒的歌曲听满一半即可。离线播放先在本机计入，恢复联网后与其他设备合计。历史总次数包含已删除歌曲。

离线时可以浏览、搜索本机资料和播放已下载歌曲，修改收藏、歌单和上传需要联网。每台设备单独管理音频下载，云端同步歌曲资料、歌单和收藏。播放队列、音量与位置保留在当前浏览器。

iPhone 请使用 Safari 打开，在分享菜单中选择「添加到主屏幕」。下载期间保持应用在前台；系统可能暂停后台下载或清理网站存储，离线页会核对实际文件状态。退出登录会清除本机资料、音频和尚未同步的播放次数，云端内容保留。

OGG 使用浏览器原生解码。在 iPhone 上，Vorbis 与 Opus 的 OGG 容器支持要求 iOS 18.4 / Safari 18.4 或更新版本，参见 [WebKit 官方说明](https://webkit.org/blog/16574/webkit-features-in-safari-18-4/)。实际 iPhone 播放与离线操作仍需真机验收。

## 本地开发

要求 Node.js 22.12+、pnpm 10.28+，建议使用锁文件安装。

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm db:local
pnpm preview
```

生产构建预览地址为 `http://127.0.0.1:4173`，支持完整 PWA 与断网验收。开发登录只在显式传入 `DEV_AUTH=local-only` 且请求域名为 localhost/127.0.0.1 时启用，线上配置不含此变量。

需要热更新界面时，在两个终端分别运行：

```sh
pnpm exec wrangler dev --local --ip 127.0.0.1 --host 127.0.0.1 --port 8787 --var DEV_AUTH:local-only
pnpm dev
```

Vite 将 API 请求代理到本机 Worker；Service Worker 的完整离线行为请使用 `pnpm preview` 验收。

## 校验与浏览器验收

```sh
pnpm check
pnpm build
pnpm test
pnpm fixtures
# Playwright 浏览器保存在仓库内的忽略目录；Chromium 默认使用本机 Chrome。
# PowerShell:
$env:PLAYWRIGHT_BROWSERS_PATH = "$PWD/.cache/browsers"
pnpm exec playwright install webkit
pnpm preview
# 另一终端运行：
pnpm test:e2e
```

浏览器测试使用生成的 18 秒合成 MP3 和 [Chromium 官方 AAC 测试片段](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/media/test/data/README.md)。`pnpm fixtures` 会下载 AAC 测试片段到忽略目录。测试只写入本地库，结束后清理自己的测试歌曲和歌单。截图与 JSON 结果位于 `output/playwright/`。

FLAC 专项验收：保持本地预览运行，执行 `node tests/flac-browser.mjs`。它会现场生成带歌曲资料、封面和正确 CRC 的 FLAC，验证 16 位/44.1 kHz、24 位/96 kHz 的上传、播放、离线重开、拖动及缓存字节一致性；不下载音乐或写入生产曲库。Windows 默认使用 Chromium，WebKit 的 FLAC 解码测试标记为未验证：此测试内核报告支持，但无法完成官方 FLAC 样本的实际解码，不能代替 iPhone Safari 的真机结论。其他系统默认同时测试两种内核；可通过 `FLAC_ENGINE` 指定其中一种。

OGG 专项验收：`pnpm fixtures` 会同时下载 Chromium 官方的 Vorbis 与 Opus 测试音频到忽略目录。保持本地预览运行，执行 `pnpm test:ogg` 验证上传、资料读取、实际解码播放、离线重开、拖动、Range 响应及缓存字节一致性。Windows WebKit 先以参考文件检查原生解码能力，不可解码时明确记录为未测试；输出位于 `output/playwright/ogg-results.json`。

千首曲库验收：保持本地预览运行，执行 `pnpm test:capacity`。使用 2000 首合成歌曲资料检查虚拟列表、搜索、完整队列、歌单位置和 390px 手机布局；Chromium 以四倍 CPU 降速测量搜索，并连续播放 60 秒检查列表稳定性。音频使用现场生成的 72 秒合成 MP3，经真实本地音频接口播放。资料容量不代表上传了 2000 个完整音频文件。`node tests/batch-upload-browser.mjs` 另行实传 20 个合成文件，验证批量同步次数和旧响应覆盖保护；两个脚本仅允许本地地址，结束后删除自己的测试音频。结果位于 `output/playwright/capacity-results.json` 和 `batch-upload-results.json`。

列表按可见区域及上下各 8 行渲染，播放进度、上传和下载进度由独立组件订阅。本地资料优先显示，下载文件后台核对；核对期间请求离线播放会等待检查完成。上传保持两首并发，成功后立即更新本机列表，上传期间每 5 秒合并同步，队列结束后再核对云端曲库。

上传去重验收：保持本地预览运行，执行 `node tests/dedup-browser.mjs`，验证首次上传、原名/改名重复上传零分片请求、同名不同内容、并发重复上传和全新浏览器会话；结果与桌面/手机截图在 `output/playwright/dedup-*`。服务端按当前用户和整个文件的 SHA-256 去重，并复核实际上传字节；数据库唯一索引防止并发重复入库，重复的临时音频对象会删除。已有歌曲在遇到相同大小的文件时按需补算指纹，不改动歌曲 ID、资料、收藏和歌单。已经存在的重复记录不会自动合并或删除；不同编码或标签、封面等文件字节发生变化也视为不同文件。

OGG 时长回归：`pnpm fixtures` 还会准备 MDN 的 41 秒 Vorbis 文件，以及原始采样率标记为 0 的合法 Opus 对照文件（仅修改可选头字段及 CRC，不改音频数据）。PowerShell 中执行 `$env:OGG_DURATION_REGRESSION='1'; pnpm test:ogg`，验证旧解析默认值确实漏读时长，以及修复后的上传与离线播放；结果位于 `output/playwright/ogg-duration-results.json`。运行常规专项前用 `Remove-Item Env:OGG_DURATION_REGRESSION` 恢复。Windows WebKit 即使不能解码，也会验证上传和资料读取；播放仍标记为未测试。

PWA 顶部适配：工具栏会随页面滚动保持吸顶，状态栏、横屏安全区、弹窗和全屏播放器有独立留白。安装模式使用固定实色顶部层缓解 iOS 27 的系统模糊，依据 [开发者的实机实验](https://modernwebweekly.substack.com/p/so-whats-up-with-the-ios27-blur)，实际效果仍需 iPhone 主屏幕应用验证。保持本地预览运行，执行 `pnpm test:pwa` 检查 Chromium / WebKit 的六种视口与安全区组合；可用 `TEST_BASE_URL` 指定其他本机端口。该脚本直接激活应用实际的 standalone CSS 规则来验证布局，不模拟 iOS 系统合成器。结果和截图位于 `output/playwright/pwa-layout-results.json` 及同目录。应用升级继续使用「立即更新」提示，保留离线歌曲。

## 项目结构

- `src/`：React 界面、播放器、IndexedDB、下载队列与 Service Worker。
- `server/`：Hono API、Cloudflare Access JWT 验证、分片上传和 Range 音频响应。
- `shared/`：前后端共用校验规则、字段错误结构和数据类型。
- `migrations/`：D1 版本化数据库迁移。
- `tests/`：核心逻辑、Workers 集成和浏览器验收。

接口错误返回 `{ error: { code, message, fields: [{ field, label, reason, action }] } }`，界面显示字段名称、具体原因及修正要求。歌单更新提交版本号，冲突返回 409；收藏操作可安全重试。登录令牌和私密联系方式不会写入错误提示或应用日志。

## Git 版本管理

主分支为 `main`，版本库包含源码、依赖锁文件、数据库迁移和部署配置。依赖目录、构建产物、本机数据库、浏览器缓存、测试输出及本地环境变量文件均已忽略，`.env.example` 作为不含密钥的配置示例保留。

日常修改可使用 `git status`、`git diff` 检查，再通过 `git add` 和 `git commit` 创建提交。提交推送到 GitHub 后，Cloudflare Workers Builds 自动构建和部署。

## 部署与维护

部署详情见 [docs/deployment.md](docs/deployment.md)，验收记录见 [docs/validation.md](docs/validation.md)。

```sh
pnpm build
pnpm test
git push origin main
```

Cloudflare 的生产构建命令为 `pnpm run build`，部署命令为 `npx wrangler deploy`。分支预览使用同一构建命令和 `npx wrangler preview`。`pnpm run deploy` 执行推送到 `main`，由 Cloudflare 执行发布。

预览配置位于 `wrangler.jsonc` 的 `previews` 块，绑定 `afterglow-music-preview-db` 和 `afterglow-music-preview-audio`。所有分支预览共用这组测试资源。`OWNER_EMAIL` 在 Cloudflare 的 Previews Base 中作为 Secret 配置，并由原邮箱允许策略保护预览访问。预览数据库需要应用 `migrations/` 中的对应迁移。

`OWNER_EMAIL` 使用 Worker Secret 保存；`ACCESS_AUD` 与团队地址配置于 `wrangler.jsonc`。更改登录邮箱时，同时更新 Access 精确邮箱策略和 Worker Secret。不要将 `DEV_AUTH` 加入线上配置。

R2 未开放公网桶访问，使用 Worker binding 访问；不需要向浏览器提供 R2 密钥。未完成分片由桶生命周期规则在一天后清理。数据库迁移只追加新版本，不修改已应用迁移；云端数据库与本地测试库相互独立。

应用更新时显示提示，确认更新会重新加载并中断播放。更新应用壳不会清理音乐缓存；变更音频缓存协议时，需要同时迁移缓存索引和文件，不能仅修改缓存名称。
