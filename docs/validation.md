# 验收记录

日期：2026-11-09。环境：Windows、Node.js 24、Cloudflare 本地 Worker/D1/R2。

## 自动测试

类型检查、生产构建和 43 项自动测试全部通过。

- 字段校验明确返回字段名称、原因、修正要求，不回显提交值。
- Access JWT 验证配置邮箱、签名、有效期、issuer、audience，拒绝伪造身份。
- 分片完整性、错误分片大小、取消、损坏音频、超长 ID3 标签、完成重试。
- 在线音频字节范围、后缀范围、HEAD、416，以及收藏幂等、歌单版本冲突和删除级联。
- 下载完整性、截断响应、登录 HTML 误返回、存储配额错误、手动下载保留及自动缓存清理。

500 条歌曲资料的本地 API 快照约 100 KB，最终运行读取与解析约 12 ms；测试歌曲大小字段合计约 5 GB。这是资料列表测试，不代表已经上传或播放完整 5 GB 音频。

## 浏览器验收

Chromium（本机 Chrome）与桌面 WebKit 各通过 18 个场景：PWA 注册、真实 MP3 上传与资料读取、手动下载、实际解码播放、AAC/M4A 上传与解码、带字段提示的歌单创建、独立浏览器上下文读取云端歌单、自动缓存、搜索、390px 手机布局、断网刷新播放与拖动、离线 206 响应、跳过未缓存歌曲、未缓存原因提示、离线禁止修改、清理自动缓存保留手动下载、缓存文件丢失后校正状态、退出清除。

浏览器输出：`output/playwright/results.json`；桌面及手机截图同目录。MP3 为生成的合成音频，AAC 来自 Chromium 官方媒体测试数据，无测试音乐写入生产曲库。

## 线上检查

已发布到 `https://music.qwas.fun`。12 项线上检查通过：主页、Service Worker、manifest 和三个应用图标返回 200；未登录的曲库、身份与音频请求受 Access 保护；伪造 JWT 请求被拒绝；浏览器成功注册和控制 PWA；邮箱验证码登录页面可到达。未发送验证码，未绕过登录，未读取或写入线上私人曲库。

## 尚未验证

- 实际 iPhone Safari、添加到主屏幕、锁屏或切换应用后的媒体控制和后台行为；桌面 WebKit 不代替真机结论。
- 真实邮箱的验证码接收和完整登录往返。
- 完整 5 GB 音频实传与多日缓存留存。

首次真机验收建议：登录 → 上传歌曲 → 手动下载 → 添加主屏幕 → 开启飞行模式 → 重新打开 → 播放及拖动 → 锁屏控制 → 恢复网络同步 → 退出确认清理。

## 2026-11-10：FLAC 支持

- 增加 FLAC 文件选择、上传、资料和内嵌封面读取，云端与音频响应使用 `audio/flac`，原文件保留，不转码。
- 后端按 [RFC 9639](https://www.rfc-editor.org/rfc/rfc9639.html) 检查文件标识、STREAMINFO、采样参数、元数据边界和音频帧起始，损坏文件返回可定位的「音频文件」错误。读取大封面时只读取必要的元数据头。
- 类型检查、生产构建及 56 项自动测试通过，包含合法 FLAC、伪装文件、损坏元数据、R2 MIME 和 Range 音频响应。
- Chromium 完成 16 位/44.1 kHz、24 位/96 kHz 的上传、歌曲资料、封面、实际解码播放、下载、断网刷新、拖动、离线 Range 和缓存 SHA-256 原始字节一致性验证。专项输出：`output/playwright/flac-results.json`。
- Windows WebKit 对官方 `sfx.flac` 对照样本也无法完成实际解码，尽管 `canPlayType` 返回支持；专项脚本将该内核标记为未测试，不将它作为 Safari FLAC 已通过的证据。实际 iPhone Safari 验收仍待完成。
- 单文件 64 MiB 上限和每台设备独立缓存的规则保持不变，无数据库迁移。

## 2026-11-10：OGG 支持

- 支持 `.ogg` 文件，音频编码为 Vorbis 或 Opus。前后端共用格式校验，音频存储与响应 MIME 为 `audio/ogg`，原文件不转码。
- 后端依据 [RFC 3533](https://www.rfc-editor.org/rfc/rfc3533.html)、[RFC 7845](https://www.rfc-editor.org/rfc/rfc7845.html) 与 [Vorbis I 规范](https://www.xiph.org/vorbis/doc/Vorbis_I_spec.html) 检查起始页、编解码识别头、声道/采样参数、页 CRC、结束页和字节边界；只读取识别页及有限的尾部数据，不整文件缓冲。
- 类型检查、生产构建及 75 项自动测试通过，包含 OGG 格式大小写、Vorbis / Opus 上传、正确 MIME、Range 音频、损坏页 CRC、截断文件、非音频编码和具体字段错误。
- Chromium 的 Vorbis、Opus 各通过 8 项专项检查：上传与资料读取、MIME 和在线 Range、真实解码播放、完整下载、离线刷新播放、离线拖动、离线 206 响应、缓存 SHA-256 字节一致性。参考音频来自 Chromium 官方测试数据，仅用于本地验收。
- 原有 MP3 / M4A、歌单、收藏和离线行为在 Chromium、WebKit 中各通过 18 项回归场景。
- Windows WebKit 在参考文件的原生解码预检中无法解码 OGG，两种编码均记录为未测试，不记为通过。实际 iPhone 尚未验证；[WebKit 官方文档](https://webkit.org/blog/16574/webkit-features-in-safari-18-4/)说明 iPhone 的 OGG Vorbis / Opus 支持从 iOS 18.4 / Safari 18.4 开始。
- 专项结果为 `output/playwright/ogg-results.json`。单文件上限仍为 64 MiB，不涉及数据库迁移。

## 2026-11-10：OGG 上传时长修复

- 复现「音频时长：无法读取时长」：`music-metadata` 默认解析会在 OGG 前段元数据完成后提前停止，较长文件尚未读取结束页时返回空时长。改为对 OGG 显式启用完整时长读取，其他格式保持现有解析方式。
- 对原始输入采样率为 0 的合法 Opus 增加结束页时长回退：共用前后端 OGG 页结构与 CRC 校验，按固定 48 kHz 和 pre-skip 计算，不填入虚假时长。依据 [RFC 7845](https://www.rfc-editor.org/rfc/rfc7845.html)，原始输入采样率只是可选资料，不是播放采样率。无有效时长或损坏结束页仍返回具体字段、原因和重新导出要求。
- 类型检查、生产构建及 80 项自动测试通过，新增 5 项回归涵盖 Vorbis / Opus 提前停止、未指定输入采样率及损坏结束页。
- 使用 [MDN 的真实 Vorbis 示例](https://github.com/mdn/webaudio-examples/blob/main/audio-param/viper.ogg)（40.984 秒）及修改可选输入采样率为 0 的 Chromium Opus 参考音频，先确认旧默认解析确实返回空时长。两种文件在 Chromium 各通过 9 项检查，包含上传资料与时长、真实播放、完整下载、离线刷新与拖动、Range 和缓存字节一致性。
- Windows WebKit 的两种文件均通过上传、资料时长和在线 Range 验证；原生解码预检仍失败，因此播放标记为未测试。iPhone 未进行真机验收。
- 原有 MP3 / M4A、歌单、收藏和离线功能在 Chromium、WebKit 各通过 18 项回归。专项结果：`output/playwright/ogg-duration-results.json`。参考文件只用于本地测试，不写入线上曲库。
