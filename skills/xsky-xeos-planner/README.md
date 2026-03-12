# XSKY XEOS Planner Skill

XSKY XEOS 对象存储容量和性能规划工具。

## 目录结构

```
xsky-xeos-planner/
├── SKILL.md                        # Skill 定义和使用说明
├── README.md                       # 本文件
├── scripts/                        # 可执行脚本
│   ├── xsky-xeos-planner.js       # 核心规划算法
│   └── test.js                    # 单元测试
├── evals/                          # 评估测试
│   ├── evals.json                 # 测试用例定义
│   ├── files/                     # 测试输入文件（预留）
│   └── README.md                  # 评估指南
└── references/                     # 参考文档
    └── TECHNICAL_SPECS.md         # 技术规格详细说明
```

## 快速开始

### 作为 Skill 使用

在 Claude Code 中，当你提到 XSKY、XEOS、对象存储规划等关键词时，此 skill 会自动激活。

示例提示词：
```
我需要规划一个 XSKY XEOS 对象存储，容量需求是 500TiB，
上传带宽需要 2GB/s，帮我计算配置方案。
```

### 直接使用脚本

```bash
cd /Users/wutz/Projects/wutz/infra-skills/skills/xsky-xeos-planner

# 基础容量规划
node scripts/xsky-xeos-planner.js --capacity "500TiB" --json

# 包含性能需求
node scripts/xsky-xeos-planner.js \
  --capacity "500TiB" \
  --upload-bw "2GB/s" \
  --download-bw "4GB/s" \
  --json
```

### 运行测试

```bash
# 单元测试
node scripts/test.js

# 评估测试（需要 Claude Code）
# 参考 evals/README.md
```

## 功能特性

- ✅ 支持容量规划（TiB/PiB/TB/PB）
- ✅ 支持性能规划（带宽和 OPS）
- ✅ 自动选择最优纠删码方案（EC8+2/EC4+2）
- ✅ 智能选择磁盘规格（8TB-24TB）
- ✅ 单位自动转换和格式化
- ✅ 性能需求验证和警告

## 规范符合性

本 skill 遵循 [agentskills.io](https://agentskills.io/specification) 规范：

- ✅ 标准目录结构（scripts/, references/, evals/）
- ✅ YAML frontmatter 格式的 SKILL.md
- ✅ 渐进式信息披露（metadata → instructions → resources）
- ✅ 结构化评估框架（evals.json）
- ✅ 参考文档分离（references/）

## 开发和改进

### 添加新功能

1. 修改 `scripts/xsky-xeos-planner.js`
2. 在 `scripts/test.js` 中添加单元测试
3. 更新 `SKILL.md` 中的使用说明
4. 在 `evals/evals.json` 中添加评估用例

### 运行评估

参考 `evals/README.md` 了解如何运行完整的 skill 评估。

### 更新技术规格

如果 XSKY XEOS 的硬件规格或性能参数有更新，请同时更新：
- `scripts/xsky-xeos-planner.js` 中的 CONSTANTS
- `references/TECHNICAL_SPECS.md` 中的文档

## 许可证

MIT

## 免责声明

本工具仅供参考和辅助决策使用。实际部署方案请以 XSKY 官方产品文档和技术支持建议为准。
