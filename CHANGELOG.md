# 更新日志

本项目的所有重要变更都将记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.1.0] - 2026-03-12

### 新增
- 按照 [agentskills.io](https://agentskills.io/specification) 规范重构项目结构
- 添加 `scripts/` 目录存放可执行脚本
- 添加 `evals/` 目录和 `evals.json` 测试用例定义
- 添加 `references/` 目录和技术规格文档
- 为每个目录添加 README 说明文档
- 创建 `evals/README.md` 评估指南
- 创建 `references/TECHNICAL_SPECS.md` 技术规格参考
- 创建 `skills/xsky-xeos-planner/README.md` 技能说明

### 变更
- 将 `xsky-xeos-planner.js` 移动到 `scripts/` 目录
- 将 `test.js` 移动到 `scripts/` 目录
- 更新 `SKILL.md` 中的脚本路径引用
- 更新项目根目录 README，添加规范符合性说明
- 改进创建新技能的文档说明

### 改进
- 采用渐进式信息披露结构（metadata → instructions → resources）
- 测试用例从单元测试扩展到完整的评估框架
- 技术文档从代码注释提取到独立的参考文档

## [1.0.0] - 2026-03-12

### 新增
- 初始插件结构，包含 `.claude-plugin/plugin.json`
- `xsky-xeos-planner` 技能，用于 XSKY XEOS 对象存储规划
- 支持容量规划（TB/TiB/PB/PiB 单位）
- 支持性能需求（带宽和 IOPS）
- 纠删码方案选择（EC8+2、EC4+2）
- 磁盘配置优化（8TB-24TB HDD）
- 包含 12 个测试用例的完整测试套件
- README 和文档

### 变更
- 从独立的 `.claude/` 结构迁移到插件格式
- 更新输出格式，添加固定服务器配置模板

[1.1.0]: https://github.com/wutz/infra-skills/releases/tag/v1.1.0
[1.0.0]: https://github.com/wutz/infra-skills/releases/tag/v1.0.0
