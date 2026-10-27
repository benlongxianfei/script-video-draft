# Agnes 中国站接入要点（2026-10 核实）

## 基本信息

| 项 | 值 |
|---|---|
| Base URL | `https://api.agnes-ai.cn`（直连，无需代理） |
| 国际站 | `https://apihub.agnes-ai.com/v1`（本项目不接入，仅作对照） |
| 认证 | `Authorization: Bearer <AGNES_API_KEY_CN>` |
| 查模型 | `GET /v1/models`（返回当前 key 可用模型列表） |

中国站 `/v1/models` 实测返回 9 个：

```
agnes-2.5-flash  agnes-2.5-pro  agnes-2.5-pro-alpha  agnes-2.5-pro-beta  agnes-3.0-flash
agnes-image-2.1-flash  agnes-image-2.5-flash
agnes-video-2.5        agnes-video-2.5-flash
```

国际站同批模型基本一致（多一个 `agnes-image-2.0-flash`），但本项目只走中国站。

## 免费模型 vs 付费模型（关键）

| 模态 | 免费（现价 $0） | 付费 | 说明 |
|---|---|---|---|
| 文本 | `agnes-3.0-flash`、`agnes-2.5-flash` | `agnes-2.5-pro` / `-pro-beta` | 与出片无关 |
| 图片 | **`agnes-image-2.5-flash`** | 无（2.0 / 2.1 / 2.5 三档全部 $0） | 1K/2K/3K/4K **全档免费** |
| 视频 | **`agnes-video-2.5-flash`** | `agnes-video-2.5`（720P $0.025/s、1080P/1K $0.040/s、2K $0.055/s） | 免费档最高 **720P** |

### 两条实测证据（不是抄文档）

1. `agnes-image-2.5-flash` + `size: "2K"` + `ratio: "16:9"` → 返回 **2624×1472**，2.3MB，`$0`。
2. 免费 key 提交 `agnes-video-2.5`：

   ```
   403 {"code":"insufficient_user_quota","message":"预扣费失败，用户剩余额度: ￥0.100000，需要预扣: ￥0.750000"}
   ```

   → 付费模型用免费额度跑不动；免费只能用 `agnes-video-2.5-flash`。

> 顺带：`agnes-video-v2.0` 在当前分组下已 **model_not_found**（已下架）。旧教程里的 `num_frames` 写法只对旧模型有效。

## 生图：档位 + 比例

`size` 用档位（`1K`/`2K`/`3K`/`4K`）时必须同时给 `ratio`：

```
POST /v1/images/generations
{
  "model": "agnes-image-2.5-flash",
  "prompt": "…",
  "size": "2K",
  "ratio": "16:9",
  "extra_body": { "response_format": "url" }
}
→ { "data": [ { "url": "https://…png" } ] }
```

| ratio | 1K | 2K | 3K | 4K |
|---|---|---|---|---|
| 16:9 | 1312×736 | **2624×1472** | 3936×2208 | 5248×2944 |
| 9:16 | 736×1312 | 1472×2624 | 2208×3936 | 2944×5248 |
| 1:1 | 1024×1024 | 2048×2048 | 3072×3072 | 4096×4096 |
| 3:4 | 864×1152 | 1728×2304 | 2592×3456 | 3456×4608 |
| 4:3 | 1152×864 | 2304×1728 | 3456×2592 | 4608×3456 |

- 直接写像素（如 `1312x736`）也能跑，但会被归一到最近档位；建议用档位写法
- **免费档 2K 每张都是 $0**，所以默认用 2K（源图更清楚），只受 RPM 限制
- 出片是 720P 时，2K 源图会被缩到 720P；想更快就 `--size 1K`

## 生视频：免费档协议

```
POST /v1/videos
{
  "model": "agnes-video-2.5-flash",
  "prompt": "肩膀缓慢下沉，慢推，不改变外观",
  "seconds": "5",            // 4~12 秒
  "mode": "reference",       // 单图参考帧用 reference + images
  "size": "720P",            // 免费档最高 720P
  "aspect_ratio": "16:9",
  "n": 1,
  "images": ["https://…png"]
}
→ { "video_id": "…" }
```

查询（2.5 系列必须带模型名）：

```
GET /agnesapi?video_id=<id>&model_name=agnes-video-2.5-flash
→ { "status": "completed", "metadata": { "url": "https://…mp4" } }
```

`mode` 三种取值：`text`（纯文生视频）、`reference`（参考图，单图起帧用这个）、`keyframe`（首尾帧）。

### 旧模型 `agnes-video-v2.0`（若你的分组还支持）

```
{ "model": "agnes-video-v2.0", "prompt": "…",
  "width": 1920, "height": 1080, "num_frames": 121, "frame_rate": 24,
  "image": "https://…png" }
```

`num_frames` 必须 **8n+1**（65≈2.7s / 121≈5s / 241≈10s，1080p 上限 241，265 报 400），
输出实际 **1920×1088**。

## RPM 限制（免费档，官网现行值）

来源：Agnes 官方文档 `wiki.agnes-ai.com/en/docs/tokenplan`（Token Plan FAQ）。
基础版本生效 2026-06-22，视频 RPM 更新 2026-06-28，**文本 RPM 于 2026-09-23 下调 50%**。

### 免费 / default 用户

| 模态 | 规格 | 允许 RPM | **实际生效 RPM** | 对应间隔 |
|---|---|---|---|---|
| 文本 | — | 30 | **10** | 6s |
| 图片 | 1K | 20 | **10** | 6s |
| 图片 | 2K | 10 | **5** | 12s |
| 图片 | 3K | 2 | **1** | 60s |
| 图片 | 4K | 1 | **1** | 60s |
| 视频 | — | 2 | **1** | ≥60s（脚本用 65s） |

### 对照：企业认证 / Token Plan

| 模态 | 规格 | 企业（允许/实际） | Token Plan（允许/实际） |
|---|---|---|---|
| 文本 | — | 60 / 20 | 1000 / 1000 |
| 图片 | 1K | 60 / 40 | 120 / 100 |
| 图片 | 2K | 40 / 20 | 120 / 80 |
| 图片 | 3K / 4K | 2 / 1、2 / 1 | 2 / 1、2 / 1 |
| 视频 | — | 2 / 2 | 6 / 5 |

Token Plan 除 RPM 外还有配额：`agnes-3.0-flash` 按请求数（Starter 1500 次/5 小时），
**图片 4000 张/天、视频 500 秒/天**（三档相同）。

### 落地规则

- **限制池按 key 类型共享，不按单个 key**：多建几个免费 key 不会提高额度
- 图片按**档位**分级限速：2K 只有 5 RPM，批量时按 12s 一张排
- 视频免费 1 RPM：相邻两次提交 ≥65s，429 读 `Retry-After`，没有就等 70s
- 状态查询也有独立限流（`video status query limit exceeded`）→ 轮询 10s
- 官方写明数值"可能调整"，所以本项目把 RPM 放进 `config.example.json`

## `503 video_queue_full` 到底是什么（2026-10-27 实测诊断）

**现象**：提交视频时立刻返回（180ms 级），body 为
`{"code":"video_queue_full","message":"视频队列已满，请稍后重试"}`，国际站同报 `video queue is full`。

**结论：免费档的共享渲染队列饱和，请求在"入队前"就被拒了。** 证据链：

| 观察 | 含义 |
|---|---|
| 中国站与**国际站同时**返回 queue_full | 平台级容量问题，不是你的 key/账号/网络 |
| 同一时刻生图接口 **200 正常** | 账号、域名、鉴权都没问题 |
| 纯 `mode: text` 也 503；付费模型 `agnes-video-2.5` 报的是 `403 insufficient_user_quota` | **只针对免费视频池**，付费池不受此限 |
| 被拒时**没有 `video_id`**，也没有任务记录 | **未创建任务、不消耗视频时长额度** |
| 持续 8 分钟重试仍 503；社区另有人记录 12+ 分钟 | 饱和不是"几秒抖动"，要有 10 分钟级耐心或错峰 |

**该怎么做**

1. **错峰重试**：免费池在亚太/美区工作时段最挤，深夜与清晨常常一次通过
2. **延长重试预算**：本项目默认 20 轮退避（前 10 轮 30s、之后 60s，≈12 分钟），可用 `AGNES_QUEUE_RETRY` 调
3. **换模型池**：免费池挤时可试旧模型（若分组仍开放 `agnes-video-v2.0`），或付费 `agnes-video-2.5`
4. **减小单次占用**：`seconds` 从 12 降到 4~5，被接纳概率更高
5. 不需要重新生图 —— 图已拿到，续传脚本只补缺的镜头

> 这条不是代码 bug：请求在创建任务前被拒，任何客户端（包括官方 App）都会遇到。

## 720P 档的实际像素

`size: "720P"` 是**档位**，实际像素由 `aspect_ratio` 决定，社区实测 16:9 约 **1280×704**。
若你的下游画布是 1920×1080，剪映会把素材放大 1.5 倍（略软）；
想避免放大，把草稿画布设成 1280×720（`build_draft.py --width 1280 --height 720`）。

## 报错对照

| 返回 | 含义 | 处理 |
|---|---|---|
| `429 allows N requests per 1 minute(s)` | 触发 RPM | 等 `Retry-After` 或 60~70s |
| `403 insufficient_user_quota` | 用了付费模型但余额不足 | 换 `*-flash` 免费模型 |
| `404 model_not_found：当前分组不支持模型 X` | 模型已下架 | 换当前免费模型 |
| `503 video_queue_full` | 视频队列满 | 等 30s 重试 |
| `400 num_frames ... exceeds maximum 241` | 旧模型帧数超限 | 用 65/121/241 |

## 网络

- 中国站直连稳定；偶发 `fetch failed`，重试 6 次 × 4s
- 输出下载域名 `cos-platform-outputs.agnes-ai.cn` 可直连
- `api.agnes-ai.com` 是**网页域名**，不是 API 地址（POST 会返回 `000201 Resource not found`）
