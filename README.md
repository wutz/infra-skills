# infra-skills

基础设施规划技能集，提供存储系统容量和性能规划能力。技能根据用户的容量和性能需求，自动计算最优的硬件配置方案，包括服务器数量、纠删码方案、磁盘规格选择等。

## 关于本仓库

本仓库包含面向基础设施场景的 Claude 技能，专注于存储系统的容量和性能规划。每个技能都是独立的目录，包含 `SKILL.md` 定义文件和相关的计算脚本。

### 声明

**这些技能仅供参考和辅助决策使用。** 实际部署方案请以官方产品文档和技术支持建议为准。在用于生产环境前，请充分验证计算结果。

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
3. 选择 `Install now`

或直接安装：

```
/plugin install infra-skills
```

### 本地开发测试

```bash
claude --plugin-dir ./infra-skills
```

## 创建新技能

技能结构很简单——一个包含 `SKILL.md` 文件的目录，使用 YAML frontmatter 定义元数据：

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

frontmatter 需要两个字段：
- `name` — 唯一标识符（小写，用连字符分隔）
- `description` — 技能功能的完整描述，包括触发条件

## 项目结构

```
infra-skills/
├── .claude-plugin/
│   └── plugin.json               # 插件清单
├── skills/
│   └── xsky-xeos-planner/
│       ├── SKILL.md              # 技能定义
│       ├── xsky-xeos-planner.js  # 核心算法
│       └── test.js               # 测试套件
├── CHANGELOG.md
└── README.md
```

## 许可证

MIT
