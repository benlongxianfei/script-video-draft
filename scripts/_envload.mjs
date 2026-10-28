/**
 * 零依赖 .env 加载器（供 Node 脚本共用）
 *
 * 为什么需要：README 让人 `cp .env.example .env` 填 key，但脚本只读 process.env，
 * 配完 .env 直接跑会报 key 未设置 —— 新人必卡。
 *
 * 约定：
 * - 只读仓库根目录的 `.env`（与本文件同级的上一级）
 * - **已存在的环境变量优先**：shell 里 export 的不会被 .env 覆盖
 * - 支持 KEY=value / KEY="value" / KEY='value' / 行首 export KEY=value
 * - 忽略空行与 # 注释；不处理多行值
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export function loadDotenv() {
  const envPath = path.join(HERE, "..", ".env");
  if (!fs.existsSync(envPath)) return;

  const text = fs.readFileSync(envPath, "utf-8");
  for (let line of text.split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    if (line.startsWith("export ")) line = line.slice(7).trimStart();

    const eq = line.indexOf("=");
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && value[0] === value[value.length - 1] && (value[0] === '"' || value[0] === "'")) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}
