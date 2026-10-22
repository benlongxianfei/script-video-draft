#!/usr/bin/env node
/**
 * 分镜包 → 逐镜生图 + 图生视频（单站点版：只走 Agnes 中国站）
 *
 * 用法：
 *   node batch_generate.mjs --package examples/storyboard-package.example.md --out ./output/分镜项目-示例
 *        [--frames 121] [--image-size 1312x736] [--interval 65000] [--only 3,5] [--dry-run]
 *
 * 设计要点：
 *   - 断点续传：每镜完成即写 image-result.json / video-result.json，重跑只补缺的
 *   - 限速：相邻两次"视频提交"之间强制 ≥interval（默认 65s，中国站有效 1 次/分钟）
 *   - 汇总：结束时扫描磁盘重建 storyboard-package-results.json，避免内存与磁盘不一致
 */
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.join(HERE, "agnes_client.mjs");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exists = async (p) => { try { await access(p); return true; } catch { return false; } };

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const k = argv[i].slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
      out[k] = v;
    }
  }
  return out;
}

/** 解析分镜包 md：## G. 生图卡 / ## H. 图生视频卡 */
function parsePackage(md) {
  const lines = md.split(/\r?\n/);
  let section = null;
  const images = [];
  const videos = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (/^##\s*G[.、]/.test(line)) { section = "G"; continue; }
    if (/^##\s*H[.、]/.test(line)) { section = "H"; continue; }
    if (/^##\s/.test(line)) { section = null; continue; }

    const shot = line.match(/^###\s*镜头\s*(\d+)/);
    if (shot) {
      const item = { shot: Number(shot[1]), fields: {}, lines: [] };
      (section === "G" ? images : videos).push(item);
      continue;
    }
    if (!section) continue;
    const bag = section === "G" ? images : videos;
    const cur = bag[bag.length - 1];
    if (!cur) continue;
    const kv = line.match(/^(正向提示词|负向提示词|动作设计|镜头运动|动作强度|严格禁止)\s*[:：]\s*(.*)$/);
    if (kv) cur.fields[kv[1]] = kv[2];
    else if (line) cur.lines.push(line);
  }

  for (const it of images) {
    if (!it.fields["正向提示词"]) it.fields["正向提示词"] = it.lines.join(" ").trim();
  }
  return { images, videos };
}

async function callClient(args) {
  const { stdout } = await execFileAsync(process.execPath, [CLIENT, ...args], {
    maxBuffer: 32 * 1024 * 1024,
    env: process.env,
  });
  const txt = stdout.trim();
  const start = txt.lastIndexOf("{");
  return JSON.parse(txt.slice(start));
}

function buildVideoPrompt(card) {
  if (!card) return "轻微自然动作，镜头缓慢推进，低动作幅度";
  const f = card.fields;
  return [f["动作设计"], f["镜头运动"], f["严格禁止"]].filter(Boolean).join("，") || "轻微自然动作，镜头缓慢推近";
}

const args = parseArgs(process.argv.slice(2));
if (!args.package) {
  console.error("用法：node batch_generate.mjs --package 分镜包.md --out 输出目录 [--frames 121] [--interval 65000]");
  process.exit(1);
}

const PACKAGE = path.resolve(args.package);
const OUT = path.resolve(args.out || "./output/storyboard-" + Date.now());
const FRAMES = args.frames || "121";
const SECONDS = args.seconds || "5";
const MODEL = args.model || "";
const IMAGE_SIZE = args["image-size"] || "1312x736";
const INTERVAL = Number(args.interval || 65000);
const ONLY = args.only ? new Set(args.only.split(",").map((s) => Number(s.trim()))) : null;
const DRY = args["dry-run"] === "true";

const md = await readFile(PACKAGE, "utf-8");
const { images, videos } = parsePackage(md);
if (images.length !== videos.length) {
  console.error(`分镜包不合法：生图卡 ${images.length} 个，视频卡 ${videos.length} 个，数量必须相等`);
  process.exit(1);
}
console.log(`分镜包：${images.length} 镜（生图卡 ${images.length} / 视频卡 ${videos.length}）`);
console.log(`输出目录：${OUT}`);
if (DRY) console.log("（dry-run：只解析，不调用 API）");

await mkdir(OUT, { recursive: true });
const t0 = Date.now();
let lastVideoAt = 0;
let done = 0;

for (let i = 0; i < images.length; i++) {
  const card = images[i];
  const shotNo = card.shot;
  if (ONLY && !ONLY.has(shotNo)) continue;

  const dir = path.join(OUT, `${String(shotNo).padStart(3, "0")}-镜头${shotNo}`);
  await mkdir(dir, { recursive: true });
  const imgPath = path.join(dir, "image.png");
  const vidPath = path.join(dir, "video.mp4");
  const imgResPath = path.join(dir, "image-result.json");
  const vidResPath = path.join(dir, "video-result.json");

  // ---- 生图 ----
  let imageUrl;
  if ((await exists(imgResPath)) && (await exists(imgPath))) {
    imageUrl = JSON.parse(await readFile(imgResPath, "utf-8")).url;
    console.log(`镜${shotNo} 生图跳过（已存在）`);
  } else {
    const prompt = card.fields["正向提示词"];
    if (!prompt) { console.error(`镜${shotNo} 缺正向提示词，跳过`); continue; }
    if (DRY) { console.log(`镜${shotNo} 生图（dry）：${prompt.slice(0, 40)}…`); continue; }
    const r = await callClient(["image", "--prompt", prompt, "--size", IMAGE_SIZE, "--out", imgPath]);
    imageUrl = r.url;
    await writeFile(imgResPath, JSON.stringify(r, null, 2), "utf-8");
    console.log(`镜${shotNo} 生图完成`);
  }

  // ---- 图生视频 ----
  if (await exists(vidResPath)) {
    console.log(`镜${shotNo} 视频跳过（已存在）`);
    done++;
    continue;
  }
  if (DRY) { console.log(`镜${shotNo} 视频（dry）：${buildVideoPrompt(videos[i])}`); continue; }

  const wait = INTERVAL - (Date.now() - lastVideoAt);
  if (lastVideoAt && wait > 0) {
    console.log(`  限速等待 ${Math.round(wait / 1000)}s …`);
    await sleep(wait);
  }
  const vp = buildVideoPrompt(videos[i]);
  lastVideoAt = Date.now();
  const vArgs = ["video", "--image", imageUrl, "--prompt", vp, "--frames", FRAMES, "--seconds", SECONDS, "--out", vidPath];
  if (MODEL) vArgs.push("--model", MODEL);
  const vr = await callClient(vArgs);
  await writeFile(vidResPath, JSON.stringify(vr, null, 2), "utf-8");
  done++;
  const mins = ((Date.now() - t0) / 60000).toFixed(1);
  console.log(`镜${shotNo} 视频完成（${done} 镜 / 已用 ${mins} 分钟）`);
}

// ---- 汇总（以磁盘为准）----
const results = [];
for (let i = 0; i < images.length; i++) {
  const shotNo = images[i].shot;
  const dir = path.join(OUT, `${String(shotNo).padStart(3, "0")}-镜头${shotNo}`);
  const rec = { shot: shotNo, dir };
  for (const [k, f] of [["image", "image-result.json"], ["video", "video-result.json"]]) {
    const p = path.join(dir, f);
    if (await exists(p)) {
      const j = JSON.parse(await readFile(p, "utf-8"));
      rec[k] = { url: j.url, local_file: j.local_file };
    }
  }
  results.push(rec);
}
await writeFile(path.join(OUT, "storyboard-package-results.json"), JSON.stringify({ package: PACKAGE, shots: results }, null, 2), "utf-8");

const missing = results.filter((r) => !r.video).map((r) => r.shot);
console.log(`\n完成：${results.filter((r) => r.video).length}/${images.length} 镜`);
if (missing.length) console.log(`未完成镜头：${missing.join(", ")}（重跑本脚本会自动续传）`);
