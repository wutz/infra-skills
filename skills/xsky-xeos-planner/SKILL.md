---
name: xsky-xeos-planner
description: 规划 XSKY XEOS 对象存储的容量和性能。当用户提到 XSKY、XEOS、对象存储规划、容量规划、性能规划、存储容量计算、纠删码（EC8+2、EC4+2）、XEOS 硬件配置、存储性能评估时使用此 skill。即使用户没有明确说"规划"或"计算"，只要涉及 XEOS 存储容量或性能相关的问题都应该触发此 skill。
---

# XSKY XEOS 对象存储规划工具

帮助用户根据容量和性能需求，规划 XSKY XEOS 对象存储部署方案，计算所需服务器数量、选择合适的纠删码方案、确定最优磁盘配置。

## 工作流程

此 skill 使用 JavaScript 脚本 `scripts/xsky-xeos-planner.js` 进行核心计算，流程如下：

1. 收集用户需求（容量和性能）
2. 调用 `xsky-xeos-planner.js` 脚本进行计算
3. 解析并格式化输出结果

## 用户输入需求

### 1. 容量需求（必填）

询问用户的容量需求，支持十进制和二进制单位：
- **十进制单位**：TB、PB（1000 进制）
- **二进制单位**：TiB、PiB（1024 进制）—— **推荐使用**

始终向用户推荐使用二进制单位（TiB、PiB），因为它们与实际存储计算更匹配。

### 2. 性能需求（可选）

询问用户是否有性能需求，针对 4MB 大小对象的操作：
- **上传带宽**：例如 100 MB/s、1 GB/s、100 MiB/s、1 GiB/s
- **下载带宽**：例如 200 MB/s、2 GB/s、200 MiB/s、2 GiB/s
- **上传 OPS**：例如 1000 IOPS（针对 4K 对象）
- **下载 OPS**：例如 3000 IOPS（针对 4K 对象）

带宽单位支持十进制（MB/s、GB/s）和二进制（MiB/s、GiB/s）。如果用户未提供性能需求，输出时优先使用十进制单位。

## 使用方法

### 步骤 1：收集用户需求

询问用户以下信息：
1. **容量需求**（必填）：例如 "500TB"、"1.5PiB"
2. **性能需求**（可选）：
   - 上传带宽：例如 "1GB/s"、"100MiB/s"
   - 下载带宽：例如 "2GB/s"、"200MiB/s"
   - 上传 OPS：例如 "50000"
   - 下载 OPS：例如 "150000"

### 步骤 2：调用计算脚本

使用 Bash 工具调用 `scripts/xsky-xeos-planner.js` 脚本：

```bash
cd /Users/wutz/Projects/wutz/infra-skills/skills/xsky-xeos-planner
node scripts/xsky-xeos-planner.js --capacity "500TiB" [--upload-bw "1GB/s"] [--download-bw "2GB/s"] [--upload-ops "50000"] [--download-ops "150000"] --json
```

参数说明：
- `--capacity`：容量需求（必填）
- `--upload-bw`：上传带宽需求（可选）
- `--download-bw`：下载带宽需求（可选）
- `--upload-ops`：上传 OPS 需求（可选）
- `--download-ops`：下载 OPS 需求（可选）
- `--json`：以 JSON 格式输出结果

### 步骤 3：解析并展示结果

脚本会返回 JSON 格式的结果，包含：
- `configuration`：配置方案（服务器台数、纠删码方案、磁盘配置）
- `capacity`：可用容量
- `performance`：性能指标（上传/下载带宽和 OPS）
- `performanceStatus`：性能状态
- `warning`：警告信息（如果有）

将结果以清晰、结构化的格式展示给用户。

## 输出格式示例

```
=== XSKY XEOS 对象存储规划方案 ===

配置方案:
  服务器台数: 3 台
  纠删码方案: EC4+2

每台服务器配置:
  处理器: 2 颗 Intel Xeon 4134
  内存: 8 根 32GB DDR4
  系统盘: 2 块 960GB SATA SSD 做 RAID1
  索引缓存盘: 4 块 1.6TB NVMe SSD（读写均衡型，>= 3 DWPD)
  网卡: 2 块双口 25Gb 以太网卡
  数据盘: 32 × 12TB HDD

容量:
  可用容量: 565.50 TiB

性能:
  上传带宽: 2.95 GB/s
  下载带宽: 5.90 GB/s
  上传 OPS: 9,600 IOPS
  下载 OPS: 28,800 IOPS

性能状态: 所有性能指标满足需求
```

## 重要说明

- 脚本支持 8TB、10TB、12TB、16TB、18TB、20TB、22TB、24TB 等多种 HDD 规格
- 脚本会根据容量需求智能选择最优的磁盘规格，使配置更接近实际需求
- 脚本会自动选择最优的纠删码方案（EC8+2 或 EC4+2）
- 输出单位与用户输入单位保持一致（二进制或十进制）
- 如果性能需求较高，脚本会自动选择更小的磁盘以增加服务器数量
- EC8+2 需要至少 5 台服务器，EC4+2 需要至少 3 台服务器
- 如果无法满足性能需求，脚本会返回警告信息

## 参考文档

详细的技术规格和计算公式请参考：[references/TECHNICAL_SPECS.md](references/TECHNICAL_SPECS.md)
