---
name: vastdata-planner
description: 规划 VastData 统一存储平台的容量和性能。VastData 是统一存储平台，同时支持文件系统（NFS/SMB）、对象存储（S3）和块存储（iSCSI/NVMe-oF）协议。当用户提到 VastData、VAST、EBox、CNode、DBox、全闪存储、NVMe 存储、高性能文件系统、对象存储、块存储、VAST Data、VastData 容量规划、VastData 性能规划时使用此 skill。即使用户没有明确说"规划"或"计算"，只要涉及 VastData 存储容量或性能相关的问题都应该触发此 skill。
---

# VastData 统一存储平台规划工具

帮助用户根据容量和性能需求，规划 VastData 统一存储平台部署方案。

## VastData 平台特性

VastData 是**统一存储平台**，单一系统同时支持：
- **文件存储**：NFS、SMB/CIFS、NFS over RDMA
- **对象存储**：S3 协议（原生 S3 API）
- **块存储**：iSCSI、NVMe-oF

## 产品线

VastData 有两条产品线：

1. **EBox**（新款全闪）：纯 NVMe SSD，从 11-250 个 EBox 线性扩展
2. **CNode + DBox**（算力+存储分离）：计算节点（CNode）+ 存储节点（DBox）预定义配置组合

## 工作流程

此 skill 使用 JavaScript 脚本 `scripts/vastdata-planner.js` 进行核心计算，流程如下：

1. 收集用户需求（容量、性能、产品线选择）
2. 调用 `vastdata-planner.js` 脚本进行计算
3. 解析并格式化输出结果

## 用户输入需求

### 1. 容量需求（必填）

询问用户的容量需求，支持：
- **TB**：例如 "500TB"、"1000TB"
- **PB**：例如 "1PB"、"5PB"

### 2. 性能需求（可选）

询问用户是否有性能需求：
- **读带宽**：例如 "200GB/s"
- **持续写带宽**：例如 "30GB/s"
- **读 IOPS**：例如 "5000K"（单位：K，即千）
- **写 IOPS**：例如 "1000K"

### 3. 产品线选择（可选）

- **ebox**（默认）：EBox 全闪产品线，11-250 个 EBox 线性扩展
- **cnode**：CNode+DBox 算力存储分离架构，预定义配置组合
- **all**：同时显示两条产品线的方案

### 4. 磁盘规格（可选，仅 EBox）

EBox 支持三种磁盘规格：
- **15.36TB**：2×800GB SCM + 8×15.36TB NVMe SSD
- **30.72TB**：2×1.6TB SCM + 8×30.72TB NVMe SSD
- **61.44TB**：3×1.6TB SCM + 7×61.44TB NVMe SSD

如果不指定，默认显示所有三种规格的方案。

## 使用方法

### 步骤 1：收集用户需求

询问用户以下信息：
1. **容量需求**（必填）：例如 "500TB"、"2PB"
2. **性能需求**（可选）：
   - 读带宽：例如 "200GB/s"
   - 持续写带宽：例如 "30GB/s"
   - 读 IOPS：例如 "5000K"
   - 写 IOPS：例如 "1000K"
3. **产品线**（可选）：ebox、cnode 或 all（默认 all）
4. **磁盘规格**（可选，仅 EBox）：15.36、30.72 或 61.44

### 步骤 2：调用计算脚本

使用 Bash 工具调用 `scripts/vastdata-planner.js` 脚本：

```bash
cd /Users/wutz/Projects/wutz/infra-skills/skills/vastdata-planner
node scripts/vastdata-planner.js --capacity "500TB" [--read-bw 200] [--write-bw 30] [--read-iops 5000] [--write-iops 1000] [--mode ebox] [--disk 30.72]
```

参数说明：
- `--capacity`：容量需求（必填），例如 "500TB"、"2PB"
- `--read-bw`：读带宽需求（可选），单位 GB/s
- `--write-bw`：持续写带宽需求（可选），单位 GB/s
- `--read-iops`：读 IOPS 需求（可选），单位 K
- `--write-iops`：写 IOPS 需求（可选），单位 K
- `--mode`：产品线（可选），ebox、cnode 或 all（默认 all）
- `--disk`：磁盘规格（可选，仅 EBox），15tb、30tb 或 60tb

### 步骤 3：展示结果

**直接将脚本的原始输出完整呈现给用户，不得做任何修改或简化。**

具体要求：
- 不得删除任何表格列（包括「峰值写带宽」列）
- 不得合并、折叠或重新排列行
- 不得将 Markdown 表格改写为文字段落或其他格式
- 可以在脚本输出之前补充换算说明（如 PiB→TB 的换算过程），但不得替代脚本输出

## 输出格式示例

以下为 `--capacity 500TB --mode all` 的实际输出：

```
# VastData 存储规划报告

## 需求摘要
  - 可用容量 ≥ 500.00 TB

## EBox 硬件方案（全闪 NVMe）

最小 EBox 数：11，最大：250，性能线性扩展

| 配置 | EBox数 | 可用容量 | 裸容量 | 读带宽 | 持续写带宽 | 峰值写带宽 | 读 IOPS | 写 IOPS |
|-----|-------|--------|-------|-------|---------|---------|--------|--------|
| 15.36TB NVMe (2×800GB SCM + 8×15.36TB NVMe) | 11 | 982.67 TB | 1351.68 TB | 231 GB/s | 28.6 GB/s | 110 GB/s | 1980K | 261.25K |
| 30.72TB NVMe (2×1.6TB SCM + 8×30.72TB NVMe) | 11 | 1965.34 TB | 2703.36 TB | 231 GB/s | 28.6 GB/s | 110 GB/s | 1980K | 261.25K |
| 61.44TB NVMe (3×1.6TB SCM + 7×61.44TB NVMe) | 11 | 3439.35 TB | 4730.88 TB | 231 GB/s | 28.6 GB/s | 110 GB/s | 1980K | 261.25K |


## CNode+DBox 硬件方案（算力+存储分离）

预定义配置组合，CNode 为计算节点，DBox 为存储节点

每种磁盘规格的最小满足需求配置：

| 配置 | 可用容量 | 裸容量 | 读带宽 | 持续写带宽 | 峰值写带宽 | 读 IOPS | 写 IOPS | 备注 |
|-----|--------|-------|-------|---------|---------|--------|--------|-----|
| 3 CNode (1U-1N-GEN5-2NIC) + 1 DBox (Ceres DF-3060-V2, 61.44TB盘) | 982.62 TB | 1351.68 TB | 58 GB/s | 8.5 GB/s | 20 GB/s | 585K | 100K | 使用 60TB 的硬盘，单 DBox 就可以达到 1 PB 的容量，具有极高的性价比 |
| 4 CNode (1U-1N-GEN5-2NIC) + 2 DBox (Ceres DF-3015-V2, 15.36TB盘) | 552.73 TB | 675.84 TB | 116 GB/s | 14.8 GB/s | 40 GB/s | 780K | 180K |  |
| 5 CNode (1U-1N-GEN6-2NIC) + 2 DBox (MLK DF-5630, 30.72TB盘) | 2340.00 TB | 2703.36 TB | 112 GB/s | 21.2 GB/s | 60 GB/s | 1100K | 200K | 2PB |
```

## 重要说明

### 协议支持

VastData 统一存储平台在同一系统上同时支持：
- **文件协议**：NFS v3/v4、SMB 2.x/3.x、NFS over RDMA（高性能场景）
- **对象协议**：S3 API（原生支持，非网关转换）
- **块协议**：iSCSI、NVMe-oF（NVMe over Fabrics）

所有协议共享同一存储池，无需单独规划容量。

### EBox 硬件方案特点

- **线性扩展**：从 11 到 250 个 EBox，容量和性能线性增长
- **性能与磁盘无关**：EBox 性能仅取决于 EBox 数量，与磁盘规格无关
- **三种磁盘规格**：15.36TB、30.72TB、61.44TB，容量不同但性能相同
- **最小配置**：11 个 EBox
- **最大配置**：250 个 EBox
- **统一协议**：同一集群同时提供文件、对象、块存储服务

### CNode+DBox 硬件方案特点

- **预定义配置**：固定的 CNode 和 DBox 组合，不支持自定义
- **算力存储分离**：CNode 负责计算和协议处理，DBox 负责存储
- **多种配置**：从小容量（245TB）到大容量（10PB+）
- **灵活选择**：根据容量和性能需求选择最合适的预定义配置
- **统一协议**：同一集群同时提供文件、对象、块存储服务

## 参考文档

详细的技术规格和配置数据请参考：[references/TECHNICAL_SPECS.md](references/TECHNICAL_SPECS.md)
