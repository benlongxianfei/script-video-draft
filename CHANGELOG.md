# Changelog

## 未发布

**新增画风包（仅文档，无接口变更）**

- `docs/style-packs.md` 新增第 4 套画风：**2D 动画概念·拟人动物绘本** —— 勾线 + cel/柔笔刷混合上色、
  半写实背景、暖色轮廓光的动画电影概念图气质，适合动物拟人主角的寓言/成长类叙事
- 附锚点写法、"最容易翻车的三处"对照表、可选的 2.35:1 电影遮幅用法
- 实测样张：Agnes `agnes-image-2.5-flash` / 2K / 16:9（2624×1472）一次命中

## v2.1.0 (2026-10-27)

**改名（仅名称，无接口变更）**：

- 中文名：文案转剪映三轨草稿 → **文案生视频再转剪映草稿**
- 英文名 / 仓库名：`script2jianying` → **`script-video-draft`**（旧地址 301 跳转）
- 技能 `name`：`script-video-draft`；`display_name_en`：Script-Video-Draft

## v2.0.0 (2026-10-27)

**改名 + 平台解耦**（不兼容旧命令，仓库名同时变更）：

- 仓库/技能改名：`agnes-bw-video-lite` → **`script2jianying`**（中文显示名「文案转剪映三轨草稿」）。
  名字只描述功能，不再绑定任何平台商标。
- **新增平台适配器架构**：
  - `scripts/provider.mjs` 统一入口（`image` / `video` / `ls`）
  - `scripts/providers/agnes.mjs` 默认适配器（原 `agnes_client.mjs` 的能力迁过来）
  - `scripts/providers/template.mjs` 换平台模板（可灵 / 即梦 / Runway / Vidu / 自建服务）
  - 选平台优先级：`--provider` > `PROVIDER` > `config.json` 的 `provider` > 默认 `agnes`
- `batch_generate.mjs` 改为调用 `provider.mjs`，新增 `--provider`；不再传 `--frames`（时长统一用 `--seconds`）
- 新增 `docs/providers.md`：适配器契约、换平台四步、常见平台字段对照、换平台后还要改什么
- 文档重组：`docs/agnes-api-cn.md` → `docs/provider-agnes.md`（降级为"某个适配器的实现细节"）

> 旧命令 `scripts/agnes_client.mjs` 已移除；等价写法：`node scripts/provider.mjs <image|video> …`

## v1.1.1 (2026-10-27)

合规补齐 + 队列满容错：

- **新增 `THIRD_PARTY.md`**：依赖许可证（pyJianYingDraft Apache-2.0、FFmpeg LGPL/GPL）、第三方服务、商标归属、仓库明确不包含项、数据来源。
- **README「合规与免责（请先读）」重写**：非官方声明、密钥与资产、价格以官方公告为准、内容合规 5 条红线（心理类内容不得冒充诊疗/制造焦虑）、肖像与克隆音色需授权。
- **`503 video_queue_full` 实测诊断**写入 `docs/agnes-api-cn.md`：免费池共享队列饱和，入队前被拒、不扣额度、两站同时满、付费池不受影响；给出错峰与换池策略。
- **退避预算加大**：队列满重试 12 → **20 轮**（前 10 轮 30s、之后 60s，≈12 分钟），可用 `AGNES_QUEUE_RETRY` 调整。
- **批量更抗打断**：`batch_generate.mjs` 单镜失败不再中断整批，末尾汇总失败项，重跑自动续传。
- `tts_doubao.py`：火山 app key 支持 `DOUBAO_APP_KEY` 覆盖。

## v1.1.0 (2026-10-27)

按官网最新公告与实测结果同步模型与限速：

- **生图模型升级**：`agnes-image-2.1-flash` → **`agnes-image-2.5-flash`**（当前最高免费版本）。
  同时改用档位写法：默认 `size: 2K` + `ratio: 16:9` → **2624×1472**（1K 为 1312×736）。
- **生视频模型确认**：免费档最高为 **`agnes-video-2.5-flash`**（720P）；`agnes-video-2.5` 为付费
  （实测免费 key 返回 `403 insufficient_user_quota`）。
- **新增免费档 RPM 落地**：图片 1K 10 / 2K 5 / 3K 1 / 4K 1，视频 1（允许 2）；批量脚本按档位自动排间隔。
- **新增**：`403 insufficient_user_quota` 友好提示（引导改用 `*-flash`）；`GET /v1/models` 核对说明。
- 文档：`docs/agnes-api-cn.md` 重写，含模型对照、档位尺寸表、RPM 三档对照与公告生效日期。

## v1.0.0

首个开源精简版本。

### 与作者自用完整版的差异

| 项 | 精简版 | 说明 |
|---|---|---|
| 生成站点 | **只用 Agnes 中国站** | 去掉国际站与双站并行调度，协议更简单 |
| 配音 | **只用豆包 TTS（火山引擎）** | 去掉第三方音色渠道 |
| 脚本 | 4 个（client / batch / tts / draft） | 去掉超分重制、停顿诊断、ffmpeg 直出等分支 |
| 配置 | 全部外置（env + config.json） | 无任何硬编码路径与个人音色 ID |
| 文档 | 6 篇 docs | 保留方法论与验收标准，去掉账号专属内容 |

### 包含

- `SKILL.md`：五条铁律 + 五阶段流程 + 分镜包格式 + 校验清单
- `scripts/agnes_client.mjs`：Agnes 中国站最小客户端（image / video / query）
- `scripts/batch_generate.mjs`：分镜包批量生成，断点续传 + 65s 限速
- `scripts/tts_doubao.py`：豆包逐句配音，去静音 + 60ms 尾停 + 时间轴
- `scripts/build_draft.py`：剪映三轨草稿 + 四道对齐校验 + 字段换算写回
- `docs/`：中国站协议、豆包配音、剪映字段、质量验收、画风包、踩坑表

### 已知限制

- 视频接口免费档实际 1 次/分钟：16 镜约 55 分钟，25 镜约 85 分钟，无法用并发绕过
- 免费档视频最高 720P；1080P/2K 需付费模型 `agnes-video-2.5` 或旧模型 `agnes-video-v2.0`（多已下架）
- 图片 2K 档只有 5 RPM，25 张约 5 分钟（脚本自动排间隔）
- 只验证 Windows + 剪映国内版；剪映 6+ 会加密已保存草稿
- 豆包音色/资源 ID 必须匹配，报 mismatch 时优先检查这一点
