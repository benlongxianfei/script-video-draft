# -*- coding: utf-8 -*-
"""零依赖 .env 加载器（不引入 python-dotenv）

为什么需要：README 让人 `cp .env.example .env` 填 key，但脚本只读进程环境变量，
配完 .env 直接跑会报「AGNES_API_KEY_CN not set」—— 新人必卡。

约定：
- 只读仓库根目录的 `.env`（与 .env.example 同级）
- **已存在的环境变量优先**：shell 里 export 的不会被 .env 覆盖
- 支持 `KEY=value`、`KEY="value"`、`KEY='value'`、行首 `export KEY=value`
- 忽略空行与 `#` 注释；不处理多行值（.env 里不需要）
"""
import os
from pathlib import Path


def load_dotenv() -> None:
    """读取仓库根目录 .env 并写入 os.environ（不覆盖已有值）。不存在则静默返回。"""
    env_path = Path(__file__).resolve().parent.parent / ".env"
    if not env_path.is_file():
        return

    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()

        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]
        if key:
            os.environ.setdefault(key, value)
