---
name: spiderpool
description: Spiderpool Kubernetes underlay 和 RDMA 网络部署、运维和排错指南。当用户提到 Spiderpool、RDMA、underlay 网络、Macvlan CNI、SR-IOV、InfiniBand、RoCE、HCA、网卡直通、GPU 网络、AI 集群网络、高性能网络、SpiderIPPool、SpiderMultusConfig、rdma shared device plugin、helmwave 部署 spiderpool、DOCA OFED、ConnectX 时使用此 skill。即使用户没有明确说"部署"或"运维"，只要涉及 Spiderpool 或 Kubernetes RDMA 网络相关的问题都应该触发此 skill。
---

# Spiderpool 部署运维指南

Spiderpool 是 Kubernetes underlay 和 RDMA 网络解决方案，增强 Macvlan CNI、ipvlan CNI 和 SR-IOV CNI 功能，适用于裸金属、虚拟机和公有云环境，为存储、中间件、AI 等 I/O 密集和低延时应用提供高性能网络。

## 工作流程

1. 识别用户的部署场景（IB / RoCE 单网段 / RoCE 多网段）
2. 收集用户环境信息（网卡型号、设备 ID、网段、节点名等）
3. 根据场景生成定制化配置文件
4. 指导用户完成部署、测试和验证
5. 提供运维和排错支持

## 部署场景

### 场景选择

向用户确认以下信息来确定部署场景：

| 场景 | 网络类型 | 网卡用途 | 典型硬件 | 适用场景 |
|------|----------|----------|----------|----------|
| **IB** | InfiniBand | 管理/存储用 Ethernet + 计算用 IB | ConnectX-6 (管理) + ConnectX-7 (计算) | 专用 IB 交换机环境，最高性能 |
| **RoCE 单网段** | RoCE | Bonding 统一用于管理/存储/计算 | ConnectX-5 (Bonding) | 单网段以太网环境 |
| **RoCE 多网段** | RoCE | 多块网卡分属不同网段 | ConnectX-7 (8x 独立网卡) | SuperPod 多交换机环境 |

### 前置条件

- 所有节点已安装 [DOCA OFED](https://developer.nvidia.com/doca-downloads?deployment_platform=Host-Server&deployment_package=DOCA-Host&target_os=Linux&Architecture=x86_64&Profile=doca-ofed)（MLNX OFED 已迁移到 DOCA OFED）
- Kubernetes 集群已就绪
- helmwave 已安装

### 已知限制

- Spiderpool 当前实现与 Istio 的 ambient 模式冲突

## 用户输入需求

根据场景收集以下信息：

### 通用信息（所有场景）
- **Helm Chart 版本**（可选，默认 1.0.5）
- **RDMA Shared Device Plugin 版本**（可选，默认 v1.5.3）

### IB 场景
- **设备 ID**（必填）：InfiniBand 网卡的 PCI Device ID，通过 `lspci -nn | grep Mellanox` 获取，如 `1021`
- **rdmaHcaMax**（可选，默认 100）：每个 HCA 最大 RDMA 设备数

### RoCE 单网段场景
- **设备 ID**（必填）：RoCE 网卡的 PCI Device ID，如 `1017`
- **Bonding 设备名**（必填）：如 `bond0`
- **IP 网段**（必填）：如 `192.168.0.0/16`
- **IP 范围**（必填）：如 `192.168.0.1-192.168.63.254`
- **rdmaHcaMax**（可选，默认 100）

### RoCE 多网段场景
- **网卡名称列表**（必填）：所有节点上的 RDMA 网卡名称（必须跨节点一致），如 `ens1130np0, ens1131np0, ...`
- **每块网卡的网段信息**（必填）：包括 subnet、gateway、IP 范围
- **SU 分组信息**（必填）：节点按交换机分组，同一 SU 内同号网卡在同一网段
- **rdmaHcaMax**（可选，默认 100）

## 使用方法

### 步骤 1：确认场景并收集信息

询问用户：
1. 网络类型是 IB、RoCE 单网段还是 RoCE 多网段？
2. 在节点上执行 `lspci -nn | grep Mellanox` 的输出是什么？
3. 根据场景收集上述必填信息

### 步骤 2：生成配置文件

根据用户提供的信息，基于 `references/DEPLOYMENT_GUIDE.md` 中的模板生成定制化配置文件：

**IB 场景**生成：
- `helmwave.yml` — Helm 部署配置
- `values.yml` — RDMA 设备插件配置（填入用户的 deviceID）
- `tests.yaml` — RDMA 测试 DaemonSet

**RoCE 单网段**生成：
- `helmwave.yml` — Helm 部署配置
- `values.yml` — RDMA 设备插件配置（填入用户的 deviceID）
- `hca.yaml` — SpiderIPPool + SpiderMultusConfig（填入用户的 bond 设备名、网段和 IP 范围）
- `tests.yaml` — RDMA 测试 DaemonSet

**RoCE 多网段**生成：
- `helmwave.yml` — Helm 部署配置
- `values.yml` — RDMA 设备插件配置（填入用户的网卡名称列表）
- `nfr.yaml` — NodeFeatureRule（填入用户的 SU 分组和节点名）
- `hca1.yaml ~ hcaN.yaml` — 每块网卡的 SpiderIPPool + SpiderMultusConfig
- `kustomization.yaml` — Kustomize 聚合配置
- `tests.yaml` — RDMA 测试 DaemonSet

### 步骤 3：指导部署

按顺序指导用户执行：

1. **部署 Spiderpool**：
   ```bash
   helmwave up --build
   ```

2. **应用网络配置**（仅 RoCE 场景）：
   - RoCE 单网段：`kubectl apply -f hca.yaml`
   - RoCE 多网段：`kubectl apply -k .`

3. **验证部署**：
   ```bash
   kubectl get pods -n spiderpool
   kubectl get spiderippool -A
   kubectl get spidermultusconfig -n spiderpool
   ```

### 步骤 4：测试验证

指导用户执行 RDMA 连通性测试：

```bash
# 部署测试 Pod
kubectl apply -f tests.yaml

# 等待 Pod 就绪
kubectl get pods -l app=tests-rdma-hca -o wide

# 在 Pod A 上启动 server
kubectl exec -it <pod-a> -- ib_send_bw -d mlx5_0      # IB 场景
kubectl exec -it <pod-a> -- ib_send_bw -x 7 -d mlx5_bond_0  # RoCE 场景

# 在 Pod B 上启动 client
kubectl exec -it <pod-b> -- ib_send_bw -d mlx5_0 <pod-a-ip>      # IB
kubectl exec -it <pod-b> -- ib_send_bw -x 7 -d mlx5_bond_0 <pod-a-ip>  # RoCE

# 清理测试 Pod
kubectl delete -f tests.yaml
```

## 运维操作

### 卸载

```bash
helmwave down
```

### 扩缩容

- 新增节点后，Spiderpool agent 会自动部署（DaemonSet 方式）
- RoCE 多网段场景需更新 `nfr.yaml` 添加新���点到正确的 SU 分组
- 如需扩展 IP 池，更新 SpiderIPPool 的 ips 范围

### 升级

修改 `helmwave.yml` 中的 chart version，然后重新执行 `helmwave up --build`

## 排错指南

### 常见问题

| 问题 | 可能原因 | 排查方法 |
|------|----------|----------|
| Pod 无法分配 RDMA 资源 | RDMA Shared Device Plugin 未正确配置 | `kubectl get node <node> -o json \| jq '.status.allocatable'` 检查 rdma/hca 资源 |
| Pod 网络不通 | SpiderMultusConfig 或 SpiderIPPool 配置错误 | `kubectl describe spiderippool <pool>` 检查 IP 分配状态 |
| ib_send_bw 测试失败 | DOCA OFED 未安装或版本不匹配 | 节点执行 `ofed_info` 确认驱动版本 |
| IP 地址耗尽 | IP 池范围太小 | `kubectl get spiderippool <pool> -o yaml` 检查已分配 IP |
| Pod 无 IPC_LOCK 权限 | SecurityContext 未设置 | 检查 Pod spec 是否包含 `capabilities: add: ["IPC_LOCK"]` |
| 网卡名不一致（RoCE 多网段） | 不同节点网卡命名不同 | 使用 [udev 规则](https://spidernet-io.github.io/spiderpool/v1.0/usage/spider-multus-config-zh_CN/?h=udev#_4) 统一命名 |
| 与 Istio 冲突 | Spiderpool 与 Istio ambient 模式不兼容 | 禁用 Istio ambient 模式 |

### 诊断命令

```bash
# 查看 Spiderpool 组件状态
kubectl get pods -n spiderpool

# 查看 RDMA 资源分配
kubectl get node <node> -o json | jq '.status.allocatable | to_entries[] | select(.key | startswith("rdma"))'

# 查看 IP 池状态
kubectl get spiderippool -A -o wide

# 查看 Multus 配置
kubectl get spidermultusconfig -n spiderpool

# 查看事件
kubectl get events -n spiderpool --sort-by='.lastTimestamp'

# 查看 Spiderpool controller 日志
kubectl logs -n spiderpool -l app.kubernetes.io/component=spiderpool-controller --tail=100

# 查看 Spiderpool agent 日志
kubectl logs -n spiderpool -l app.kubernetes.io/component=spiderpool-agent --tail=100 --selector-all-nodes

# 节点层面检查 RDMA 设备
rdma link show
ibstat
lspci -nn | grep Mellanox
```

## 参考文档

- 详细部署模板和配置示例见 `references/DEPLOYMENT_GUIDE.md`
- [Spiderpool 官方文档](https://spidernet-io.github.io/spiderpool/)
- [AI Cluster with Macvlan](https://spidernet-io.github.io/spiderpool/v1.0/usage/install/ai/get-started-macvlan-zh_CN/)
- [NVIDIA DGX SuperPod 参考架构](https://docs.nvidia.com/dgx-superpod/reference-architecture-scalable-infrastructure-h100/latest/network-fabrics.html)
- [RDMA Shared Device Plugin 配置](https://github.com/Mellanox/k8s-rdma-shared-dev-plugin?tab=readme-ov-file#rdma-shared-device-plugin-configurations)
