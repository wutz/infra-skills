# 更新日志

本项目的所有重要变更都将记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

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

[1.0.0]: https://github.com/wutz/infra-skills/releases/tag/v1.0.0
