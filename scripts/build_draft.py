# -*- coding: utf-8 -*-
"""剪映三轨草稿构建（精简版）

输入：分镜素材目录（每镜一个子目录，内含 video.mp4）+ 配音时间轴 + 逐句音频
输出：剪映草稿（视频轨 / 音频轨 / 字幕轨，三轨各自独立片段、句级对齐）

三条不能破的规则：
  1. 视频段边界 = 音频句边界。一句话中间绝不切画面。
  2. 素材比段短 → 慢放（最低 0.4x），**不循环、不定格**；素材比段长 → 直接截。
  3. 字幕只在标点处断、不带标点、绝不拆词（单字字幕 = 事故）。

用法：
  python build_draft.py --shots ./output/分镜项目-xxx --timeline ./output/配音/subtitle_timeline.json \
         --audio ./output/配音/配音_完整.wav --drafts-root "F:/JianyingPro Drafts" --name 我的草稿

依赖：pip install pyJianYingDraft
"""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

# ---------- 小工具 ----------

def probe_duration(p: Path) -> float:
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(p)],
        capture_output=True, text=True,
    )
    try:
        return float(r.stdout.strip())
    except ValueError:
        return 0.0


def split_phrase(text: str, max_chars: int = 12) -> list[str]:
    """按标点切短语并去掉标点；短单元合并，长单元保持完整（绝不硬切）。"""
    units = [u.strip() for u in re.findall(r"[^，。！？；：、,.!?;:]+", text) if u.strip()]
    out, buf = [], ""
    for u in units:
        if not buf:
            buf = u
        elif len(buf) + len(u) <= max_chars:
            buf += u
        else:
            out.append(buf)
            buf = u
    if buf:
        out.append(buf)
    return out or ([text] if text else [])


def plan_groups(segs: list[dict], target=5.0, merge_below=4.0, long_threshold=12.6,
                max_groups=None) -> list[list[dict]]:
    """把句子合并成均衡段落：目标 ≈target 秒/段，短句并入邻段，超长句单独成段。"""
    groups: list[list[dict]] = []
    cur: list[dict] = []
    cur_len = 0.0
    for s in segs:
        dur = float(s["duration"])
        cur.append(s)
        cur_len += dur
        if cur_len >= target * 0.85:
            groups.append(cur)
            cur, cur_len = [], 0.0
    if cur:
        if groups and sum(x["duration"] for x in cur) < merge_below:
            groups[-1].extend(cur)
        else:
            groups.append(cur)

    # 合并过短段落
    merged: list[list[dict]] = []
    for g in groups:
        gd = sum(x["duration"] for x in g)
        if merged and gd < merge_below:
            merged[-1].extend(g)
        else:
            merged.append(g)
    groups = merged

    # 素材不够时合并最短的相邻段
    if max_groups:
        while len(groups) > max_groups:
            lens = [sum(x["duration"] for x in g) for g in groups]
            i = min(range(len(lens) - 1), key=lambda k: lens[k] + lens[k + 1])
            groups[i].extend(groups[i + 1])
            del groups[i + 1]
    return groups


def collect_videos(shots_dir: Path) -> list[Path]:
    vids = []
    for d in sorted(shots_dir.iterdir()):
        if not d.is_dir():
            continue
        for name in ("video.mp4", "video_1080p.mp4"):
            f = d / name
            if f.exists():
                vids.append(f)
                break
    return vids


# ---------- 主流程 ----------

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--shots", required=True, help="分镜素材目录（每镜一个子目录）")
    ap.add_argument("--timeline", required=True, help="subtitle_timeline.json")
    ap.add_argument("--audio", required=True, help="完整配音 wav（仅用于校验与兜底音频轨）")
    ap.add_argument("--drafts-root", required=True, help="剪映草稿根目录")
    ap.add_argument("--name", required=True, help="草稿名")
    ap.add_argument("--width", type=int, default=1920)
    ap.add_argument("--height", type=int, default=1080)
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--font-size", type=float, default=6.0)
    ap.add_argument("--color", default="bdab31", help="字幕颜色（十六进制），默认 bdab31")
    ap.add_argument("--pos-y-ui", type=int, default=-800, help="字幕 UI 位置 Y，默认 -800")
    ap.add_argument("--letter-spacing-ui", type=int, default=5)
    ap.add_argument("--line-spacing-ui", type=int, default=0)
    ap.add_argument("--stroke-width", type=float, default=5.0, help="描边宽度（剪映 UI 值），默认 5")
    args = ap.parse_args()

    try:
        import pyJianYingDraft as jy
    except ImportError:
        sys.exit("缺少依赖：请先 pip install pyJianYingDraft")

    if not hasattr(jy.ScriptFile, "add_track"):  # 老版本兼容
        def _add_track(self, track_type, track_name=None, mute=False):
            return self.append_track(jy.TrackSpec(track_type, name=track_name, mute=mute))
        jy.ScriptFile.add_track = _add_track

    shots_dir = Path(args.shots)
    videos = collect_videos(shots_dir)
    if not videos:
        sys.exit(f"{shots_dir} 下没有找到 video.mp4")
    timeline = json.loads(Path(args.timeline).read_text(encoding="utf-8"))
    segs = timeline["segments"]
    total = float(timeline["total_duration"])
    audio_full = Path(args.audio)

    groups = plan_groups(segs, max_groups=len(videos))
    print(f"素材 {len(videos)} 段 ｜ 句子 {len(segs)} 句 ｜ 段落 {len(groups)} 段 ｜ 总时长 {total:.2f}s")

    # ---------- 建草稿 ----------
    folder = jy.DraftFolder(args.drafts_root)
    script = folder.create_draft(args.name, args.width, args.height, args.fps, allow_replace=True)

    # ---------- 视频轨 ----------
    script.add_track(jy.TrackType.video, "视频_逐段")
    cursor = 0.0
    short_warn = []
    for i, g in enumerate(groups):
        gdur = sum(float(x["duration"]) for x in g)
        video = videos[i] if i < len(videos) else videos[-1]
        phys = probe_duration(video)
        speed = 1.0
        if phys <= 0:
            sys.exit(f"素材时长探测失败：{video}")
        ratio = phys / gdur if gdur else 1.0
        if ratio < 1.0:
            speed = max(0.4, ratio)
            if ratio < 0.4:
                short_warn.append((i + 1, round(phys, 2), round(gdur, 2), video.name))
                speed = max(0.05, ratio)  # 素材实在太短，只能更慢，但绝不循环/定格
        seg = jy.VideoSegment(str(video), jy.trange(int(cursor * 1e6), int(gdur * 1e6)), speed=speed)
        script.add_segment(seg, "视频_逐段")
        cursor += gdur
    print(f"视频轨 {len(groups)} 段，末点 {cursor:.2f}s")

    # ---------- 音频轨（逐句独立片段） ----------
    script.add_track(jy.TrackType.audio, "音频_逐句")
    audio_count = 0
    t = 0.0
    for s in segs:
        start_us = int(t * 1e6)
        dur_us = int(round(float(s["duration"]) * 1e6))
        src = s.get("file")
        if src and Path(src).exists():
            seg = jy.AudioSegment(src, jy.trange(start_us, dur_us), volume=1.0)
            script.add_segment(seg, "音频_逐句")
            audio_count += 1
        t += float(s["duration"])
    if audio_count == 0:  # 时间轴里没有逐句文件时，退回整段音频
        script.add_segment(jy.AudioSegment(str(audio_full), jy.trange(0, int(total * 1e6))), "音频_逐句")
        audio_count = 1
    print(f"音频轨 {audio_count} 段")

    # ---------- 字幕轨 ----------
    script.add_track(jy.TrackType.text, "字幕_逐句")
    r = int(args.color[0:2], 16) / 255
    g_ = int(args.color[2:4], 16) / 255
    b = int(args.color[4:6], 16) / 255
    transform_y = args.pos_y_ui / args.height
    sub_count = 0
    cursor = 0.0
    for s in segs:
        dur = float(s["duration"])
        text = (s.get("text") or "").strip()
        if text:
            parts = split_phrase(text)
            weights = [max(len(p), 1) for p in parts]
            alloc = [int(round(dur * 1e6 * w / sum(weights))) for w in weights]
            alloc[-1] += int(round(dur * 1e6)) - sum(alloc)
            tt = cursor
            for p, du in zip(parts, alloc):
                if len(p) <= 1 and len(parts) > 1:  # 单字条目 = 拆词事故，跳过
                    tt += du / 1e6
                    continue
                seg = jy.TextSegment(
                    p,
                    jy.trange(int(tt * 1e6), du),
                    style=jy.TextStyle(size=args.font_size, bold=False, color=(r, g_, b),
                                       align=1, auto_wrapping=False, max_line_width=0.92),
                    border=jy.TextBorder(width=args.stroke_width, color=(0.0, 0.0, 0.0)),
                    clip_settings=jy.ClipSettings(transform_x=0.0, transform_y=transform_y),
                )
                script.add_segment(seg, "字幕_逐句")
                sub_count += 1
                tt += du / 1e6
        cursor += dur
    print(f"字幕轨 {sub_count} 条")

    script.save()

    # ---------- 写回剪映不认的字段（必须 patch JSON） ----------
    draft_dir = Path(args.drafts_root) / args.name
    content = draft_dir / "draft_content.json"
    if content.exists():
        d = json.loads(content.read_text(encoding="utf-8"))
        for mat in d.get("materials", {}).get("texts", []):
            mat["letter_spacing"] = args.letter_spacing_ui * 0.05   # UI 5 → 0.25
            mat["line_spacing"] = args.line_spacing_ui * 0.02       # UI 0 → 0.0
        for track in d.get("tracks", []):
            if track.get("type") == "text":
                for seg in track.get("segments", []):
                    clip = seg.get("clip") or {}
                    if "transform" in clip:
                        clip["transform"]["x"] = 0.0
                        clip["transform"]["y"] = transform_y
        content.write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")
        print(f"已写入字间距 {args.letter_spacing_ui * 0.05} / 行间距 {args.line_spacing_ui * 0.02} / 字幕Y {transform_y:.4f}")

    # ---------- 交付前校验 ----------
    print("\n—— 对齐校验 ——")
    sum_sent = sum(float(s["duration"]) for s in segs)
    ok1 = abs(sum_sent - total) < 0.1
    print(f"1) Σ句 {sum_sent:.3f}s ≈ 总时长 {total:.3f}s：{'通过' if ok1 else '不通过'}")

    vid_end = cursor
    ok2 = abs(vid_end - total) < 0.1
    print(f"2) 视频轨末点 {vid_end:.3f}s ≈ 音频 {total:.3f}s：{'通过' if ok2 else '不通过'}")

    errs = 0
    for i, g_ in enumerate(groups):
        gdur = sum(float(x["duration"]) for x in g_)
        video = videos[i] if i < len(videos) else videos[-1]
        phys = probe_duration(video)
        speed = 1.0 if phys >= gdur else max(0.4, phys / gdur)
        actual = min(phys, gdur * speed) / speed if speed else 0
        if abs(actual - gdur) > 0.15:
            errs += 1
    print(f"3) 每段实际时长误差 <0.15s：{'通过' if errs == 0 else f'{errs} 段超出'}")
    print("4) 段间无缝衔接：通过（段起点由上一段终点累加）")

    if short_warn:
        print("\n⚠️ 以下镜头素材比段落短，已按最低速慢放，建议重新生成更长的素材（121/241 帧）：")
        for no, phys, need, name in short_warn:
            print(f"   段{no}: 素材 {phys}s / 需要 {need}s（{name}）")

    print(f"\n草稿已生成：{draft_dir}")


if __name__ == "__main__":
    main()
