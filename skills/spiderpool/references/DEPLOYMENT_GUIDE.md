# Spiderpool 部署指南

## 概述

Spiderpool 是 Kubernetes underlay 和 RDMA 网络解决方案，增强 Macvlan CNI、ipvlan CNI 和 SR-IOV CNI 功能。

- GitHub: https://github.com/spidernet-io/spiderpool
- 官方文档: https://spidernet-io.github.io/spiderpool/

## 前置条件

### 安装 DOCA OFED

所有节点必须安装 DOCA OFED（MLNX OFED 已迁移到 DOCA OFED）：

下载地址: https://developer.nvidia.com/doca-downloads?deployment_platform=Host-Server&deployment_package=DOCA-Host&target_os=Linux&Architecture=x86_64&Profile=doca-ofed

安装后验证：
```bash
ofed_info
```

### 识别网卡硬件

在节点上执行：
```bash
lspci -nn | grep Mellanox
```

常见设备 ID：

| 网卡型号 | Device ID | 类型 |
|----------|-----------|------|
| ConnectX-5 | 1017 | Ethernet |
| ConnectX-6 | 101b | Ethernet |
| ConnectX-7 (IB) | 1021 | InfiniBand |
| ConnectX-7 (Eth) | a2dc | Ethernet |

> 如果 deviceID 无法区分存储和计算网络，可以使用 `ifNames` 选择器，参见 [RDMA Shared Device Plugin Configurations](https://github.com/Mellanox/k8s-rdma-shared-dev-plugin?tab=readme-ov-file#rdma-shared-device-plugin-configurations)

---

## 场景一：InfiniBand (IB)

适用于专用 InfiniBand 交换机环境，管理/存储使用 Ethernet，计算通信使用 InfiniBand。

### 配置模板

#### helmwave.yml

```yaml
registries:
- host: ghcr.io

releases:
  - name: spiderpool
    namespace: spiderpool
    create_namespace: true
    chart:
      name: oci://ghcr.io/wutz/charts/spiderpool
      version: 1.0.5
    values:
      - values.yml
```

#### values.yml

```yaml
rdma:
  rdmaSharedDevicePlugin:
    install: true
    image:
      tag: v1.5.3

    deviceConfig:
      configList:
        [
          {
            "resourcePrefix": "rdma",
            "resourceName": "hca",
            "rdmaHcaMax": 100,
            "selectors": { "deviceIDs": ["<DEVICE_ID>"] }
          }
        ]

spiderpoolController:
  affinity:
    nodeAffinity:
      requiredDuringSchedulingIgnoredDuringExecution:
        nodeSelectorTerms:
          - matchExpressions:
              - key: "node-role.kubernetes.io/control-plane"
                operator: Exists
```

**替换说明**：
- `<DEVICE_ID>`: InfiniBand 网卡的 PCI Device ID（如 `1021`）

#### tests.yaml

```yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: "tests-rdma-hca"
spec:
  selector:
    matchLabels:
      app: "tests-rdma-hca"
  template:
    metadata:
      labels:
        app: "tests-rdma-hca"
    spec:
      containers:
        - name: tests-rdma-hca
          image: "ccr.ccs.tencentyun.com/tke-eni-test/mofed-5.4-3.1.0.0:ubuntu20.04-amd64-test"
          command:
            - tail
            - -f
            - /dev/null
          resources:
            limits:
              rdma/hca: 1
          securityContext:
            capabilities:
              add: [ "IPC_LOCK" ]
      tolerations:
        - operator: "Exists"
          effect: "NoSchedule"
```

### 部署步骤

1. 修改 `values.yml` 中的 `deviceIDs`
2. 执行 `helmwave up --build`
3. 验证部署：`kubectl get pods -n spiderpool`

### 测试

```bash
# 部署测试 Pod
kubectl apply -f tests.yaml

# 进入 Pod A（server）
kubectl exec -it tests-rdma-hca-xxx -- /bin/bash
ip a
ib_send_bw -d mlx5_0

# 进入 Pod B（client）
kubectl exec -it tests-rdma-hca-yyy -- /bin/bash
ib_send_bw -d mlx5_0 <server-ip>

# 清理
kubectl delete -f tests.yaml
```

---

## 场景二：RoCE 单网段

适用于单 IP 网段的 RoCE（RDMA over Converged Ethernet）网络，通常使用 Bonding 接口。

### 配置模板

#### helmwave.yml

（同 IB 场景）

#### values.yml

```yaml
rdma:
  rdmaSharedDevicePlugin:
    install: true
    image:
      tag: v1.5.3

    deviceConfig:
      configList:
        [
          {
            "resourcePrefix": "rdma",
            "resourceName": "hca",
            "rdmaHcaMax": 100,
            "selectors": { "deviceIDs": ["<DEVICE_ID>"] }
          }
        ]

spiderpoolController:
  affinity:
    nodeAffinity:
      requiredDuringSchedulingIgnoredDuringExecution:
        nodeSelectorTerms:
          - matchExpressions:
              - key: "node-role.kubernetes.io/control-plane"
                operator: Exists
```

**替换说明**：
- `<DEVICE_ID>`: RoCE 网卡的 PCI Device ID（如 `1017`）

#### hca.yaml

```yaml
apiVersion: spiderpool.spidernet.io/v2beta1
kind: SpiderIPPool
metadata:
  name: hca
spec:
  subnet: <SUBNET>
  ips:
  - <IP_RANGE>
---
apiVersion: spiderpool.spidernet.io/v2beta1
kind: SpiderMultusConfig
metadata:
  name: hca
  namespace: spiderpool
spec:
  cniType: macvlan
  macvlan:
    master: ["<BOND_DEVICE>"]
    ippools:
      ipv4: ["hca"]
```

**替换说明**：
- `<SUBNET>`: IP 网段（如 `192.168.0.0/16`）
- `<IP_RANGE>`: 可用 IP 范围（如 `192.168.0.1-192.168.63.254`）
- `<BOND_DEVICE>`: Bonding 设备名（如 `bond0`）

#### tests.yaml

```yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: "tests-rdma-hca"
spec:
  selector:
    matchLabels:
      app: "tests-rdma-hca"
  template:
    metadata:
      labels:
        app: "tests-rdma-hca"
      annotations:
        k8s.v1.cni.cncf.io/networks: |-
          [{"name":"hca","namespace":"spiderpool"}]
    spec:
      containers:
        - name: tests-rdma-hca
          image: "ccr.ccs.tencentyun.com/tke-eni-test/mofed-5.4-3.1.0.0:ubuntu20.04-amd64-test"
          command:
            - tail
            - -f
            - /dev/null
          resources:
            limits:
              rdma/hca: 1
          securityContext:
            capabilities:
              add: [ "IPC_LOCK" ]
      tolerations:
        - operator: "Exists"
          effect: "NoSchedule"
```

### 部署步骤

1. 修改 `values.yml` 中的 `deviceIDs`
2. 执行 `helmwave up --build`
3. 修改 `hca.yaml` 中的 `master`、`subnet`、`ips`
4. 执行 `kubectl apply -f hca.yaml`
5. 验证部署

### 测试

```bash
# 部署测试 Pod
kubectl apply -f tests.yaml

# 进入 Pod A（server）
kubectl exec -it tests-rdma-hca-xxx -- /bin/bash
ip addr show eth0
show_gids | grep v2
ib_send_bw -x 7 -d mlx5_bond_0

# 进入 Pod B（client）
kubectl exec -it tests-rdma-hca-yyy -- /bin/bash
show_gids | grep v2
ib_send_bw -x 7 -d mlx5_bond_0 <server-ip>

# 清理
kubectl delete -f tests.yaml
```

> **注意**：RoCE 使用 GID v2 索引（`-x 7`），设备名为 `mlx5_bond_0`

---

## 场景三：RoCE 多网段 (Multiple Interface)

适用于多 IP 网段 RoCE 网络，典型用于 SuperPod 环境，每块网卡独立子网。

### 前置要求

- 所有节点的 RDMA 网卡名称必须一致
- 如果不一致，使用 [udev 规则](https://spidernet-io.github.io/spiderpool/v1.0/usage/spider-multus-config-zh_CN/?h=udev#_4) 统一命名

### 配置模板

#### helmwave.yml

（同 IB 场景）

#### values.yml（以 8 块网卡为例）

```yaml
rdma:
  rdmaSharedDevicePlugin:
    install: true
    image:
      tag: v1.5.3

    deviceConfig:
      configList:
        [
          {
            "resourcePrefix": "rdma",
            "resourceName": "hca1",
            "rdmaHcaMax": 100,
            "selectors": { "ifNames": ["<IF_NAME_1>"] }
          },
          {
            "resourcePrefix": "rdma",
            "resourceName": "hca2",
            "rdmaHcaMax": 100,
            "selectors": { "ifNames": ["<IF_NAME_2>"] }
          },
          {
            "resourcePrefix": "rdma",
            "resourceName": "hca3",
            "rdmaHcaMax": 100,
            "selectors": { "ifNames": ["<IF_NAME_3>"] }
          },
          {
            "resourcePrefix": "rdma",
            "resourceName": "hca4",
            "rdmaHcaMax": 100,
            "selectors": { "ifNames": ["<IF_NAME_4>"] }
          },
          {
            "resourcePrefix": "rdma",
            "resourceName": "hca5",
            "rdmaHcaMax": 100,
            "selectors": { "ifNames": ["<IF_NAME_5>"] }
          },
          {
            "resourcePrefix": "rdma",
            "resourceName": "hca6",
            "rdmaHcaMax": 100,
            "selectors": { "ifNames": ["<IF_NAME_6>"] }
          },
          {
            "resourcePrefix": "rdma",
            "resourceName": "hca7",
            "rdmaHcaMax": 100,
            "selectors": { "ifNames": ["<IF_NAME_7>"] }
          },
          {
            "resourcePrefix": "rdma",
            "resourceName": "hca8",
            "rdmaHcaMax": 100,
            "selectors": { "ifNames": ["<IF_NAME_8>"] }
          },
        ]

spiderpoolController:
  affinity:
    nodeAffinity:
      requiredDuringSchedulingIgnoredDuringExecution:
        nodeSelectorTerms:
          - matchExpressions:
              - key: "node-role.kubernetes.io/control-plane"
                operator: Exists
```

**替换说明**：
- `<IF_NAME_N>`: 第 N 块 RDMA 网卡的接口名称

#### nfr.yaml（NodeFeatureRule - 节点 SU 分组）

```yaml
apiVersion: nfd.k8s-sigs.io/v1alpha1
kind: NodeFeatureRule
metadata:
  name: superpod
spec:
  rules:
    - name: "superpod-su1"
      labels:
        "nvidia.com/superpod-su": "su1"
      matchFeatures:
        - feature: system.name
          matchExpressions:
            nodename:
              op: In
              value:
                - <SU1_NODE_1>
                - <SU1_NODE_2>

    - name: "superpod-su2"
      labels:
        "nvidia.com/superpod-su": "su2"
      matchFeatures:
        - feature: system.name
          matchExpressions:
            nodename:
              op: In
              value:
                - <SU2_NODE_1>
                - <SU2_NODE_2>
```

**替换说明**：
- `<SU1_NODE_N>`: 属于 SU1 交换机组的节点主机名
- `<SU2_NODE_N>`: 属于 SU2 交换机组的节点主机名
- 根据实际 SU 数量增减 rules

> 同一组交换机上的节点打上同一 label，通常同号网卡在同一网段即在同一组交换机（即同一 SU）

#### hca.yaml 模板（每块网卡一个文件）

以 hca1 为例，其他网卡同理：

```yaml
apiVersion: spiderpool.spidernet.io/v2beta1
kind: SpiderIPPool
metadata:
  name: hca1-su1
spec:
  subnet: <HCA1_SU1_SUBNET>
  ips:
    - <HCA1_SU1_IP_RANGE>
  gateway: <HCA1_SU1_GATEWAY>
  nodeAffinity:
    matchExpressions:
      - key: nvidia.com/superpod-su
        operator: In
        values:
        - su1
---
apiVersion: spiderpool.spidernet.io/v2beta1
kind: SpiderIPPool
metadata:
  name: hca1-su2
spec:
  subnet: <HCA1_SU2_SUBNET>
  ips:
    - <HCA1_SU2_IP_RANGE>
  gateway: <HCA1_SU2_GATEWAY>
  nodeAffinity:
    matchExpressions:
      - key: nvidia.com/superpod-su
        operator: In
        values:
        - su2
---
apiVersion: spiderpool.spidernet.io/v2beta1
kind: SpiderMultusConfig
metadata:
  name: hca1
  namespace: spiderpool
spec:
  cniType: macvlan
  macvlan:
    master: ["<IF_NAME_1>"]
    ippools:
      ipv4: ["hca1-su1", "hca1-su2"]
```

**替换说明**：
- `<HCA1_SU1_SUBNET>`: HCA1 在 SU1 的子网（如 `10.23.0.0/24`）
- `<HCA1_SU1_IP_RANGE>`: HCA1 在 SU1 的空闲 IP 范围（如 `10.23.0.210-10.23.0.229`）
- `<HCA1_SU1_GATEWAY>`: HCA1 在 SU1 的网关（如 `10.23.0.254`）
- SU2 同理
- `<IF_NAME_1>`: 第一块网卡名（如 `ens1130np0`）

#### kustomization.yaml

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: spiderpool
resources:
- nfr.yaml
- hca1.yaml
- hca2.yaml
- hca3.yaml
- hca4.yaml
- hca5.yaml
- hca6.yaml
- hca7.yaml
- hca8.yaml
```

#### tests.yaml（以 8 块网卡为例）

```yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: "tests-rdma-hca"
spec:
  selector:
    matchLabels:
      app: "tests-rdma-hca"
  template:
    metadata:
      labels:
        app: "tests-rdma-hca"
      annotations:
        k8s.v1.cni.cncf.io/networks: |-
          [{"name":"hca1","namespace":"spiderpool"},
          {"name":"hca2","namespace":"spiderpool"},
          {"name":"hca3","namespace":"spiderpool"},
          {"name":"hca4","namespace":"spiderpool"},
          {"name":"hca5","namespace":"spiderpool"},
          {"name":"hca6","namespace":"spiderpool"},
          {"name":"hca7","namespace":"spiderpool"},
          {"name":"hca8","namespace":"spiderpool"}]
    spec:
      containers:
        - name: tests-rdma-hca
          image: "ccr.ccs.tencentyun.com/tke-eni-test/mofed-5.4-3.1.0.0:ubuntu20.04-amd64-test"
          command:
            - tail
            - -f
            - /dev/null
          resources:
            limits:
              rdma/hca1: 1
              rdma/hca2: 1
              rdma/hca3: 1
              rdma/hca4: 1
              rdma/hca5: 1
              rdma/hca6: 1
              rdma/hca7: 1
              rdma/hca8: 1
          securityContext:
            capabilities:
              add: [ "IPC_LOCK" ]
      tolerations:
        - operator: "Exists"
          effect: "NoSchedule"
```

### 部署步骤

1. 确保所有节点网卡名称一致（不一致则使用 udev 配置）
2. 修改 `values.yml` 中的 `ifNames` 为实际网卡名称
3. 执行 `helmwave up --build`
4. 修改 `nfr.yaml` 配置节点的 SU 分组
5. 修改各 `hcaN.yaml` 的 subnet、gateway、IP 范围
6. 执行 `kubectl apply -k .`
7. 验证部署

### 测试

```bash
# 部署测试 Pod
kubectl apply -f tests.yaml

# 进入 Pod A（server）
kubectl exec -it tests-rdma-hca-xxx -- /bin/bash
ip addr show eth0
show_gids | grep v2
ib_send_bw -x 7 -d mlx5_0

# 进入 Pod B（client）
kubectl exec -it tests-rdma-hca-yyy -- /bin/bash
show_gids | grep v2
ib_send_bw -x 7 -d mlx5_0 <server-ip>

# 清理
kubectl delete -f tests.yaml
```

---

## 卸载

```bash
helmwave down
```

---

## Mellanox 常见 Device ID 参考

| Device ID | 型号 | 类型 |
|-----------|------|------|
| 1013 | ConnectX-4 | Ethernet |
| 1015 | ConnectX-4 Lx | Ethernet |
| 1017 | ConnectX-5 | Ethernet |
| 1019 | ConnectX-5 Ex | Ethernet |
| 101b | ConnectX-6 | Ethernet |
| 101d | ConnectX-6 Dx | Ethernet |
| 101f | ConnectX-6 Lx | Ethernet |
| 1021 | ConnectX-7 | InfiniBand/VPI |
| a2dc | ConnectX-7 | Ethernet |
| a2d6 | MT42822 BlueField-2 | SmartNIC |
