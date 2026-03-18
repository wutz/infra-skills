---
name: gpfs-ece-planner
description: 规划 GPFS ECE 高性能文件存储的容量和性能。当用户提到 GPFS、ECE、Spectrum Scale、高性能文件系统、NVMe 存储规划、GPFS 容量计算、纠删码（EC8+2P、EC8+3P、EC4+2P）、GPFS 硬件配置、RoCE、InfiniBand 时使用此 skill。即使用户没有明确说"规划"或"计算"，只要涉及 GPFS ECE 存储容量或性能相关的问题都应该触发此 skill。
---

# GPFS ECE 高性能文件存储规划工具

帮助用户根据容量和性能需求，规划 GPFS ECE (Erasure Coding Edition) 高性能 NVMe 文件存储部署方案，计算所需服务器数量、选择合适的纠删码方案、确定最优 NVMe SSD 配置。

## 工作流程

此 skill 使用 JavaScript 脚本 `scripts/gpfs-ece-planner.js` 进行核心计算，流程如下：

1. 收集用户需求（容量、性能、网络类型、容错级别）
2. 调用 `gpfs-ece-planner.js` 脚本进行计算
3. 解析并格式化输出结果

## 用户输入需求

### 1. 容量需求（必填）

询问用户的容量需求，支持十进制和二进制单位：
- **十进制单位**：TB、PB（1000 进制）
- **二进制单位**：TiB、PiB（1024 进制）—— **推荐使用**

始终向用户推荐使用二进制单位（TiB、PiB），因为它们与实际存储计算更匹配。

### 2. 性能需求（可选）

询问用户是否有性能需求：
- **读带宽**：例如 100 GB/s、50 GiB/s
- **写带宽**：例如 50 GB/s、25 GiB/s
- **读 IOPS**：例如 1000000
- **写 IOPS**：例如 500000

带宽单位支持十进制（MB/s、GB/s）和二进制（MiB/s、GiB/s）。如果用户未提供性能需求，输出时优先使用十进制单位。

### 3. 网络类型（可选）

- **RoCE**（默认）：800Gb RDMA over Converged Ethernet
- **InfiniBand**：800Gb InfiniBand
- **Ethernet**：以太网（性能降至 30%，固定乘数不随带宽变化）

### 4. 网络带宽（可选）

默认 800Gb（2 块双口 200Gb NIC）。用户可指定实际网络总带宽（如 400Gb）。

性能影响规则：
- **RoCE/IB**：仅 BW（带宽）按比例缩放，IOPS 不受影响
- **以太网**：所有性能指标统一使用 0.3 乘数，不受带宽参数影响

### 5. 容错级别（可选）

- **ft=1**（默认）：容忍 1 台服务器离线
- **ft=2**：容忍 2 台服务器离线（至少 10 台）
- **ft=3**：容忍 3 台服务器离线（至少 11 台，强制 EC8+3P）

## 使用方法

### 步骤 1：收集用户需求

询问用户以下信息：
1. **容量需求**（必填）：例如 "500TiB"、"1.5PiB"
2. **性能需求**（可选）：
   - 读带宽：例如 "100GB/s"、"50GiB/s"
   - 写带宽：例如 "50GB/s"、"25GiB/s"
   - 读 IOPS：例如 "1000000"
   - 写 IOPS：例如 "500000"
3. **网络类型**（可选）：roce、ib 或 ethernet
4. **网络带宽**（可选）：总带宽 Gb 值，如 400、800（默认 800）
5. **容错级别**（可选）：1、2 或 3

### 步骤 2：调用计算脚本

使用 Bash 工具调用 `scripts/gpfs-ece-planner.js` 脚本：

```bash
cd /Users/wutz/Projects/wutz/infra-skills/skills/gpfs-ece-planner
node scripts/gpfs-ece-planner.js --capacity "500TiB" [--read-bw "100GB/s"] [--write-bw "50GB/s"] [--read-iops "1000000"] [--write-iops "500000"] [--network-type roce] [--network-bandwidth 800] [--fault-tolerance 1] --json
```

参数说明：
- `--capacity`：容量需求（必填）
- `--read-bw`：读带宽需求（可选）
- `--write-bw`：写带宽需求（可选）
- `--read-iops`：读 IOPS 需求（可选）
- `--write-iops`：写 IOPS 需求（可选）
- `--network-type`：网络类型（可选，默认 roce）
- `--network-bandwidth`：网络总带宽 Gb（可选，默认 800）
- `--fault-tolerance`：容错级别（可选，默认 1）
- `--json`：以 JSON 格式输出结果

### 步骤 3：解析并展示结果

脚本会返回 JSON 格式的结果，包含：
- `configuration`：配置方案（服务器台数、纠删码方案、磁盘配置）
- `capacity`：可用容量
- `performance`：性能指标（读/写带宽和 IOPS）
- `performanceStatus`：性能状态

将结果以清晰、结构化的格式展示给用户。

## 输出格式示例

```
=== GPFS ECE 高性能文件存储规划方案 ===

配置方案:
  服务器台数: 3 台
  纠删码方案: EC4+2P

每台服务器配置:
  处理器: 2 颗 Intel Xeon 6530
  内存: 16 根 32GB DDR5 4800（共 512GB）
  系统盘: 2 块 480GB SATA SSD 做 RAID1
  存储网络: 2 块双口 200Gb RoCE/IB NIC（共 800Gb）
  管理网络: 1 块双口 25Gb 以太网卡
  数据盘: 24 × 7.68TB NVMe SSD

容量:
  可用容量: 301.60 TiB

性能:
  读带宽: 152.34 GiB/s
  写带宽: 63.87 GiB/s
  读 IOPS: 675,000 IOPS
  写 IOPS: 675,000 IOPS

性能状态: 所有性能指标满足需求
```

## 重要说明

- 脚本支持 1.92TB、3.84TB、7.68TB、15.36TB 等 NVMe SSD 规格
- EC 方案由服务器台数自动确定：3台→EC4+2P、4台→EC8+3P、5+台→EC8+2P
- 每节点读带宽随节点数增加而递减（非线性），写带宽固定
- 输出单位与用户输入单位保持一致（二进制或十进制）
- 以太网性能为 RoCE/IB 的 30%（固定乘数，不随带宽变化）
- RoCE/IB 下非标准带宽仅影响 BW，不影响 IOPS
- ft=2 至少需要 10 台服务器，ft=3 至少需要 11 台

## 参考文档

详细的技术规格和计算公式请参考：[references/TECHNICAL_SPECS.md](references/TECHNICAL_SPECS.md)
