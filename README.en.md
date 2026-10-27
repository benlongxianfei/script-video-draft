# Script2JianYing — Script → JianYing 3-track draft

> **One Chinese script in, one editable JianYing (CapCut CN) 3-track project out.**
> Storyboard → AI image/video generation → Doubao TTS → JianYing draft.
> **The video/image provider is pluggable** (ships with an Agnes adapter).

`agent-skill` · `ai-video` · `jianying` · `capcut` · `tts` · `storyboard`

## Why this exists

Editing a short voice-over video is not hard because of the writing — it's the **storyboard, the
audio/subtitle sync, and keeping shots from repeating**. This skill encodes a human editor's
judgment as rules + runnable scripts:

- 40 Chinese characters ≈ 1 shot; emits a machine-parsable storyboard package
- Batch image + image-to-video on **any** provider, **resumable**, rate-limit aware
- Sentence-level TTS; the **real per-sentence duration** becomes the subtitle timeline
- Assembles a JianYing project where video / audio / subtitle tracks are all **independent segments**,
  aligned per sentence, ready to tweak by hand

The deliverable is an **editing project**, not a black-box mp4.

## Five non-negotiable rules

1. Video segment boundaries = audio sentence boundaries. Never cut inside a sentence.
2. If a clip is shorter than its segment, **slow it down (min 0.4x)** — never loop, never freeze.
3. Subtitles break only at punctuation, without punctuation, **never inside a word**.
4. All three tracks use independent segments (that's what makes them editable).
5. Segment→material mapping is explicit, with a uniqueness assertion (no proportional mapping).

## Quick start

```bash
node -v && python -V && ffmpeg -version
pip install pyJianYingDraft
cp .env.example .env && cp config.example.json config.json   # fill keys + drafts folder

node   scripts/batch_generate.mjs --package examples/storyboard-package.example.md --out ./output/demo
python scripts/tts_doubao.py --text examples/script.example.md --out ./output/demo/tts
python scripts/build_draft.py --shots ./output/demo \
       --timeline ./output/demo/tts/subtitle_timeline.json \
       --audio ./output/demo/tts/配音_完整.wav \
       --drafts-root "F:/JianyingPro Drafts" --name demo_3tracks
```

Install as an agent skill:

```bash
cp -r . ~/.claude/skills/script2jianying      # or ~/.workbuddy/skills/
```

Then just say: *"turn this script into a video with a JianYing draft"*.

## API facts (measured on the CN endpoint, 2026-10)

| Item | Value |
|---|---|
| Base URL | `https://api.agnes-ai.cn` (direct, no proxy) |
| Image (free) | `POST /v1/images/generations`, **`agnes-image-2.5-flash`**; `size: 2K` + `ratio: 16:9` → **2624×1472** |
| Video (free) | `POST /v1/videos`, **`agnes-video-2.5-flash`**: `seconds 4–12`, `size 720P`, `mode reference`, `images[]` |
| Video (paid) | `agnes-video-2.5` (720P $0.025/s, 1080P $0.040/s) — free keys get `403 insufficient_user_quota` |
| Video (legacy) | `agnes-video-v2.0`: `num_frames` must be `8n+1`, 1080p → 1920×1088 — mostly delisted now |
| Poll | `GET /agnesapi?video_id=…` (+`&model_name=` for 2.5) every 10s |
| Doubao TTS | `POST https://openspeech.bytedance.com/api/v3/tts/unidirectional` |

**Free-tier RPM** (official Token Plan FAQ; text cut by 50% on 2026-09-23):
image 1K **10**, 2K **5**, 3K **1**, 4K **1**; video **1** (allowed 2); text **10**.
Limit pools are shared per key *type* — creating more free keys does not raise them.
`503 video_queue_full` means the server queue is full (not a rate limit) → retry after 30s.

## Structure

```
SKILL.md                 agent-facing SOP (rules, flow, checklist)
scripts/
  provider.mjs           provider entry (image / video / ls)
  providers/             agnes.mjs (default) + template.mjs (add your own)
  batch_generate.mjs     storyboard → per-shot image + video (resume, 65s throttle)
  tts_doubao.py          sentence-level TTS + silence trim + timeline
  build_draft.py         JianYing 3-track draft + 4 alignment checks
docs/                    API notes, TTS notes, draft fields, QA, style packs, pitfalls
examples/                sample script + storyboard package
```

## FAQ

- **Do I need to code?** No, but you must fill in paths/keys/voice ID.
- **Must I use Agnes?** No. Copy `scripts/providers/template.mjs` into `providers/<your-platform>.mjs`, then `--provider <id>`. Nothing else changes. See `docs/providers.md`.
- **How long?** Hard limit 1 video request/min: ~55 min for 16 shots, ~85 min for 25 shots.
- **Portrait?** Yes: `--width 1080 --height 1920` and adjust `--pos-y-ui`.

## Disclaimer

Unofficial project. Agnes, Doubao, JianYing/CapCut are trademarks of their respective owners.
No keys included — bring your own accounts and follow each platform's terms. Generated content
compliance and copyright are the user's responsibility. JianYing 6+ encrypts saved drafts; this
project does not read encrypted drafts.

## License

MIT
