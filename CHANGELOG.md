# Changelog

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
