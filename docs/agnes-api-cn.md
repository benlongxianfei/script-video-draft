# Agnes 中国站接入要点（精简版只用中国站）

## 基本信息

| 项 | 值 |
|---|---|
| Base URL | `https://api.agnes-ai.cn`（直连稳定，不需要代理） |
| 认证 | `Authorization: Bearer <AGNES_API_KEY_CN>` |
| 生图模型 | `agnes-image-2.1-flash` |
| 生视频模型 | `agnes-video-2.5-flash`（当前默认，免费，最高 720P）<br>`agnes-video-v2.0`（旧模型，出 1080p，需账号分组支持） |

> ⚠️ **2026-10 实测**：中国站分组里 `agnes-video-v2.0` 可能不可用，直接报
> `model_not_found：当前分组不支持模型 agnes-video-v2.0`。所以本项目**默认用 2.5-flash**，
> 两套协议都支持（`agnes_client.mjs` 按模型名自动切换）。

> 本项目**不包含**国际站（`apihub.agnes-ai.com`）与双站并行调度。想加国际站请自行扩展
> `scripts/agnes_client.mjs`：国际站必须走代理，且参数风格不同。

## 两套视频协议

### A. 新协议（`agnes-video-2.5-flash` / 任何 2.5 系列）

```
POST /v1/videos
{
  "model": "agnes-video-2.5-flash",
  "prompt": "肩膀缓慢下沉，慢推，不改变外观",
  "seconds": "5",            // 4~12 秒
  "mode": "reference",       // 中国站单图参考帧用 reference + images
  "size": "720P",            // 最高 720P
  "aspect_ratio": "16:9",
  "n": 1,
  "images": ["https://…png"]
}
→ { "video_id": "…" }
```

查询要带模型名：`GET /agnesapi?video_id=<id>&model_name=agnes-video-2.5-flash`

### B. 旧协议（`agnes-video-v2.0`，出 1080p）

```
POST /v1/videos
{ "model": "agnes-video-v2.0", "prompt": "…",
  "width": 1920, "height": 1080, "num_frames": 121, "frame_rate": 24,
  "image": "https://…png" }
```

`num_frames` 必须是 **8n+1**；1080p 上限 241 帧（265 会报 400）。输出实际 **1920×1088**。

> 开箱默认走 A；想用 1080p 就 `--model agnes-video-v2.0 --frames 121`（前提是你的分组能用）。

## 端点

### 生图

```
POST /v1/images/generations
{
  "model": "agnes-image-2.1-flash",
  "prompt": "…",
  "size": "1312x736",
  "extra_body": { "response_format": "url" }
}
→ { "data": [ { "url": "https://…png" } ] }
```

### 图生视频

```
POST /v1/videos
{
  "model": "agnes-video-v2.0",
  "prompt": "手指缓慢收紧，慢推，不改变外观",
  "width": 1920, "height": 1080,
  "num_frames": 121, "frame_rate": 24,
  "image": "https://…png"
}
→ { "video_id": "…", "status": "queued" }
```

`image` 支持公网 http(s) URL，也接受 `data:image/png;base64,…`（本地图直传，不用图床）。
注意 Windows 命令行参数上限约 32KB，5MB 的 data URL 不能当命令行参数传，必须在脚本内直接请求。

### 查询

```
GET /agnesapi?video_id=<id>
→ { "status": "completed|failed|processing", "metadata": { "url": "https://…mp4" } }
```

完成后**视频地址在顶层 `url` / `metadata.url`**，不在 `data.url`。轮询间隔建议 10s。

## 分辨率实测（这就是为什么别乱填尺寸）

| 请求 | 实际输出 | 说明 |
|---|---|---|
| 生图 1920×1080 | **1312×736** | 16:9 模型上限，请求更大也只会给这个 |
| 生图 1024×1024 | 1024×1024 | 方图不压缩 |
| 生图 768×1344 | 736×1312 | 竖屏按档位对齐 |
| 视频 1920×1080 | **1920×1088** | 基于 1312×736 的图也能放大成真 1080p |

**正确姿势**：生图 1312×736 → 图生视频 1920×1080 → 输出 1920×1088，成片即 1080p。

## 帧数规则（只对旧模型 v2.0 有意义）

`num_frames` 必须是 **8n+1**，否则 400：

| 帧数 | 时长（24fps） | 用途 |
|---|---|---|
| 65 | ≈2.7s | 短句 |
| 121 | ≈5s | **默认** |
| 241 | ≈10s | 长句（1080p 上限） |

1080p/16:9 传 265 会报 `num_frames 265 exceeds maximum 241`。

2.5 系列没有帧数概念，用 `seconds`（4~12）控制时长。

## 限速（硬约束，不能靠并发绕过）

| 资源 | 限制 |
|---|---|
| 视频生成 | default 账号**有效 1 次/分钟**（`allows 1 requests per 1 minute(s)`） |
| 视频状态查询 | 也有独立限流（`video status query rate limit exceeded`）→ 轮询 10s |
| 生图 | 1K/2K 档约 20/10 RPM，可连续跑 |
| 视频队列 | 高峰会返回 `503 video_queue_full`（不是限速，是服务端排队满）→ 等 30s 重试 |

正确做法：

- 相邻两次**视频提交**间隔 ≥65s（`batch_generate.mjs` 的 `--interval`）
- 429 时读 `Retry-After`，没有就等 70s 再试
- 503 `video_queue_full` 时等 30s 重试（客户端已内置 12 轮）
- 多篇文案的视频任务**串行排队**，不要并行

## 网络

- 中国站偶发 `fetch failed`，必须重试（本项目默认 6 次 × 4s）
- 输出下载域名 `cos-platform-outputs.agnes-ai.cn` 可直连
- `api.agnes-ai.com` 是**网页域名**，不是 API 地址（POST 会返回 `000201 Resource not found`）
