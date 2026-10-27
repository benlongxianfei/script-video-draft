# 参与共建（CONTRIBUTING）

四种参与方式，按门槛从低到高：

| 方式 | 去哪 | 适合谁 |
|---|---|---|
| 报 bug / 提需求 | [Issues](https://github.com/benlongxianfei/script-video-draft/issues/new/choose)（有表单） | 所有人 |
| 聊用法 / 晒成片 / 求诊断 | [Discussions](https://github.com/benlongxianfei/script-video-draft/discussions) | 所有人 |
| 补文档 / 补示例 | 直接 PR | 用过一遍的人 |
| **加新平台适配器** | PR `scripts/providers/<平台>.mjs` | 会写一点 JS 的人 |

---

## 报 bug 的正确姿势

1. 先查 [`docs/pitfalls.md`](docs/pitfalls.md) 和 [`docs/provider-agnes.md`](docs/provider-agnes.md)（默认适配器的报错都在里面）
2. 用 issue 表单填：**版本 / 平台 / 卡在哪一步 / 完整日志 / 环境**
3. 日志请脱敏：`sk-xxxx` → `sk-abc123***`；本地路径可保留，但别贴带用户名的完整家目录

> 只说"跑不通"很难修。有日志的 issue 一般 1 天内能定位。

## 提 PR 的流程

```bash
git clone https://github.com/benlongxianfei/script-video-draft.git
cd script-video-draft
git checkout -b fix/你的改动
# 改完自测（见下）
git commit -m "fix: 修 xxx"
git push origin fix/你的改动
# 在 GitHub 上开 PR，按模板填
```

自测三条，PR 里打勾：

```bash
for f in scripts/*.mjs scripts/providers/*.mjs; do node --check "$f"; done
python -m py_compile scripts/*.py
node scripts/batch_generate.mjs --package examples/storyboard-package.example.md --out /tmp/x --dry-run
```

**一个 PR 只做一件事。** 顺手重构 + 顺手改文案 + 顺手升级依赖，会让 review 变得没法做。

## 新增平台适配器（最欢迎的贡献）

照着 [`scripts/providers/template.mjs`](scripts/providers/template.mjs) 抄，契约只有两个方法：

```js
image({ prompt, size, ratio, model, out })   → { url, local_file? }
video({ image, prompt, seconds, model, out }) → { url, local_file? }
```

硬性要求（不满足会打回）：

| # | 要求 | 为什么 |
|---|---|---|
| 1 | 只改 `providers/<平台>.mjs`，**不动上游脚本** | 别人的平台不能被你的平台带崩 |
| 2 | `meta` 写全：`id/label/env/docs` | `provider.mjs ls` 要能列出 |
| 3 | 进度日志用 `console.error`，**stdout 只输出结果 JSON** | 上游要解析 stdout |
| 4 | 失败直接 `throw Error(人话)` | 批量脚本靠它决定跳过还是中止 |
| 5 | Key 从环境变量读，**绝不写死** | 明文密钥会立刻泄露 |
| 6 | 限速在适配器内自己 sleep | 各家 RPM 不同，别套别人的 |

字段对照（时长单位、尺寸写法、查询方式）见 [`docs/providers.md`](docs/providers.md)。

## 不要提交这些

- ❌ API Key、`.env`、`config.json`（含个人路径）
- ❌ 生成的素材（视频/图片/音频）、剪映草稿
- ❌ 字体文件（只给下载链接）
- ❌ 从别人仓库整段拷来的代码（许可证冲突）
- ❌ 任何"绕过平台风控/去水印/规避审核"的代码

## 提交信息

`feat:` 新能力 ｜ `fix:` 修 bug ｜ `docs:` 文档 ｜ `refactor:` 重构 ｜ `chore:` 杂务

## 行为边界

- 讨论技术，不评价人
- 不在这里发广告、引流、代充/代注册
- 涉及未成年人与违法内容的需求一律拒绝
