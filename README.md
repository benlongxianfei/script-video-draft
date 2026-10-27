# Agnes 口播视频流水线（精简开源版）

> **一篇中文文案进，一个可继续精修的剪映三轨工程出。**
> 分镜 → Agnes 生图 → 图生视频 → 豆包配音 → 剪映草稿。只用 Agnes 中国站，只用豆包语音。

![skill](https://img.shields.io/badge/type-agent--skill-black)
![tts](https://img.shields.io/badge/TTS-豆包%20%2F%20火山引擎-blue)
![image](https://img.shields.io/badge/image%2Fvideo-Agnes%20中国站-green)
![license](https://img.shields.io/badge/license-MIT-lightgrey)

---

## 它解决什么问题

做口播短视频最耗时的不是写文案，而是：**分镜、配音对轨、字幕卡点、画面不重复**。
这个技能把这些"剪辑师的隐性判断"写成了一份 AI 可执行的操作手册 + 一组能直接跑的脚本：

- 40 字切一镜，产出结构化分镜包（生图卡 + 图生视频卡）
- 调 Agnes 批量出图、图生视频，**断点续传**、遵守限速
- 逐句 TTS，**用每句真实发音时长**当字幕时间轴（不靠语音识别猜）
- 组装成剪映工程：视频轨 / 音频轨 / 字幕轨**全是独立片段**，句级对齐，打开就能逐段改

交付物是**剪辑工程**，不是黑盒 mp4。

## 五条不妥协的规则（这才是它的价值）

| # | 规则 | 为什么 |
|---|---|---|
| 1 | 视频段边界 = 音频句边界 | 一句话中间切画面，观众会觉得"跳戏" |
| 2 | 素材不够就慢放（≥0.4x），禁循环、禁定格 | 循环=画面重复；定格是"假视频" |
| 3 | 字幕只在标点处断、不带标点、绝不拆词 | "独属于自己的人生"不能被切成"的人"+"生" |
| 4 | 三轨都是独立片段 | 只有独立片段，剪辑师才能逐段替换 |
| 5 | 段→素材显式映射 + 唯一性校验 | 按比例自动分配会让相邻两段撞同一画面 |

## 快速开始

### 1) 依赖

```bash
node -v      # 需 18+
python -V    # 需 3.10+
ffmpeg -version && ffprobe -version
pip install pyJianYingDraft
```

### 2) 配置密钥

```bash
cp .env.example .env        # 填 Agnes 中国站 key + 火山引擎语音 key
cp config.example.json config.json   # 填剪映草稿目录等
```

| 变量 | 用途 | 从哪拿 |
|---|---|---|
| `AGNES_API_KEY_CN` | 生图 / 图生视频 | Agnes 控制台（中国站） |
| `VOLC_VOICE_APP_ID` | 豆包配音 | 火山引擎语音合成控制台 |
| `VOLC_VOICE_ACCESS_TOKEN` | 豆包配音 | 同上 |
| `DOUBAO_SPEAKER`（可选） | 音色 ID | 控制台里的音色，默认预置音色 |
| `DOUBAO_RESOURCE_ID`（可选） | 资源 ID，必须与音色匹配 | 预置音色 `seed-tts-2.0`；克隆音色 `seed-icl-2.0` |

### 3) 跑起来

```bash
# ① 分镜包：让 AI 按 SKILL.md 生成，或参考 examples/storyboard-package.example.md 手写

# ② 出素材（限速 1 次/分钟，25 镜约 85 分钟，放后台）
node scripts/batch_generate.mjs --package examples/storyboard-package.example.md --out ./output/demo

# ③ 配音（逐句合成 + 去静音 + 时间轴）
python scripts/tts_doubao.py --text examples/script.example.md --out ./output/demo/配音

# ④ 剪映三轨草稿
python scripts/build_draft.py \
  --shots ./output/demo \
  --timeline ./output/demo/配音/subtitle_timeline.json \
  --audio ./output/demo/配音/配音_完整.wav \
  --drafts-root "F:/JianyingPro Drafts" --name demo_三轨
```

装进 Agent（Claude Code / WorkBuddy 等）：

```bash
cp -r . ~/.claude/skills/agnes-bw-video-lite     # 或 ~/.workbuddy/skills/
```

然后直接说：**"这篇文案做成视频，出剪映草稿"**。

## 接口

### 脚本

| 脚本 | 作用 | 关键参数 |
|---|---|---|
| `scripts/agnes_client.mjs` | Agnes 中国站最小客户端 | `image` / `video` / `query` 三个子命令；`--model` 自动切换新旧协议 |
| `scripts/batch_generate.mjs` | 分镜包 → 逐镜生图 + 图生视频 | `--package --out --seconds --frames --model --interval --only --dry-run` |
| `scripts/tts_doubao.py` | 豆包逐句配音 + 时间轴 | `--text --out --limit --speed` |
| `scripts/build_draft.py` | 剪映三轨草稿 + 四道校验 | `--shots --timeline --audio --drafts-root --name` |

### 文件契约

| 文件 | 结构 |
|---|---|
| 分镜包 md | `## G. 每镜头生图卡`（`### 镜头N` + `正向提示词：`）+ `## H. 每镜头图生视频卡`（`动作设计 / 镜头运动 / 动作强度 / 严格禁止`），两段镜头数必须相等 |
| `subtitle_timeline.json` | `{"total_duration": 123.5, "segments": [{"text","file","duration"}]}` |
| `分镜项目/00N-镜头N/` | `image.png` + `video.mp4` + `image-result.json` + `video-result.json` |

### 第三方 API（中国站，2026-10 核实）

| 项 | 值 |
|---|---|
| Base URL | `https://api.agnes-ai.cn`（直连，无需代理） |
| 生图（免费） | `POST /v1/images/generations`，模型 **`agnes-image-2.5-flash`**；`size: 2K` + `ratio: 16:9` → **2624×1472** |
| 生视频（免费） | `POST /v1/videos`，模型 **`agnes-video-2.5-flash`**：`seconds 4~12` + `size 720P` + `aspect_ratio 16:9` + `mode reference` + `images[]` |
| 生视频（付费） | `agnes-video-2.5`（720P $0.025/s、1080P/1K $0.040/s、2K $0.055/s）→ 免费 key 会 403 `insufficient_user_quota` |
| 生视频（旧模型） | `agnes-video-v2.0`：`width/height/num_frames`，1080p 输出 **1920×1088**／帧数须 `8n+1`（65/121/241）——**当前分组多已下架** |
| 查询 | `GET /agnesapi?video_id=…`（2.5 系列要带 `&model_name=`），轮询 10s |
| 豆包 TTS | `POST https://openspeech.bytedance.com/api/v3/tts/unidirectional`，返回 base64 音频帧 |

**为什么是这两个模型**：`/v1/models` 里图片最高版本是 `agnes-image-2.5-flash`（2.0/2.1/2.5 三档输出全免费），
视频最高免费版本是 `agnes-video-2.5-flash`（2.5 标准版按秒计费，免费额度跑不动）。实测证据见 `docs/agnes-api-cn.md`。

### 免费档 RPM（官网公告，2026-09-23 文本下调 50% 后）

| 模态 | 规格 | 允许 | **实际生效** | 脚本对应间隔 |
|---|---|---|---|---|
| 图片 | 1K | 20 | **10** | 6s |
| 图片 | **2K（默认）** | 10 | **5** | **12s** |
| 图片 | 3K / 4K | 2 / 1 | **1 / 1** | 60s |
| 视频 | — | 2 | **1** | **65s**（脚本默认） |
| 文本 | — | 30 | **10** | 6s |

- 限制池**按 key 类型共享**：多建几个免费 key 不会加额度
- 图片按**档位**限速（默认 2K 只有 5 RPM），脚本已按档位自动排间隔
- 视频 1 RPM：429 读 `Retry-After`；高峰 `503 video_queue_full` 等 30s
- 想提额：企业认证或 Token Plan（视频 6/5 RPM + 500 秒/天配额）

## 目录结构

```
├── SKILL.md                  技能正文（给 Agent 看的 SOP）
├── scripts/                  4 个可运行脚本
├── docs/
│   ├── agnes-api-cn.md       中国站协议与限速
│   ├── tts-doubao.md         豆包配音与停顿处理
│   ├── jianying-draft.md     剪映三轨字段与换算
│   ├── quality-check.md      防变形与抽帧验收
│   ├── style-packs.md        三套画风提示词骨架
│   └── pitfalls.md           踩坑速查
├── examples/                 示例文案与分镜包
├── THIRD_PARTY.md            第三方依赖 / 服务 / 商标说明
├── config.example.json
└── .env.example
```

## 常见问题

**要会写代码吗？** 不用写，但要会填配置（路径 / key / 音色）。

**一定要用 Agnes 吗？** 主链是 Agnes，但任何"文生图 + 图生视频"接口都能替换 —— 改 `agnes_client.mjs` 一个文件即可。

**要跑多久？** 视频免费档 1 次/分钟：25 镜约 85 分钟，16 镜约 55 分钟；生图 2K 档 5 RPM，25 张另加约 5 分钟。加并发只会撞 429。

**免费能出 1080P 吗？** 不能。免费视频模型 `agnes-video-2.5-flash` 最高 720P；1080P/2K 属付费 `agnes-video-2.5`（按秒计费）。

**能出更高清的画面吗？** 图片端可以先出 2K/4K 源图（免费），但成片分辨率取决于视频模型（免费档 720P）。想要 1080P 需付费模型。

**支持竖屏吗？** 支持。`--width 1080 --height 1920`，字幕位置按 `--pos-y-ui` 调。

**为什么不做口型同步？** 这是"口播 + 图文叙事"流水线；多角色对口型是另一条技术线。

**为什么视频一直报 503 队列已满？** 免费档视频跑的是**共享队列**，队列饱和时请求在"入队前"就被拒：
未创建任务、**不扣视频额度**、180ms 内返回。同一时刻生图是正常的。这是平台容量问题，不是你的 key 或参数。
对策：错峰（深夜/清晨）、延长重试（脚本默认 20 轮 ≈12 分钟，`AGNES_QUEUE_RETRY` 可调）、
缩短 `seconds`、或换模型池。详细诊断见 `docs/agnes-api-cn.md`。

**剪映版本兼容吗？** 只保证 `pyJianYingDraft` 能写出的草稿结构；剪映 6+ 对已保存草稿会加密，本项目不读取加密草稿。

## 合规与免责（请先读）

**性质**
- **非官方项目**。与 Agnes AI（Sapiens AI）、火山引擎/字节跳动（豆包、剪映、CapCut）无隶属、合作或背书关系；名称仅用于描述"兼容/可接入"的对象。商标归各自权利人所有。
- 剪映草稿格式由第三方库 [pyJianYingDraft](https://github.com/GuanYixuan/pyJianYingDraft)（Apache-2.0）实现；本项目**不修改、不反编译、不破解**剪映客户端，也不绕过任何付费功能。
- 详细依赖与商标说明见 [`THIRD_PARTY.md`](./THIRD_PARTY.md)。

**密钥与资产**
- **不内置任何 API Key / 账号 / Cookie**；请自备账号并遵守各平台服务条款与计费规则。
- 不打包字体、模型权重、素材、音色样本；只说明获取渠道。
- **不得**用本项目转售 API、代充额度、批量注册规避配额或绕过内容审核。

**价格与限速**
- 文中"免费 / $0 / RPM"为记录时的官方状态（2026-10），平台可随时调整，**以官方公告与账单为准**。

**内容合规（尤其重要）**
- 生成内容的合法性、真实性与版权由使用者负责；发布前请自查是否符合平台规则与当地法律。
- 若做**心理/情绪类内容**：不得冒充专业心理诊疗、不得给出医疗诊断或用药建议、不得制造焦虑或诱导自我伤害；出现相关风险时应引导求助专业机构。
- 使用**真人肖像 or 克隆音色**必须取得当事人书面授权；AI 生成内容请按平台要求添加标识。
- 本项目提供的是生产工具，不提供任何"规避审核"的能力。

**质量与责任**
- 生成模型有失败率，本项目不承诺一次成型；`docs/quality-check.md` 写的是"验收怎么做"，不是"保证不出错"。
- 软件按 MIT 许可"原样"提供，作者不对使用后果承担责任。

## License

MIT
