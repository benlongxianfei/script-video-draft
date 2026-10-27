## 这个 PR 做了什么

<!-- 一句话说清。一个 PR 只做一件事，方便回滚。 -->

## 类型

- [ ] 修 bug
- [ ] 新平台适配器（`scripts/providers/xxx.mjs`）
- [ ] 文档 / 示例
- [ ] 重构（不改行为）
- [ ] 其它

## 影响面

- 影响文件：
- 会不会改变既有产物格式（`subtitle_timeline.json` / 分镜项目目录 / 草稿结构）：
  - [ ] 不会
  - [ ] 会（说明兼容方案）

## 自测清单

- [ ] `node --check scripts/*.mjs`、`python -m py_compile scripts/*.py` 通过
- [ ] `node scripts/batch_generate.mjs --package examples/storyboard-package.example.md --out /tmp/x --dry-run` 通过
- [ ] `node scripts/provider.mjs ls` 能列出适配器（若改了适配器）
- [ ] 改草稿逻辑时：四道对齐校验仍全过
- [ ] 没有提交任何 API Key / 素材 / 字体 / 个人路径

## 相关 issue

Closes #
