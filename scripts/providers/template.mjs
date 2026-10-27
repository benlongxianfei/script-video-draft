/**
 * 视频平台适配器模板 —— 换成可灵 / 即梦 / Runway / Vidu / 海螺 / 自建服务时，从这份开始改。
 *
 * 三步：
 *   1) 复制本文件为 scripts/providers/<你的平台>.mjs
 *   2) 把下面两处 `TODO` 换成目标平台的真实请求
 *   3) 用 `--provider <你的平台>` 或环境变量 PROVIDER=<你的平台> 跑起来
 *
 * 契约（只要满足这三条，整条流水线不用改）：
 *   image({ prompt, size, ratio, model, out })  →  { url, local_file? }
 *   video({ image, prompt, seconds, model, out }) →  { url, local_file? }
 *   out 传了就必须把文件下载到本地并填 local_file
 *
 * 注意：
 *   - 进度日志一律 console.error（stdout 只留结果 JSON，方便被其他脚本解析）
 *   - 失败就 throw Error，batch_generate 会记录并继续下一镜
 */
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

export const meta = {
  id: "template",                       // 与文件名一致
  label: "示例平台（未实现）",
  homepage: "https://example.com/docs",
  env: ["MY_PROVIDER_KEY"],             // 需要哪些环境变量
  docs: "docs/providers.md",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.error(...a);

export default function createProvider(userConfig = {}) {
  const base = (process.env.PROVIDER_BASE_URL || userConfig.baseUrl || "https://api.example.com").replace(/\/+$/, "");
  const key = (process.env.MY_PROVIDER_KEY || "").trim();

  if (!key) throw new Error(`${meta.id}: 缺少环境变量 ${meta.env.join(" / ")}`);

  const authHeaders = () => ({ Authorization: `Bearer ${key}`, "Content-Type": "application/json" });

  async function download(url, outPath) {
    await mkdir(path.dirname(path.resolve(outPath)), { recursive: true });
    const r = await fetch(url);
    if (!r.ok) throw new Error(`下载失败 HTTP ${r.status}`);
    await writeFile(outPath, Buffer.from(await r.arrayBuffer()));
    return outPath;
  }

  return {
    name: meta.id,

    async image({ prompt, size = "1024x1024", ratio, model, out } = {}) {
      if (!prompt) throw new Error("image: 缺少 prompt");

      // ---------- TODO 1：换成目标平台的生图请求 ----------
      const res = await fetch(`${base}/v1/images`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ model: model || "your-image-model", prompt, size }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = await res.json();
      // ---------- 把"平台返回里的图片地址"映射到这里 ----------
      const url = data?.data?.[0]?.url || data?.result?.url;
      if (!url) throw new Error("image: 返回里找不到图片 URL，请检查映射");

      const result = { url };
      if (out) result.local_file = await download(url, out);
      return result;
    },

    async video({ image, prompt, seconds = 5, model, out } = {}) {
      if (!image) throw new Error("video: 缺少参考图");
      if (!prompt) throw new Error("video: 缺少 prompt");

      // ---------- TODO 2：换成目标平台的"提交任务"请求 ----------
      const submit = await fetch(`${base}/v1/videos`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          model: model || "your-video-model",
          prompt,
          duration: seconds,
          image_url: image,          // 有些平台要公网 URL，有些支持 base64，按对方文档改
        }),
      });
      if (!submit.ok) throw new Error(`HTTP ${submit.status}: ${(await submit.text()).slice(0, 200)}`);
      const sj = await submit.json();
      const taskId = sj?.task_id || sj?.id || sj?.data?.task_id;
      if (!taskId) throw new Error("video: 提交后没有 task_id");
      log(`  已提交 ${taskId}，轮询中…`);

      // ---------- 轮询直到完成（各家字段名不同，改这里） ----------
      const started = Date.now();
      while (true) {
        await sleep(10000);
        const q = await fetch(`${base}/v1/videos/${taskId}`, { headers: authHeaders() });
        const j = await q.json();
        const status = String(j?.status || j?.data?.status || "").toLowerCase();

        if (["succeeded", "completed", "success"].includes(status)) {
          const url = j?.data?.url || j?.result?.video_url || j?.video_url;
          if (!url) throw new Error("video: 完成但没有视频地址，请检查映射");
          const result = { url, task_id: taskId };
          if (out) result.local_file = await download(url, out);
          return result;
        }
        if (["failed", "error", "cancelled"].includes(status)) {
          throw new Error(`video: 生成失败 ${JSON.stringify(j).slice(0, 200)}`);
        }
        if ((Date.now() - started) / 1000 > 900) throw new Error("video: 轮询超时");
      }
    },
  };
}
