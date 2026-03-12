# infra-skills

基础设施规划技能集，提供存储系统容量和性能规划能力。技能根据用户的容量和性能需求，自动计算最优的硬件配置方案，包括服务器数量、纠删码方案、磁盘规格选择等。

## 关于本仓库

本仓库包含面向基础设施场景的 Claude 技能，专注于存储系统的容量和性能规划。每个技能都是独立的目录，包含 `SKILL.md` 定义文件和相关的计算脚本。

## 技能列表

- `./skills/xsky-xeos-planner`：XSKY XEOS 对象存储容量和性能规划

## 使用方式

### Claude Code

注册本仓库为 Claude Code 插件市场：

```
/plugin marketplace add wutz/infra-skills
```

然后安装技能集：

1. 选择 `Browse and install plugins`
2. 选择 `infra-skills`
3. 选择 `storage-skills`（或你想安装的技能集）
3. 选择 `Install now`

或直接安装：

```
/plugin install storage-skills@infra-skills
```

### 本地开发测试

```bash
claude --plugin-dir ./infra-skills
```

## 创建新技能

本项目遵循 [agentskills.io](https://agentskills.io/specification) 规范。每个技能是一个包含标准目录结构的独立目录：

```
skill-name/
├── SKILL.md              # 必需：技能定义和使用说明
├── README.md             # 推荐：技能概述和快速开始
├── scripts/              # 可选：可执行脚本
│   ├── main-script.js
│   └── test.js
├── evals/                # 推荐：评估测试
│   ├── evals.json       # 测试用例定义
│   ├── files/           # 测试输入文件
│   └── README.md        # 评估指南
└── references/           # 可选：参考文档
    └── SPECS.md
```

### SKILL.md 格式

使用 YAML frontmatter 定义元数据：

```yaml
---
name: my-skill-name
description: 技能功能描述，以及何时应该触发此技能
---

# 技能名称

[Claude 在此技能激活时遵循的指令]

## 工作流程
- 步骤 1
- 步骤 2

## 重要说明
- 说明 1
- 说明 2
```

frontmatter 必需字段：
- `name` — 唯一标识符（小写，用连字符分隔，1-64 字符）
- `description` — 技能功能的完整描述，包括触发条件（1-1024 字符）

可选字段：
- `license` — 许可证名称
- `compatibility` — 环境要求说明
- `metadata` — 自定义元数据（键值对）

### 评估测试

在 `evals/evals.json` 中定义测试用例：

```json
{
  "skill_name": "my-skill-name",
  "evals": [
    {
      "id": 1,
      "prompt": "用户会输入的真实提示词",
      "expected_output": "期望输出的描述",
      "files": []
    }
  ]
}
```

详细的评估指南请参考 [agentskills.io/skill-creation/evaluating-skills](https://agentskills.io/skill-creation/evaluating-skills)。

## 项目结构

```
infra-skills/
├── .claude-plugin/
│   └── plugin.json                    # 插件清单
├── skills/
│   └── xsky-xeos-planner/
│       ├── SKILL.md                   # 技能定义
│       ├── README.md                  # 技能说明
│       ├── scripts/                   # 可执行脚本
│       │   ├── xsky-xeos-planner.js  # 核心算法
│       │   └── test.js               # 单元测试
│       ├── evals/                     # 评估测试
│       │   ├── evals.json            # 测试用例
│       │   ├── files/                # 测试文件
│       │   └── README.md             # 评估指南
│       └── references/                # 参考文档
│           └── TECHNICAL_SPECS.md    # 技术规格
├── CHANGELOG.md
└── README.md
```

## 规范符合性

本项目遵循 [agentskills.io](https://agentskills.io) 规范：

- ✅ 标准目录结构（scripts/, references/, evals/）
- ✅ YAML frontmatter 格式的 SKILL.md
- ✅ 渐进式信息披露（metadata → instructions → resources）
- ✅ 结构化评估框架（evals.json）
- ✅ 参考文档分离（references/）

## 许可证

MIT
