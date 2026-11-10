# 余音 · AFTERGLOW

个人音乐播放器 PWA。中文深色界面，支持私人云端曲库、歌单、收藏、在线播放与完整歌曲离线缓存。

线上地址：<https://music.qwas.fun>。登录由 Cloudflare Access 邮箱验证码提供，仅允许已配置的个人邮箱。首页静态界面可公开加载，曲库、音频、封面及写入接口均需要鉴权。

## 使用

1. 点击「登录曲库」，使用允许的邮箱接收验证码。
2. 点击「上传音乐」，选择 MP3、AAC 编码的 M4A、FLAC 或 OGG（Vorbis / Opus）；每个文件最多 64 MiB，支持多选与拖放。原音频保留、不转码，支持读取内嵌封面与歌曲资料、在线播放、下载及离线拖动。
3. 歌曲会自动读取标题、歌手、专辑、时长与封面。更多菜单可编辑资料、添加到歌单、调整歌单顺序或删除。
4. 点击歌曲旁的下载按钮，将整首歌保存到本机；歌单页面支持批量下载。
5. 在设置中可启用自动缓存，默认关闭。默认容量为 1 GiB；手动下载不会被自动清理。

离线时可以浏览、搜索本机资料和播放已下载歌曲，修改收藏、歌单和上传需要联网。每台设备单独管理音频下载，云端同步歌曲资料、歌单和收藏。播放队列、音量与位置保留在当前浏览器。

iPhone 请使用 Safari 打开，在分享菜单中选择「添加到主屏幕」。下载期间保持应用在前台；系统可能暂停后台下载或清理网站存储，离线页会核对实际文件状态。退出登录会清除本机资料与音频，云端内容保留。

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

## 项目结构

- `src/`：React 界面、播放器、IndexedDB、下载队列与 Service Worker。
- `server/`：Hono API、Cloudflare Access JWT 验证、分片上传和 Range 音频响应。
- `shared/`：前后端共用校验规则、字段错误结构和数据类型。
- `migrations/`：D1 版本化数据库迁移。
- `tests/`：核心逻辑、Workers 集成和浏览器验收。

接口错误返回 `{ error: { code, message, fields: [{ field, label, reason, action }] } }`，界面显示字段名称、具体原因及修正要求。歌单更新提交版本号，冲突返回 409；收藏操作可安全重试。登录令牌和私密联系方式不会写入错误提示或应用日志。

## Git 版本管理

主分支为 `main`，版本库包含源码、依赖锁文件、数据库迁移和部署配置。依赖目录、构建产物、本机数据库、浏览器缓存、测试输出及本地环境变量文件均已忽略，`.env.example` 作为不含密钥的配置示例保留。

日常修改可使用 `git status`、`git diff` 检查，再通过 `git add` 和 `git commit` 创建提交。远程仓库单独配置，提交代码不会自动部署网站；发布仍使用下方的部署流程。

## 部署与维护

部署详情见 [docs/deployment.md](docs/deployment.md)，验收记录见 [docs/validation.md](docs/validation.md)。

```sh
pnpm build
pnpm test
pnpm exec wrangler d1 migrations apply DB --remote
pnpm exec wrangler deploy
```

`OWNER_EMAIL` 使用 Worker Secret 保存；`ACCESS_AUD` 与团队地址配置于 `wrangler.jsonc`。更改登录邮箱时，同时更新 Access 精确邮箱策略和 Worker Secret。不要将 `DEV_AUTH` 加入线上配置。

R2 未开放公网桶访问，使用 Worker binding 访问；不需要向浏览器提供 R2 密钥。未完成分片由桶生命周期规则在一天后清理。数据库迁移只追加新版本，不修改已应用迁移；云端数据库与本地测试库相互独立。

应用更新时显示提示，确认更新会重新加载并中断播放。更新应用壳不会清理音乐缓存；变更音频缓存协议时，需要同时迁移缓存索引和文件，不能仅修改缓存名称。
