# 平台适配器：Agnes 只是其中一个选项

这条流水线**不绑定任何平台**。分镜、配音、三轨草稿都不关心画面从哪来；
唯一跟平台相关的是两个动作：**出一张图**、**把这张图变成一段视频**。

所以它们被抽成了 `scripts/providers/<平台>.mjs`。

```
batch_generate.mjs
      │  node scripts/provider.mjs image|video …
      ▼
scripts/provider.mjs          ← 选平台、转发参数、输出统一 JSON
      │  import
      ▼
scripts/providers/agnes.mjs   ← 唯一需要改的地方（每家一个文件）
scripts/providers/template.mjs
```

## 一、契约（满足这三条，全流水线不用改）

```js
export const meta = {
  id: "agnes",                  // 同文件名
  label: "Agnes AI（中国站）",
  env: ["AGNES_API_KEY_CN"],    // 需要哪些环境变量
  docs: "docs/provider-agnes.md",
};

export default function createProvider(userConfig = {}) {
  return {
    async image({ prompt, size, ratio, model, out }) { /* → { url, local_file? } */ },
    async video({ image, prompt, seconds, model, out }) { /* → { url, local_file? } */ },
  };
}
```

- `out` 传了就必须把文件下载下来并填 `local_file`
- 进度日志用 `console.error`；`stdout` 只留一行结果 JSON（上游要解析）
- 失败直接 `throw Error(...)`，批量脚本会记录并跳到下一镜

## 二、选平台的优先级

```
--provider <id>   >   环境变量 PROVIDER   >   config.json 的 "provider"   >   默认 agnes
```

```bash
node scripts/provider.mjs ls                       # 看装了哪些
node scripts/provider.mjs image --prompt "…" --provider agnes
PROVIDER=agnes node scripts/batch_generate.mjs --package 分镜包.md --out ./output/demo
```

## 三、换成别的平台：四步

以"可灵"为例（其他平台同理）：

1. **复制** `scripts/providers/template.mjs` → `scripts/providers/kling.mjs`，改 `meta.id = "kling"`、`meta.env = ["KLING_API_KEY"]`
2. **改两处请求**：`image()` 里的生图 POST、`video()` 里的提交/轮询（各家字段名不同，照对方文档抄）
3. **映射返回值**：把平台返回的图片/视频地址映射到 `{ url }`
4. **跑**：`PROVIDER=kling node scripts/batch_generate.mjs …`

> 平台差异只影响这 4 件事，其它都不变：支持的分辨率档位、时长单位（秒 or 帧）、任务查询方式（轮询 or 回调）、限速。

## 四、常见平台的字段对照（照这个改就行）

| 环节 | Agnes（已实现） | 可灵 / 即梦类 | Runway 类 | 注意 |
|---|---|---|---|---|
| 生图 | `POST /v1/images/generations`，`size: 2K` + `ratio` | 多为 `POST /images`，`width/height` 或 `aspect_ratio` | 多为 `POST /v1/text_to_image` | 尺寸写法三派：**档位**、**像素**、**比例** |
| 图生视频 | `POST /v1/videos`，`mode: reference` + `images[]` + `seconds` | `image` / `image_url` + `duration` | `promptImage` + `duration` | 单图起帧有的叫 reference、有的叫 first_frame |
| 查询 | `GET /agnesapi?video_id=…&model_name=…` | `GET /v1/videos/{task_id}` | `GET /v1/tasks/{id}` | 有的平台超 20 秒才查得到，要容忍 404 |
| 结果字段 | `metadata.url` / `url` | `data.url` / `video_url` | `output[0]` | 统统一映射到 `{ url }` |
| 时长单位 | 秒（4~12） | 秒（5/10） | 秒 | 旧模型是**帧数**（8n+1），别混 |
| 限速 | 视频 1 RPM | 各家不同（常见 1~3 并发） | 按点数 | 适配器里自己 sleep |

## 五、换平台后还要顺手改的（跟平台无关的部分）

| 项 | 在哪 | 为什么 |
|---|---|---|
| 画面比例 | `config.json` / `--image-ratio` | 平台支持的比例不同（有的没有 21:9） |
| 草稿画布 | `build_draft.py --width/--height` | 720P 素材就别用 1920×1080 画布，会放大变软 |
| 视频时长 | `--seconds` | 决定段落规划上限（长句要拆或换更长素材） |
| 限速 | `--interval` / `--image-interval` | 各家 RPM 不同，别直接套 Agnes 的 65s |

## 六、只做半条链也可以

- **只换生图**：在 `providers/xxx.mjs` 里让 `video()` 转调 Agnes（`import` 本目录的 agnes 适配器），或反过来 —— 混用两个平台完全允许
- **只出图不出视频**：`batch_generate.mjs` 会跳过没有 video 的镜头，后面用静态图 + 剪映自带关键帧也能出片（质量差一些）

## 七、为什么不把平台写进 SKILL.md

SKILL.md 写的是"怎么把文案变成三轨工程"的方法论，跟平台无关。
平台相关的参数（模型名、限速、尺寸档位）全部落在**适配器 + 文档**里，
这样平台改接口时只需要动一个文件，方法论不会跟着过时。
