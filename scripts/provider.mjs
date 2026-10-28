#!/usr/bin/env node
/**
 * 平台适配器 CLI（唯一入口）—— 上游只管"要一张图/一段视频"，不关心背后是哪家平台。
 *
 * 用法：
 *   node scripts/provider.mjs image --prompt "…" [--size 2K] [--ratio 16:9] [--out 路径.png]
 *   node scripts/provider.mjs video --image <URL或本地文件> --prompt "…" [--seconds 5] [--out 路径.mp4]
 *   node scripts/provider.mjs ls                 列出已装适配器
 *
 * 选平台（优先级从高到低）：
 *   --provider <id>  →  环境变量 PROVIDER  →  config.json 的 "provider"  →  默认 agnes
 *
 * 加新平台：复制 scripts/providers/template.mjs → 改名 → 改两处请求 → 就能用 --provider 切过去。
 */
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadDotenv } from "./_envload.mjs";

loadDotenv(); // 读取仓库根目录 .env（存在才加载；不覆盖已 export 的变量）

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROVIDER_DIR = path.join(HERE, "providers");

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

async function listProviders() {
  const files = (await readdir(PROVIDER_DIR)).filter((f) => f.endsWith(".mjs"));
  for (const f of files) {
    const id = f.replace(/\.mjs$/, "");
    try {
      const mod = await import(pathToFileURL(path.join(PROVIDER_DIR, f)).href);
      const m = mod.meta || {};
      console.log(`${id.padEnd(12)} ${m.label || ""}  ${m.env ? "env: " + m.env.join(",") : ""}`);
    } catch (e) {
      console.log(`${id.padEnd(12)} (加载失败：${e.message})`);
    }
  }
}

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];

if (cmd === "ls") {
  await listProviders();
  process.exit(0);
}
if (!["image", "video"].includes(cmd)) {
  console.error("用法：node scripts/provider.mjs <image|video|ls> [...]");
  process.exit(1);
}

// 解析 provider id
let providerId = args.provider || process.env.PROVIDER || "";
if (!providerId) {
  try {
    const { readFile } = await import("node:fs/promises");
    const cfg = JSON.parse(await readFile(path.join(process.cwd(), "config.json"), "utf-8"));
    providerId = cfg.provider || "";
  } catch {
    /* 没有 config.json 就用默认 */
  }
}
providerId = providerId || "agnes";

const file = path.join(PROVIDER_DIR, `${providerId}.mjs`);
let mod;
try {
  mod = await import(pathToFileURL(file).href);
} catch (e) {
  console.error(`找不到适配器 "${providerId}"（${file}）。可用：`);
  await listProviders();
  process.exit(1);
}

const provider = mod.default(args.providerConfig ? JSON.parse(args.providerConfig) : {});

try {
  const result =
    cmd === "image"
      ? await provider.image({
          prompt: args.prompt,
          size: args.size,
          ratio: args.ratio,
          model: args.model,
          out: args.out,
        })
      : await provider.video({
          image: args.image,
          prompt: args.prompt,
          seconds: args.seconds,
          model: args.model,
          out: args.out,
        });
  console.log(JSON.stringify({ ok: true, provider: providerId, type: cmd, ...result }, null, 2));
} catch (e) {
  console.error(String(e.message || e));
  process.exit(1);
}
