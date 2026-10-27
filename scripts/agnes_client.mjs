#!/usr/bin/env node
/**
 * Agnes 中国站最小客户端（零依赖，Node 18+ 内置 fetch）
 *
 * 子命令：
 *   image   --prompt "..." [--size 2K|1K|3K|4K|1312x736] [--ratio 16:9] [--out 路径.png] [--model ...]
 *   video   --image <图片URL或本地路径> --prompt "..." [--seconds 5] [--video-size 720P] [--out 路径.mp4]
 *   query   --video-id <id>
 *
 * 认证：环境变量 AGNES_API_KEY_CN（或 AGNES_API_KEY）
 * 站点：AGNES_BASE_URL，默认 https://api.agnes-ai.cn（中国站，直连）
 *
 * 当前免费模型（2026-10 核实，官网 pricing + /v1/models 双向确认）：
 *   生图  agnes-image-2.5-flash   —— 1K/2K/3K/4K 全部 $0
 *   生视频 agnes-video-2.5-flash  —— 720P，限时免费
 *   付费  agnes-video-2.5（720P $0.025/s、1080P $0.040/s、2K $0.055/s）免费 key 会 403 insufficient_user_quota
 *
 * 免费档 RPM（官网 Token Plan FAQ，实际生效值）：
 *   图片 1K 10 / 2K 5 / 3K 1 / 4K 1 ｜ 视频 1（允许 2，实际 1）
 *
 * 其它实测事实：
 *   - 生图档位写法 size=2K + ratio=16:9 → 2624x1472（1K 16:9 → 1312x736）
 *   - 视频 2.5 系列用 seconds(4~12) + size + aspect_ratio + mode=reference + images[]
 *   - 旧模型 agnes-video-v2.0 用 width/height/num_frames（8n+1），1080p 上限 241 帧
 *   - 高峰可能 503 video_queue_full（服务端排队满），等 30s 重试
 */
import { writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const BASE = (process.env.AGNES_BASE_URL || "https://api.agnes-ai.cn").replace(/\/+$/, "");
const KEY = (process.env.AGNES_API_KEY_CN || process.env.AGNES_API_KEY || "").trim();

const DEFAULTS = {
  // 免费档最高版本（2026-10 核实：agnes-image-2.5-flash / agnes-video-2.5-flash 为当前免费模型）
  imageModel: "agnes-image-2.5-flash",
  imageSize: "2K",          // 免费档位：1K / 2K / 3K / 4K，全部 $0；2K 16:9 = 2624x1472
  imageRatio: "16:9",
  // 中国站免费视频模型；付费的 agnes-video-2.5 需要账户余额（免费 key 会 403 insufficient_user_quota）
  videoModel: "agnes-video-2.5-flash",
  frames: 121,
  seconds: "5",
  videoSize: "720P",
  aspectRatio: "16:9",
  width: 1920,
  height: 1080,
  fps: 24,
  pollSec: 10,
  timeoutSec: 900,
  retries: 6,
};

/** 2.5 系列用新协议（seconds / size / aspect_ratio / images），v2.0 用老协议（width/height/num_frames/image） */
const isModernVideo = (model) => /2\.5|-flash/i.test(model) && !/v2\.0/i.test(model);

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
      out[k] = v;
    } else out._.push(a);
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function log(...a) {
  console.log(...a);
}

async function api(pathname, init = {}, tries = DEFAULTS.retries) {
  let last;
  let queueFullLeft = 12; // 视频队列满（503 video_queue_full）时多等几轮
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(`${BASE}${pathname}`, {
        ...init,
        headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
      });
      if (res.status === 429) {
        const ra = Number(res.headers.get("retry-after") || 70);
        log(`  429 限流，等待 ${ra}s 后重试（${i}/${tries}）`);
        await sleep(ra * 1000);
        continue;
      }
      if (res.status === 503) {
        const t = await res.text();
        if (/queue_full|队列已满/i.test(t) && queueFullLeft-- > 0) {
          log(`  视频队列已满（503），等 30s 再试（剩 ${queueFullLeft} 次）`);
          await sleep(30000);
          i--; // 不占用普通重试次数
          continue;
        }
        throw new Error(`HTTP 503: ${t.slice(0, 300)}`);
      }
      if (!res.ok) {
        const t = await res.text();
        if (/insufficient_user_quota|预扣费失败/.test(t)) {
          throw new Error(
            `该模型属付费模型，账户余额不足（免费额度不覆盖）。免费请改用 *-flash 模型（agnes-image-2.5-flash / agnes-video-2.5-flash）。原始返回：${t.slice(0, 200)}`,
          );
        }
        throw new Error(`HTTP ${res.status}: ${t.slice(0, 300)}`);
      }
      return await res.json();
    } catch (e) {
      last = e;
      if (i < tries) await sleep(4000);
    }
  }
  throw new Error(`Agnes 请求失败：${last?.message || last}`);
}

async function toPublicUrl(imageArg) {
  if (/^https?:\/\//i.test(imageArg)) return imageArg;
  if (/^data:image\//i.test(imageArg)) return imageArg;
  // 本地文件 → base64 data URL（Agnes 接受，无需图床）
  const buf = await readFile(imageArg);
  const ext = path.extname(imageArg).toLowerCase().replace(".", "") || "png";
  return `data:image/${ext === "jpg" ? "jpeg" : ext};base64,${buf.toString("base64")}`;
}

async function download(url, outPath) {
  await mkdir(path.dirname(path.resolve(outPath)), { recursive: true });
  for (let i = 1; i <= 5; i++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      await writeFile(outPath, Buffer.from(await r.arrayBuffer()));
      return outPath;
    } catch (e) {
      if (i === 5) throw e;
      await sleep(3000);
    }
  }
}

// ---------- image ----------
async function cmdImage(args) {
  const prompt = args.prompt;
  if (!prompt) throw new Error("缺少 --prompt");
  const size = args.size || DEFAULTS.imageSize;
  const body = {
    model: args.model || DEFAULTS.imageModel,
    prompt,
    size,
    extra_body: { response_format: "url" },
  };
  // 档位写法（1K/2K/3K/4K）必须配 ratio；具体像素写法（如 1312x736）不需要
  if (/^\d+K$/i.test(size)) body.ratio = args.ratio || DEFAULTS.imageRatio;
  const data = await api("/v1/images/generations", { method: "POST", body: JSON.stringify(body) });
  const url = data?.data?.[0]?.url;
  if (!url) throw new Error("返回里没有图片 URL");
  const result = { ok: true, type: "image", model: body.model, size, url };
  if (args.out) result.local_file = await download(url, args.out);
  log(JSON.stringify(result, null, 2));
  return result;
}

// ---------- video ----------
async function cmdVideo(args) {
  if (!args.image) throw new Error("缺少 --image（图片 URL 或本地文件）");
  if (!args.prompt) throw new Error("缺少 --prompt");
  const model = args.model || DEFAULTS.videoModel;
  const modern = isModernVideo(model);
  const image = await toPublicUrl(args.image);
  let body;
  let modelQuery = "";

  if (modern) {
    // 新协议：不指定像素尺寸，用档位 + 比例；时长用 seconds
    const seconds = String(
      args.seconds || Math.min(12, Math.max(4, Math.round(Number(args.frames || DEFAULTS.frames) / DEFAULTS.fps))),
    );
    body = {
      model,
      prompt: args.prompt,
      seconds,
      mode: "reference",        // 中国站单图参考帧用 reference + images，不要用 img2video 别名
      size: args["video-size"] || DEFAULTS.videoSize,
      aspect_ratio: args["aspect-ratio"] || DEFAULTS.aspectRatio,
      n: 1,
      images: [image],
    };
    modelQuery = `&model_name=${encodeURIComponent(model)}`;
  } else {
    const frames = Number(args.frames || DEFAULTS.frames);
    if ((frames - 1) % 8 !== 0) throw new Error(`--frames 必须是 8n+1（65 / 121 / 241），当前 ${frames}`);
    body = {
      model,
      prompt: args.prompt,
      width: Number(args.width || DEFAULTS.width),
      height: Number(args.height || DEFAULTS.height),
      num_frames: frames,
      frame_rate: Number(args.fps || DEFAULTS.fps),
      image,
    };
  }

  const sub = await api("/v1/videos", { method: "POST", body: JSON.stringify(body) });
  const id = sub?.video_id || sub?.task_id || sub?.id;
  if (!id) throw new Error(`提交后没有 video_id：${JSON.stringify(sub).slice(0, 200)}`);
  log(`  已提交 video_id=${id}（模型 ${model}），轮询中…`);

  const started = Date.now();
  while (true) {
    const q = await api(`/agnesapi?video_id=${encodeURIComponent(id)}${modelQuery}`, { method: "GET" }, 4);
    const status = q?.status || q?.data?.status;
    if (["completed", "failed", "error"].includes(String(status))) {
      const url = q?.metadata?.url || q?.url || q?.output_url || q?.data?.url;
      if (String(status) !== "completed" || !url) {
        throw new Error(`视频生成失败 status=${status} ${q?.error ? JSON.stringify(q.error) : ""}`);
      }
      const result = { ok: true, type: "video", model, video_id: id, url };
      if (args.out) result.local_file = await download(url, args.out);
      log(JSON.stringify(result, null, 2));
      return result;
    }
    if ((Date.now() - started) / 1000 > Number(args["timeout-sec"] || DEFAULTS.timeoutSec)) {
      throw new Error(`轮询超时 video_id=${id}`);
    }
    await sleep(Number(args["poll-sec"] || DEFAULTS.pollSec) * 1000);
  }
}

async function cmdQuery(args) {
  if (!args["video-id"]) throw new Error("缺少 --video-id");
  const q = await api(`/agnesapi?video_id=${encodeURIComponent(args["video-id"])}`, { method: "GET" });
  log(JSON.stringify(q, null, 2));
}

const [cmd, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);

if (!KEY) {
  console.error("缺少密钥：请设置环境变量 AGNES_API_KEY_CN（中国站 key）");
  process.exit(1);
}

const table = { image: cmdImage, video: cmdVideo, query: cmdQuery };
if (!table[cmd]) {
  console.error("用法：node agnes_client.mjs <image|video|query> [参数]\n示例：node agnes_client.mjs image --prompt \"黑白蚀刻版画，一个人独坐\" --out out/001.png");
  process.exit(1);
}
table[cmd](args).catch((e) => {
  console.error(String(e.message || e));
  process.exit(1);
});
