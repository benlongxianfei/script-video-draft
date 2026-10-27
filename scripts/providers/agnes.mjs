/**
 * 视频平台适配器：Agnes AI（默认示例）
 *
 * 这是一个"provider"（平台适配器）实现，只负责两件事：
 *   image({ prompt, size, ratio, model, out })  →  { url, local_file? }
 *   video({ image, prompt, seconds, model, out }) →  { url, local_file? }
 * 其余（分镜、配音、草稿组装）都不关心你用哪个平台。
 *
 * 想换成可灵 / 即梦 / Runway / Vidu / 海螺 …… 复制本文件改两处即可：
 *   1) 把 HTTP 请求换成目标平台的写法
 *   2) 把返回结果里的 URL 字段映射到 { url }
 * 详见 docs/providers.md
 */
import { writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

export const meta = {
  id: "agnes",
  label: "Agnes AI（中国站）",
  homepage: "https://wiki.agnes-ai.com",
  env: ["AGNES_API_KEY_CN"],
  docs: "docs/provider-agnes.md",
};

const DEFAULTS = {
  baseUrl: "https://api.agnes-ai.cn",
  imageModel: "agnes-image-2.5-flash",
  imageSize: "2K",
  imageRatio: "16:9",
  videoModel: "agnes-video-2.5-flash",
  seconds: "5",
  videoSize: "720P",
  aspectRatio: "16:9",
  frames: 121,
  width: 1920,
  height: 1080,
  fps: 24,
  pollSec: 10,
  timeoutSec: 900,
  retries: 6,
  queueRetry: 20,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.error(...a); // 进度走 stderr，stdout 只留结果 JSON

const isModernVideo = (model) => /2\.5|-flash/i.test(model) && !/v2\.0/i.test(model);

export default function createProvider(userConfig = {}) {
  const cfg = { ...DEFAULTS, ...userConfig };
  const base = (process.env.PROVIDER_BASE_URL || cfg.baseUrl).replace(/\/+$/, "");
  const key = (process.env.AGNES_API_KEY_CN || process.env.AGNES_API_KEY || cfg.apiKey || "").trim();

  async function api(pathname, init = {}, tries = cfg.retries) {
    let last;
    let queueLeft = Number(process.env.PROVIDER_QUEUE_RETRY || cfg.queueRetry);
    const queueStart = Date.now();
    for (let i = 1; i <= tries; i++) {
      try {
        const res = await fetch(`${base}${pathname}`, {
          ...init,
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init.headers || {}) },
        });
        if (res.status === 429) {
          const ra = Number(res.headers.get("retry-after") || 70);
          log(`  429 限流，等待 ${ra}s 后重试`);
          await sleep(ra * 1000);
          continue;
        }
        if (res.status === 503) {
          const t = await res.text();
          if (/queue_full|队列已满|queue is full/i.test(t) && queueLeft-- > 0) {
            const waited = Math.round((Date.now() - queueStart) / 1000);
            const nap = waited < 300 ? 30 : 60;
            log(`  平台队列已满（503，未入队、不扣额度），等 ${nap}s 重试（剩 ${queueLeft} 轮，已等 ${waited}s）`);
            await sleep(nap * 1000);
            i--;
            continue;
          }
          throw new Error(`HTTP 503: ${t.slice(0, 300)}`);
        }
        if (!res.ok) {
          const t = await res.text();
          if (/insufficient_user_quota|预扣费失败/i.test(t)) {
            throw new Error(`该模型属付费模型，账户余额不足；免费请改用 *-flash 模型。原始返回：${t.slice(0, 200)}`);
          }
          throw new Error(`HTTP ${res.status}: ${t.slice(0, 300)}`);
        }
        return await res.json();
      } catch (e) {
        last = e;
        if (i < tries) await sleep(4000);
      }
    }
    throw new Error(`平台请求失败：${last?.message || last}`);
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

  async function toPublicUrl(image) {
    if (/^https?:\/\//i.test(image)) return image;
    if (/^data:image\//i.test(image)) return image;
    const buf = await readFile(image);
    const ext = path.extname(image).toLowerCase().replace(".", "") || "png";
    return `data:image/${ext === "jpg" ? "jpeg" : ext};base64,${buf.toString("base64")}`;
  }

  return {
    name: meta.id,

    async image({ prompt, size, ratio, model, out } = {}) {
      if (!prompt) throw new Error("image: 缺少 prompt");
      const tier = size || cfg.imageSize;
      const body = {
        model: model || cfg.imageModel,
        prompt,
        size: tier,
        extra_body: { response_format: "url" },
      };
      if (/^\d+K$/i.test(tier)) body.ratio = ratio || cfg.imageRatio;
      const data = await api("/v1/images/generations", { method: "POST", body: JSON.stringify(body) });
      const url = data?.data?.[0]?.url;
      if (!url) throw new Error("image: 返回里没有 URL");
      const result = { url, model: body.model, size: tier };
      if (out) result.local_file = await download(url, out);
      return result;
    },

    async video({ image, prompt, seconds, model, out } = {}) {
      if (!image) throw new Error("video: 缺少参考图");
      if (!prompt) throw new Error("video: 缺少 prompt");
      const mdl = model || cfg.videoModel;
      const modern = isModernVideo(mdl);
      const img = await toPublicUrl(image);
      let body;
      let modelQuery = "";

      if (modern) {
        const sec = String(seconds || cfg.seconds);
        body = {
          model: mdl,
          prompt,
          seconds: sec,
          mode: "reference",              // 单图起帧：中国站用 reference + images
          size: cfg.videoSize,
          aspect_ratio: cfg.aspectRatio,
          n: 1,
          images: [img],
        };
        modelQuery = `&model_name=${encodeURIComponent(mdl)}`;
      } else {
        const frames = Number(cfg.frames);
        if ((frames - 1) % 8 !== 0) throw new Error(`video: 旧模型帧数必须是 8n+1，当前 ${frames}`);
        body = {
          model: mdl,
          prompt,
          width: cfg.width,
          height: cfg.height,
          num_frames: frames,
          frame_rate: cfg.fps,
          image: img,
        };
      }

      const sub = await api("/v1/videos", { method: "POST", body: JSON.stringify(body) });
      const id = sub?.video_id || sub?.task_id || sub?.id;
      if (!id) throw new Error(`video: 提交后没有 video_id：${JSON.stringify(sub).slice(0, 200)}`);
      log(`  已提交 ${id}（${mdl}），轮询中…`);

      const started = Date.now();
      while (true) {
        const q = await api(`/agnesapi?video_id=${encodeURIComponent(id)}${modelQuery}`, { method: "GET" }, 4);
        const status = q?.status || q?.data?.status;
        if (["completed", "failed", "error"].includes(String(status))) {
          const url = q?.metadata?.url || q?.url || q?.output_url || q?.data?.url;
          if (String(status) !== "completed" || !url) {
            throw new Error(`video: 生成失败 status=${status} ${q?.error ? JSON.stringify(q.error) : ""}`);
          }
          const result = { url, video_id: id, model: mdl };
          if (out) result.local_file = await download(url, out);
          return result;
        }
        if ((Date.now() - started) / 1000 > cfg.timeoutSec) throw new Error(`video: 轮询超时 ${id}`);
        await sleep(cfg.pollSec * 1000);
      }
    },
  };
}
