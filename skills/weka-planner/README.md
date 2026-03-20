# Weka 高性能文件系统规划工具

根据容量和性能需求，自动计算 Weka 高性能文件系统的最优硬件配置方案。

## 功能特性

- 容量规划：根据需求计算所需节点数和 NVMe SSD 配置
- 性能规划：支持读/写带宽和 IOPS 需求
- 保护方案：自动选择合适的纠删码方案（EC 5+2、EC 8+2、EC 8+3、EC 8+4）
- 网络优化：支持 100Gb×2 和 200Gb×2 网络配置
- 成本优化：优先选择最小配置（最少节点 → 最少 NVMe → 最小 SSD）

## 硬件配置

### 固定配置
- **CPU**: Intel 5418Y
- **内存**: 32GB
- **NVMe SSD**: 4/8/12 块可选
- **SSD 容量**: 7.68TB 或 15.36TB
- **网络**: 100Gb×2 或 200Gb×2

### 最小配置
- **最少节点数**: 6 节点

## 快速开始

### 基本容量规划
```bash
node scripts/weka-planner.js --capacity "500TiB" --json
```

### 容量 + 性能规划
```bash
node scripts/weka-planner.js \
  --capacity "500TiB" \
  --read-bw "200GB/s" \
  --write-bw "50GB/s" \
  --network-type 200gb \
  --json
```

### 高可靠性配置
```bash
node scripts/weka-planner.js \
  --capacity "1PiB" \
  --protection-level 4 \
  --json
```

## 参数说明

- `--capacity`: 容量需求（必填），如 "500TiB"、"1.5PiB"
- `--read-bw`: 读带宽需求（可选），如 "200GB/s"
- `--write-bw`: 写带宽需求（可选），如 "50GB/s"
- `--read-iops`: 读 IOPS 需求（可选）
- `--write-iops`: 写 IOPS 需求（可选）
- `--network-type`: 网络类型（可选），100gb 或 200gb，默认 100gb
- `--protection-level`: 保护级别（可选），2/3/4，默认 2
- `--json`: 以 JSON 格式输出

## 测试

运行测试套件：
```bash
node scripts/test.js
```

## 技术文档

详细的技术规格和计算公式请参考：[references/TECHNICAL_SPECS.md](references/TECHNICAL_SPECS.md)

## 评估

评估用例定义在 [evals/evals.json](evals/evals.json)，包含 15 个测试场景。
