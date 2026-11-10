# Cloudflare 部署记录

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

## 2026-11-10：OGG 时长修复

已发布 Worker 版本 `9aca8681-8d2e-48ff-ab29-ae6915a380a7`，修复默认解析提前结束导致长 OGG 歌曲时长为空，并兼容原始输入采样率未指定的 Opus 文件。无需数据库迁移，沿用现有资源；`OWNER_EMAIL` Secret 已确认保留。

类型检查、生产构建、80 项自动测试及 Chromium / WebKit 各 18 项原有功能回归通过。真实长 Vorbis 和特殊 Opus 在 Chromium 各通过 9 项完整播放与离线检查，Windows WebKit 已验证上传和时长，播放受本机原生解码能力限制，未记为通过。线上主脚本 `index-CIg3dff0.js` 和 OGG 检查模块与本地构建 SHA-256 一致，均已纳入 Service Worker 预缓存。

12 项线上页面、PWA、Access 访问保护及登录入口检查通过；未向线上私人曲库写入测试音频。

已经打开的页面需刷新，并在出现新版本提示时点击「立即更新」后重新上传；已有音乐缓存保留。
