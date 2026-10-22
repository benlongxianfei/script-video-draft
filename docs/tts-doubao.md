# 豆包配音（火山引擎 openspeech v3）

## 接口

```
POST https://openspeech.bytedance.com/api/v3/tts/unidirectional

Headers:
  Content-Type: application/json
  X-Api-App-Id:      <VOLC_VOICE_APP_ID>
  X-Api-Access-Key:  <VOLC_VOICE_ACCESS_TOKEN>
  X-Api-Resource-Id: seed-tts-2.0   （预置音色） / seed-icl-2.0（克隆音色）
  X-Api-Request-Id:  <uuid>
  X-Api-App-Key:     aGjiRDfUWi     （火山引擎固定 app key）

Body:
{
  "user": { "uid": "anything" },
  "req_params": {
    "text": "这一句要念的话",
    "speaker": "zh_female_shuangkuaisisi_moon_bigtts",
    "audio_params": { "format": "mp3", "sample_rate": 24000 },
    "speed_ratio": 1.0,
    "volume_ratio": 1.0
  }
}
```

响应有三种形态，脚本都要兼容：

1. 多行 JSON，每行一个对象，`data` 字段是 base64 音频片段（最常见）→ 逐行解析后拼接
2. 纯 MP3 二进制（头部 `ID3` / `0xFFFB`）
3. 火山二进制协议帧：`message_type 0xB` 是音频块，`0xF` 是错误

成功码：`0` 或 `20000000`。音频 < 1000 字节视为失败。

## 为什么逐句合成

逐句合成**自带真实发音时长**，直接就是字幕时间轴 —— 不需要 whisper 对齐，也不会出现识别错字。
做法：一句话一次请求 → ffprobe 量时长 → 时间轴 start 依次累加。

## 停顿处理（关键）

豆包每句 mp3 自带 **80~250ms 句尾静音**。逐句拼接后，句间停顿 = 前句尾 + 后句首 = **150~240ms**，
听感会明显"拖沓"。参考成片里这个值通常只有 **40~80ms**。

标准处理（每句都做，不是补救措施）：

```bash
ffmpeg -i seg.mp3 -af "\
silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.02,\
areverse,\
silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.02,\
areverse,\
apad=pad_dur=0.06" \
  -ar 24000 -ac 1 -c:a pcm_s16le seg.wav
```

- 去首尾静音：-50dB 阈值，正反各做一遍（`areverse` 两次）
- 句尾统一补 **60ms**（对齐参考成片的 40~80ms 区间）
- 全部 trim 后再 concat，时间轴用 **trim 后**的真实时长

## 语速：不要动 atempo

- `speed_ratio` 参数实测**影响极小**（1.0→1.5 输出时长只差约 6%），调它基本没用
- 听感"慢"的真因通常是**句间停顿长**，按上面压缩停顿即可
- **不要对整段配音 atempo 变速**。一旦变速，时间轴要按比例整体缩放，很容易出现
  "第二次缩放基于已缩放的时间轴"→ Σ句 ≠ 总时长 → 全篇错位
- 如果确实要变速：每次都从**原始**时间轴算一次系数（新总时长/原始总时长），缩放后立刻校验 `Σ句 ≈ 总时长`

## 拆句规则

- 按 `。！？；` 切句，**过短的句子（<4 字）并入相邻句**，否则停顿总占比太高
- 单次请求 ≤500 字，超长句按逗号再切
- 字幕文本去掉全部标点；TTS 输入**保留**标点（影响停顿与语气）
- 字幕只在标点处断，**绝不拆词**："那一瞬间明明什么都没发生"必须整体一条

## 自检

```
Σ句 时长 ≈ 完整 wav 时长（容差 0.05s）
语速基准 = 全文真实字数 ÷ wav 总时长（正常中文口播约 5~6.5 字/秒）
```

如果某一句语速明显快于全文平均（>15%），多半是"没有逗号的超长句被读快了"，
可单独对这一句做轻微放慢后重拼 —— 这属于纠正单句朗读不均，不算破坏全局语速。
