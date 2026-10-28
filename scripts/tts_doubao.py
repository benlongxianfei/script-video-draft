#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""豆包 TTS 逐句配音（火山引擎 openspeech v3 unidirectional）

做什么：
  文案 → 逐句合成 → 每句去首尾静音 + 补 60ms 尾停 → 拼成完整 wav → 输出字幕时间轴

为什么逐句：逐句合成本身就带"真实发音时长"，用它当字幕时间轴，不需要语音识别对齐。

为什么去静音：豆包每句 mp3 自带 80~250ms 句尾静音，逐句拼接后句间停顿 150~240ms，
听感会"拖沓"。压到 60ms（参考成片 40~80ms）就正常了 —— 这是**唯一**该用的"提速"手段，
不要去 atempo 变速。

用法：
  python tts_doubao.py --text 文案.md --out ./output/配音
  python tts_doubao.py --text 文案.md --out ./output/配音 --limit 3     # 只跑前三句试听

环境变量（必填）：
  VOLC_VOICE_APP_ID / VOLC_VOICE_ACCESS_TOKEN
可选：
  DOUBAO_SPEAKER（默认 zh_female_shuangkuaisisi_moon_bigtts，换成你自己的音色）
  DOUBAO_RESOURCE_ID（默认 seed-tts-2.0；克隆音色通常配 seed-icl-2.0，必须与音色匹配）
"""
import argparse
import base64
import json
import os
import re
import struct
import subprocess
import sys
import time
import uuid
from pathlib import Path
from urllib.request import Request, urlopen

from _envload import load_dotenv

load_dotenv()  # 读取仓库根目录 .env（存在才加载；不覆盖已 export 的变量）

ENDPOINT = "https://openspeech.bytedance.com/api/v3/tts/unidirectional"
# 火山引擎文档示例里公开的 app key；如你的账号要求自有 app key，用 DOUBAO_APP_KEY 覆盖
APP_KEY = os.environ.get("DOUBAO_APP_KEY", "aGjiRDfUWi").strip()
MAX_CHARS_PER_CALL = 500
TAIL_PAD = 0.06  # 句尾补 60ms


# ---------------- 文本切句 ----------------
def clean_script(text: str) -> str:
    """去掉 markdown 结构（标题/引用/代码块/分隔线），只留要念的正文。"""
    keep = []
    for line in text.splitlines():
        s = line.strip()
        if not s:
            continue
        if s.startswith(("#", ">", "```", "---", "***", "|")):
            continue
        s = re.sub(r"^[-*+]\s+", "", s)          # 列表符号
        s = re.sub(r"^\d+[.)]\s+", "", s)        # 有序列表
        s = re.sub(r"\*\*(.*?)\*\*", r"\1", s)   # 粗体
        keep.append(s)
    return "。".join(keep)


def split_sentences(text: str, min_len: int = 4) -> list[str]:
    """按句末标点切句；过短的句子并入相邻句，避免出现 1.4s 的碎句。"""
    text = clean_script(text)
    text = re.sub(r"[。]{2,}", "。", text)
    raw = [s.strip() for s in re.split(r"(?<=[。！？；!?;])", text) if s.strip()]
    merged: list[str] = []
    buf = ""
    for s in raw:
        buf += s
        if len(buf) >= min_len:
            merged.append(buf)
            buf = ""
    if buf:
        if merged:
            merged[-1] += buf
        else:
            merged.append(buf)

    out = []
    for s in merged:
        if len(s) <= MAX_CHARS_PER_CALL:
            out.append(s)
            continue
        # 超长句按逗号再切
        part = ""
        for piece in re.split(r"(?<=[，,、：:])", s):
            if len(part) + len(piece) > MAX_CHARS_PER_CALL and part:
                out.append(part)
                part = piece
            else:
                part += piece
        if part:
            out.append(part)
    return out


def strip_punct(s: str) -> str:
    return re.sub(r"[，。！？；：、,\.!\?;:\"'“”‘’（）()《》\[\]—…\s]", "", s)


# ---------------- 豆包合成 ----------------
def synth(text: str, out_mp3: Path, app_id: str, token: str, speaker: str, resource: str, speed: float) -> None:
    body = {
        "user": {"uid": "agnes-bw-video-lite"},
        "req_params": {
            "text": text,
            "speaker": speaker,
            "audio_params": {"format": "mp3", "sample_rate": 24000},
            "speed_ratio": speed,
            "volume_ratio": 1.0,
        },
    }
    req = Request(
        ENDPOINT,
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-Api-App-Id": app_id,
            "X-Api-Access-Key": token,
            "X-Api-Resource-Id": resource,
            "X-Api-Request-Id": str(uuid.uuid4()),
            "X-Api-App-Key": APP_KEY,
        },
    )
    with urlopen(req, timeout=120) as resp:
        raw = resp.read()
    audio = _decode_audio(raw)
    if len(audio) < 1000:
        raise RuntimeError("返回音频过短，可能合成失败")
    out_mp3.parent.mkdir(parents=True, exist_ok=True)
    out_mp3.write_bytes(audio)


def _decode_audio(raw: bytes) -> bytes:
    text = raw.decode("utf-8", errors="replace")
    if text.lstrip().startswith("{"):
        dec = json.JSONDecoder()
        pos, parts, parsed = 0, [], False
        while pos < len(text):
            while pos < len(text) and text[pos] in " \t\r\n":
                pos += 1
            if pos >= len(text) or text[pos] != "{":
                break
            obj, pos = dec.raw_decode(text, pos)
            parsed = True
            code = obj.get("code")
            if code not in (0, 20000000):
                raise RuntimeError(f"豆包错误 code={code}: {obj.get('message')}")
            data = obj.get("data")
            if isinstance(data, str) and data:
                parts.append(base64.b64decode(data))
        if not parsed:
            raise RuntimeError("无法解析豆包响应")
        return b"".join(parts)
    if raw.startswith((b"ID3", b"\xff\xfb", b"\xff\xf3")):
        return raw
    # 二进制协议帧：message type 0xB = 音频，0xF = 错误
    audio = bytearray()
    off = 0
    while off + 4 <= len(raw):
        header = raw[off:off + 4]
        header_size = (header[0] & 0x0F) * 4
        mtype = header[1] >> 4
        cursor = off + header_size
        if mtype == 0xB and cursor + 8 <= len(raw):
            size = struct.unpack(">I", raw[cursor + 4:cursor + 8])[0]
            cursor += 8
            audio.extend(raw[cursor:cursor + size])
            off = cursor + size
            continue
        if mtype == 0xF and cursor + 8 <= len(raw):
            code = struct.unpack(">I", raw[cursor:cursor + 4])[0]
            size = struct.unpack(">I", raw[cursor + 4:cursor + 8])[0]
            detail = raw[cursor + 8:cursor + 8 + size]
            raise RuntimeError(f"豆包错误 {code}: {detail.decode('utf-8', errors='replace')}")
        break
    return bytes(audio)


# ---------------- 音频处理 ----------------
def ffmpeg_bin(name: str) -> str:
    try:
        subprocess.run([name, "-version"], capture_output=True, check=True)
        return name
    except Exception:
        sys.exit(f"找不到可用的 {name}（需要完整版 ffmpeg，含 ffprobe）。请先安装并加入 PATH。")


def probe(path: Path) -> float:
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path)],
        capture_output=True, text=True,
    )
    try:
        return float(r.stdout.strip())
    except ValueError:
        return 0.0


def trim_and_pad(src: Path, dst: Path) -> None:
    af = (
        "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.02,"
        "areverse,"
        "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.02,"
        "areverse,"
        f"apad=pad_dur={TAIL_PAD}"
    )
    subprocess.run(
        ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(src),
         "-af", af, "-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le", str(dst)],
        check=True,
    )


def concat(files: list[Path], dst: Path) -> None:
    # 注意：concat 列表里的相对路径是相对「列表文件所在目录」解析的，必须写绝对路径
    lst = dst.parent / "concat_list.txt"
    lst.write_text("".join(f"file '{f.resolve().as_posix()}'\n" for f in files), encoding="utf-8")
    subprocess.run(
        ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
         "-f", "concat", "-safe", "0", "-i", str(lst), "-c:a", "pcm_s16le", str(dst)],
        check=True,
    )


# ---------------- 主流程 ----------------
def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--text", required=True, help="文案文件（txt/md）")
    ap.add_argument("--out", required=True, help="配音输出目录")
    ap.add_argument("--limit", type=int, default=0, help="只跑前 N 句（试听用）")
    ap.add_argument("--speed", type=float, default=1.0, help="语速（实测该参数影响很小，建议保持 1.0）")
    args = ap.parse_args()

    app_id = os.environ.get("VOLC_VOICE_APP_ID", "").strip()
    token = os.environ.get("VOLC_VOICE_ACCESS_TOKEN", "").strip()
    if not app_id or not token:
        sys.exit("缺少环境变量 VOLC_VOICE_APP_ID / VOLC_VOICE_ACCESS_TOKEN（火山引擎语音合成控制台获取）")

    speaker = os.environ.get("DOUBAO_SPEAKER", "zh_female_shuangkuaisisi_moon_bigtts").strip()
    resource = os.environ.get("DOUBAO_RESOURCE_ID", "seed-tts-2.0").strip()

    ffmpeg_bin("ffmpeg")
    ffmpeg_bin("ffprobe")

    text = Path(args.text).read_text(encoding="utf-8")
    sentences = split_sentences(text)
    if args.limit:
        sentences = sentences[: args.limit]
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"共 {len(sentences)} 句，输出到 {out_dir}")
    results = []
    for i, sent in enumerate(sentences, 1):
        mp3 = out_dir / f"seg_{i:03d}.mp3"
        wav = out_dir / f"seg_{i:03d}.wav"
        if wav.exists() and wav.stat().st_size > 1000:
            dur = probe(wav)
            results.append({"text": strip_punct(sent), "file": str(wav), "duration": dur})
            print(f"句{i:3d} 已有 {dur:.2f}s：{strip_punct(sent)[:22]}")
            continue
        print(f"句{i:3d} 合成：{strip_punct(sent)[:22]}")
        synth(sent, mp3, app_id, token, speaker, resource, args.speed)
        trim_and_pad(mp3, wav)
        dur = probe(wav)
        if dur <= 0:
            raise RuntimeError(f"句{i} 时长探测失败：{wav}")
        results.append({"text": strip_punct(sent), "file": str(wav), "duration": dur})
        time.sleep(0.5)

    full = out_dir / "配音_完整.wav"
    concat([Path(r["file"]) for r in results], full)
    total = probe(full)
    sum_d = sum(r["duration"] for r in results)

    timeline = {"title": f"豆包配音 {speaker}", "segments": results, "total_duration": total}
    (out_dir / "subtitle_timeline.json").write_text(
        json.dumps(timeline, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(f"\nΣ句 = {sum_d:.3f}s ｜ 完整 wav = {total:.3f}s ｜ 自洽 = {abs(sum_d - total) < 0.05}")
    chars = sum(len(r["text"]) for r in results)
    if total > 0:
        print(f"语速基准：{chars} 字 / {total:.2f}s = {chars / total:.2f} 字/秒")
    print(f"时间轴：{out_dir / 'subtitle_timeline.json'}")


if __name__ == "__main__":
    main()
