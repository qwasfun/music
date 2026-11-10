# Cloudflare 部署记录

## 2026-11-11：PWA 顶部模糊兼容修复（已上线）

Worker 版本 `c2a273af-8dfb-40b6-a3e8-fdbf968f0467` 已发布至 `https://music.qwas.fun`，标签为 `ios27-pwa-top-blur`，对应源码提交 `743ca6f`，分支 `codex/ios27-pwa-top-blur`。此前线上版本为 `a12b7722-4f67-40e3-9116-35b730bcf57c`。

发布基线先记录此前已经上线但尚未提交的千首曲库优化与上传去重，重建基线的 26 个静态资源均与既有线上发布记录 SHA-256 一致。PWA 修复独立提交，保留现有虚拟列表、批量上传、文件去重、播放和离线缓存。此次未修改后端与缓存协议，无新增数据库迁移，也未执行远程迁移或私人曲库写入；原工作区的未提交改动保留。

生产构建、类型检查及 109 项自动测试通过；新增 PWA 布局共 50 项行为检查、Chromium / WebKit 各 18 项原有功能回归、各 6 项去重和各 8 项千首曲库检查，以及 20 文件批量上传的 3 项检查均通过。iOS 系统模糊的最终效果尚待主屏幕真机验证，详见验收记录。

发布后 12 项线上页面、PWA 注册、登录入口和访问保护检查通过。26 个公开静态资源 SHA-256 与此次本地构建一致，主脚本 `index-Ci8NJmCu.js` 和样式 `index-Drl6dTUp.css` 已进入 Service Worker 预缓存；顶部实色层、安全区样式、安装背景配色、上传去重和虚拟列表标识均已核对。D1、R2、ASSETS 绑定及 `OWNER_EMAIL` Secret 保留，线上未启用本地开发鉴权。结果为 `output/playwright/production-results.json` 和 `production-pwa-release-assets.json`。

已打开的应用需要刷新，并在更新提示中点击「立即更新」后使用新样式；已有离线歌曲会保留。无需删除或重新安装主屏幕应用。

目标域名：`music.qwas.fun`。

| 资源 | 配置 |
| --- | --- |
| Worker | `afterglow-music` |
| D1 | `afterglow-music-db`，binding `DB` |
| D1 ID | `c971672a-616f-4b18-858f-aedcac81fd98` |
| R2 | `afterglow-music-audio`，binding `BUCKET`，APAC，私有 |
| Access 应用 | `余音 · AFTERGLOW` |
| Access 应用 ID | `78f7fcf4-58d8-4bd3-aaa6-639dec1b49d3` |
| 保护路径 | `music.qwas.fun/api` 及其子路径 |
| 身份提供方 | 新建 Music Email OTP，仅用于此应用的允许列表 |
| 会话有效期 | 720 小时；离线播放使用本机已保存文件 |

生产配置禁用 workers.dev 和预览 URL。公开静态应用壳不包含个人音乐资料；所有云端曲库数据都从受保护接口取得。Worker 验证 Access JWT 的签名、issuer、audience、有效期、必需字段和邮箱白名单，不能仅凭伪造身份请求头访问。

音频接口为同源 URL，返回正确 MIME、Content-Length、Accept-Ranges、ETag 与 Content-Range。媒体流不经 Worker 整文件缓冲。手动及自动下载单独请求完整 200 响应，下载完成且字节数一致后写入就绪索引。

上传按 8 MiB 分片，最多同时上传两首，单分片失败最多重试三次。后端核对分片编号、大小、总长度与音频容器/编码特征；完成操作可以重试。R2 生命周期只清理未完成分片，不自动删除已完成歌曲。

初始迁移已应用到本应用新建的 D1。未修改其他 Worker、现有 Access 应用或已有身份提供方。

已发布并确认 `https://music.qwas.fun` 正常提供页面与 PWA 资源。初始代码版本为 `f86154c5-593a-45c0-a756-f23b6510fa4a`，随后配置 `OWNER_EMAIL` Worker Secret。线上 12 项检查通过，详见验收记录。

邮箱验证码登录页面已验证可到达；验证码收件与完整登录往返、iPhone 真机操作仍需要实际账号和设备验证，不通过绕过登录完成线上私人数据验收。

最终复核确认：Access 仅有一条精确邮箱允许策略，要求 OTP 身份提供方；显示名称为「余音 · AFTERGLOW」，应用 audience 未变化。更新名称后再次通过 12 项线上检查。

## 2026-11-10：FLAC 更新

FLAC 文件上传、资料/封面读取、在线播放与离线缓存已发布。Worker 版本为 `1c9dce9c-9caf-4268-9bad-051fe74b3908`，无需数据库迁移。新前端文件选择和共享校验包含 `.flac`、`audio/flac`；R2 与音频响应使用 `audio/flac`。`OWNER_EMAIL` Secret 保留，沿用现有 Access、D1 和 R2 资源。

已打开应用的用户需刷新页面，并在出现新版本提示时选择「立即更新」，以加载新的格式选择入口；原有音乐缓存会保留。详细兼容性与测试范围见验收记录。

## 2026-11-10：OGG 更新

OGG（Vorbis / Opus）的上传、资料读取、在线播放、完整下载和离线播放已发布。Worker 版本为 `06ffa079-6c20-406f-b90a-62ed6ab1714b`，未新增云资源或数据库迁移。R2 和音频响应使用 `audio/ogg`，原有登录邮箱 Secret、Access 保护、曲库和缓存协议保留。

75 项自动测试、Chromium 的两种 OGG 编码各 8 项专项检查、Chromium/WebKit 各 18 项原有功能回归，以及 12 项线上检查通过。线上前端资源已确认包含 `.ogg` 文件入口和 Vorbis/Opus 格式说明。真实 iPhone 仍待验收，所需 Safari/iOS 版本见 README。

## 2026-11-11：千首曲库优化（已上线）

新增迁移 `0002_library_indexes.sql`，为歌单所属用户和歌曲的歌单引用增加索引。已在本地及线上数据库应用，两个索引均已确认存在。Worker 版本为 `2f9fe4b3-a307-4429-9728-0f1dcacf21aa`，已切换 100% 流量；上一版本为 `9aca8681-8d2e-48ff-ab29-ae6915a380a7`。发布前后曲库均为 292 首歌曲。

本次沿用现有构建、测试、远程迁移和 Worker 发布流程，先应用追加索引，再发布 Worker。接口数据结构和歌单版本冲突规则兼容原版本；音频及封面缓存名称、IndexedDB 版本不变，更新保留已有下载。新前端通过原有 PWA 更新提示加载。本次无需新增云资源、Secret 或 Access 配置。`OWNER_EMAIL` Secret、D1/R2/ASSETS 绑定已复核保留，线上未设置 `DEV_AUTH`。

12 项线上页面、PWA、访问保护及邮箱登录入口检查通过；26 个公开静态资源（包含主页、Service Worker、主脚本及音频资料读取模块）的 SHA-256 与本地构建一致。输出位于 `output/playwright/production-results.json` 和 `production-release-assets.json`。当前检查未登录私人曲库，未向线上上传测试音频；实际登录后的播放和 iPhone 真机仍待验证。

## 2026-11-10：OGG 时长修复

已发布 Worker 版本 `9aca8681-8d2e-48ff-ab29-ae6915a380a7`，修复默认解析提前结束导致长 OGG 歌曲时长为空，并兼容原始输入采样率未指定的 Opus 文件。无需数据库迁移，沿用现有资源；`OWNER_EMAIL` Secret 已确认保留。

类型检查、生产构建、80 项自动测试及 Chromium / WebKit 各 18 项原有功能回归通过。真实长 Vorbis 和特殊 Opus 在 Chromium 各通过 9 项完整播放与离线检查，Windows WebKit 已验证上传和时长，播放受本机原生解码能力限制，未记为通过。线上主脚本 `index-CIg3dff0.js` 和 OGG 检查模块与本地构建 SHA-256 一致，均已纳入 Service Worker 预缓存。

12 项线上页面、PWA、Access 访问保护及登录入口检查通过；未向线上私人曲库写入测试音频。

已经打开的页面需刷新，并在出现新版本提示时点击「立即更新」后重新上传；已有音乐缓存保留。

## 2026-11-11：上传文件去重（已上线）

迁移 `0003_upload_deduplication.sql` 已应用到线上 D1，为歌曲保存文件 SHA-256，并用用户/指纹唯一索引保证并发上传仅保留一首。线上已确认迁移记录、`tracks_user_content_hash` 唯一索引及 `tracks_unhashed_size` 索引均存在，发布前后曲库均为 292 首，未预先扫描或删除旧音频。

本次先应用远程迁移，再发布 Worker。新版本为 `a12b7722-4f67-40e3-9116-35b730bcf57c`，部署 `f2cb1f03-902a-4791-816b-6e5555a2ec41` 已切换 100% 流量；上一版本为 `2f9fe4b3-a307-4429-9728-0f1dcacf21aa`。旧曲库的指纹在遇到相同大小的上传时按需计算，保留歌曲资料、收藏、歌单和已有下载；已有重复记录不会自动合并。旧客户端未提交指纹时可继续上传，服务端在完成阶段去重并清理多余对象；新客户端会在传输前跳过已存在的文件。

现有 D1、R2、ASSETS 绑定和 `OWNER_EMAIL` Secret 已复核保留，线上没有 `DEV_AUTH`。无需新增资源、Secret 或 Access 配置。公开页面、PWA、移动布局、Access 保护及邮箱登录入口共 12 项线上检查通过；26 个静态资源的 SHA-256 与本地构建一致，新主脚本 `index-Y6Uf5V-q.js` 包含「歌曲已存在，已跳过」并纳入 Service Worker 预缓存。结果位于 `output/playwright/production-results.json` 和 `production-release-assets.json`。

本地生产构建、109 项自动测试、Chromium/WebKit 各 6 项去重及各 18 项原有功能回归、20 个不同文件的批量上传回归均已通过。本次线上检查未登录私人曲库或上传测试音乐；真实账号的重复上传与 iPhone 真机仍待验证。已打开的应用需刷新，并在新版本提示中选择「立即更新」后使用上传前查重；原有离线下载保留。
