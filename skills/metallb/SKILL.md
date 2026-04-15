---
name: metallb
description: MetalLB 负载均衡器的部署、运维和故障排查。当用户提到 MetalLB、LoadBalancer、L2 模式、BGP 模式、IPAddressPool、L2Advertisement、BGPAdvertisement、BGPPeer、负载均衡器 IP、speaker、ExternalIP、裸金属负载均衡、bare-metal load balancer、Service 没有外部 IP、Service Pending 时使用此 skill。即使用户没有明确说"MetalLB"，只要涉及 Kubernetes 裸金属集群的 LoadBalancer 类型 Service、外部 IP 分配、L2/BGP 网络通告相关的问题都应该触发此 skill。
---

# MetalLB 运维助手

帮助用户在 Kubernetes 裸金属集群中部署、运维和排查 MetalLB 负载均衡器。

## 概述

[MetalLB](https://github.com/metallb/metallb) 为裸金属 Kubernetes 集群提供 LoadBalancer 类型 Service 的实现。云环境中 LoadBalancer 由云厂商提供，裸金属环境需要 MetalLB 来分配和通告外部 IP。

### 核心组件

| 组件 | 功能 |
|------|------|
| **Controller** | Deployment，负责 IP 地址分配，监听 Service 变化 |
| **Speaker** | DaemonSet，运行在每个节点上，负责网络通告（ARP/NDP/BGP） |

### L2 模式 vs BGP 模式

| 特性 | L2 模式 | BGP 模式 |
|------|---------|----------|
| **原理** | 通过 ARP(IPv4)/NDP(IPv6) 通告 IP | 通过 BGP 协议向路由器通告路由 |
| **流量分发** | 单节点承载所有流量，kube-proxy 二次分发 | 路由器 ECMP 多路径分发到多节点 |
| **故障切换** | 秒级（等待客户端 ARP 缓存更新） | 取决于 BGP hold timer（默认 90s），BFD 可加速 |
| **网络要求** | 无特殊要求，同二层网络即可 | 需要路由器支持 BGP |
| **带宽瓶颈** | 单节点带宽上限 | 多节点均摊，无单点瓶颈 |
| **配置复杂度** | 低 | 中高（需配置路由器） |
| **适用场景** | 简单环境、无 BGP 路由器、快速部署 | 高性能、大规模、需要真正负载均衡 |

## 部署指南

### 前置条件

- Kubernetes 1.20+
- 集群网络无冲突的 IP 地址段可供分配
- BGP 模式需要网络路由器支持 BGP 并已获取 ASN

### 方式一：Helmwave 部署（推荐）

使用 helmwave 进行声明式部署管理：

**helmwave.yml：**

```yaml
repositories:
  - name: metallb
    url: https://metallb.github.io/metallb

releases:
  - name: metallb
    namespace: metallb-system
    create_namespace: true
    chart:
      name: metallb/metallb
      version: 0.15.3
    values:
      - values.yml
```

**values.yml（生产环境推荐配置）：**

将 controller 和 speaker 调度到控制面节点，并容忍 NoSchedule taint：

```yaml
controller:
  affinity:
    nodeAffinity:
      requiredDuringSchedulingIgnoredDuringExecution:
        nodeSelectorTerms:
          - matchExpressions:
              - key: node-role.kubernetes.io/control-plane
                operator: Exists
  tolerations:
    - operator: Exists
      effect: NoSchedule
speaker:
  ignoreExcludeLB: true
  affinity:
    nodeAffinity:
      requiredDuringSchedulingIgnoredDuringExecution:
        nodeSelectorTerms:
          - matchExpressions:
              - key: node-role.kubernetes.io/control-plane
                operator: Exists
  tolerations:
    - operator: Exists
      effect: NoSchedule
```

> **注意**：`speaker.ignoreExcludeLB: true` 确保 speaker 忽略 `node.kubernetes.io/exclude-from-external-load-balancers` 标签，否则该标签会导致 speaker 不宣告 VIP。

**部署命令：**

```bash
# 部署
helmwave up --build

# 等待所有 Pod 就绪
kubectl wait -n metallb-system --for=condition=ready pod -l app.kubernetes.io/instance=metallb --timeout=120s
```

### 方式二：Helm 安装

```bash
helm repo add metallb https://metallb.universe.tf
helm repo update

helm install metallb metallb/metallb --namespace metallb-system --create-namespace

kubectl wait --namespace metallb-system \
  --for=condition=ready pod \
  --selector=app.kubernetes.io/name=metallb \
  --timeout=120s
```

### 方式三：Manifest 安装

```bash
kubectl apply -f https://raw.githubusercontent.com/metallb/metallb/v0.14.9/config/manifests/metallb-native.yaml

kubectl wait --namespace metallb-system \
  --for=condition=ready pod \
  --selector=app.kubernetes.io/name=metallb \
  --timeout=120s
```

### 配置 L2 模式

L2 模式需要两个资源：`IPAddressPool` + `L2Advertisement`。

**default-pool.yaml：**

```yaml
apiVersion: metallb.io/v1beta1
kind: IPAddressPool
metadata:
  name: default
  namespace: metallb-system
spec:
  addresses:
    # [需要修改] 从数据中心管理员获取空闲 IP 地址池
    - 172.18.15.200-172.18.15.210
---
apiVersion: metallb.io/v1beta1
kind: L2Advertisement
metadata:
  name: default
  namespace: metallb-system
spec:
  ipAddressPools:
    - default
```

使用 kustomize 管理配置：

**kustomization.yaml：**

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
- default-pool.yaml
```

应用配置：

```bash
kubectl apply -k .
```

### 配置 BGP 模式

BGP 模式需要三个资源：`IPAddressPool` + `BGPPeer` + `BGPAdvertisement`。

```yaml
# 1. IP 地址池
apiVersion: metallb.io/v1beta1
kind: IPAddressPool
metadata:
  name: bgp-pool
  namespace: metallb-system
spec:
  addresses:
    - 203.0.113.0/24
---
# 2. BGP 对等体配置
apiVersion: metallb.io/v1beta1
kind: BGPPeer
metadata:
  name: router-peer
  namespace: metallb-system
spec:
  myASN: 64500           # 集群 ASN（私有范围：64512-65534）
  peerASN: 64501          # 路由器 ASN
  peerAddress: 10.0.0.1   # 路由器 IP
  # holdTime: 90s
  # keepaliveTime: 30s
---
# 3. BGP 通告
apiVersion: metallb.io/v1beta1
kind: BGPAdvertisement
metadata:
  name: bgp-adv
  namespace: metallb-system
spec:
  ipAddressPools:
    - bgp-pool
```

### 配置 BFD（快速故障检测）

BFD 可大幅减少 BGP 故障检测时间（从秒级到毫秒级）：

```yaml
apiVersion: metallb.io/v1beta1
kind: BFDProfile
metadata:
  name: fast-detect
  namespace: metallb-system
spec:
  receiveInterval: 300      # ms
  transmitInterval: 300     # ms
  detectMultiplier: 3       # 3次丢包后判定故障
  echoInterval: 50          # ms
  minimumTtl: 254
---
apiVersion: metallb.io/v1beta1
kind: BGPPeer
metadata:
  name: router-peer-bfd
  namespace: metallb-system
spec:
  myASN: 64500
  peerASN: 64501
  peerAddress: 10.0.0.1
  bfdProfile: fast-detect   # 引用 BFD 配置
```

### 验证部署

部署一个 nginx 测试 Service 验证 MetalLB 是否正常工作：

```yaml
apiVersion: v1
kind: Service
metadata:
  name: nginx
  annotations:
    # 指定 IP 地址池中的 IP 地址，防止 Service 重建时 IP 变化
    #metallb.io/loadBalancerIPs: 172.18.15.200
spec:
  ports:
  - port: 80
    targetPort: 80
  selector:
    app: nginx
  type: LoadBalancer
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx
spec:
  replicas: 1
  selector:
    matchLabels:
      app: nginx
  template:
    metadata:
      labels:
        app: nginx
    spec:
      containers:
      - name: nginx
        image: nginx:latest
        ports:
          - containerPort: 80
```

```bash
# 部署测试
kubectl apply -f tests.yaml

# 检查是否获得 ExternalIP
kubectl get svc nginx

# 验证连通性
curl http://<EXTERNAL-IP>

# 清理
kubectl delete -f tests.yaml
```

### Service 指定 IP 池或固定 IP

```yaml
apiVersion: v1
kind: Service
metadata:
  name: my-service
  annotations:
    metallb.universe.tf/address-pool: bgp-pool          # 指定 IP 池
    # metallb.io/loadBalancerIPs: 192.168.1.241         # 指定具体 IP（新注解格式）
    # metallb.universe.tf/loadBalancerIPs: 192.168.1.241  # 旧注解格式
spec:
  type: LoadBalancer
  ports:
    - port: 80
      targetPort: 8080
  selector:
    app: my-app
```

### IP 共享（多 Service 共用一个 IP）

多个 Service 可以通过共享注解使用同一个外部 IP（端口不能冲突）：

```yaml
apiVersion: v1
kind: Service
metadata:
  name: service-tcp
  annotations:
    metallb.universe.tf/allow-shared-ip: "shared-key-1"
spec:
  type: LoadBalancer
  loadBalancerIP: 192.168.1.241
  ports:
    - port: 80
      protocol: TCP
---
apiVersion: v1
kind: Service
metadata:
  name: service-udp
  annotations:
    metallb.universe.tf/allow-shared-ip: "shared-key-1"
spec:
  type: LoadBalancer
  loadBalancerIP: 192.168.1.241
  ports:
    - port: 53
      protocol: UDP
```

## 运维操作

### 日常巡检

使用诊断脚本快速检查 MetalLB 集群状态：

```bash
node scripts/metallb-diag.js
```

加 `--json` 参数可输出 JSON 格式便于程序处理：

```bash
node scripts/metallb-diag.js --json
```

### 手动检查命令

#### 检查组件状态

```bash
# 查看所有 MetalLB Pod
kubectl get pods -n metallb-system -o wide

# 检查 controller 日志
kubectl logs -n metallb-system -l app.kubernetes.io/component=controller --tail=50

# 检查 speaker 日志（所有节点）
kubectl logs -n metallb-system -l app.kubernetes.io/component=speaker --tail=50
```

#### 查看 IP 分配情况

```bash
# 查看所有 IPAddressPool
kubectl get ipaddresspools -n metallb-system -o wide

# 查看所有 LoadBalancer Service 及其 ExternalIP
kubectl get svc -A --field-selector spec.type=LoadBalancer

# 查看 VIP 分配在哪个节点（新版本 MetalLB）
kubectl get servicel2statuses.metallb.io -n metallb-system
```

#### 查询 VIP 所在节点

有 3 种方法查询 VIP 分配到了哪个节点：

**方法一：查询 ServiceL2Status（推荐，需较新 MetalLB 版本）**

```bash
kubectl get servicel2statuses.metallb.io -n metallb-system
```

**方法二：通过 ARP 查询**

```bash
# 从集群外执行 arping 获取 MAC 地址
arping <vip>
# 然后通过 MAC 反查节点 IP
arp -n | grep <mac>
```

> 如果 arping 没有响应或 timeout，可能原因：VIP 工作不正常（用 `telnet <vip> <服务端口>` 确认）；或者 VIP 就在当前节点上。

**方法三：通过 Speaker 日志**

```bash
kubectl logs <speaker-pod> -n metallb-system | grep serviceAnnounced | grep <vip>
```

然后根据 Pod 所在节点确认。

#### L2 模式状态

```bash
# 查看 L2Advertisement
kubectl get l2advertisements -n metallb-system -o yaml

# 查看哪个节点是 leader（负责 ARP 应答）
kubectl logs -n metallb-system -l app.kubernetes.io/component=speaker --tail=200 | grep -i "leader\|announce"

# 从客户端检查 ARP
arp -a | grep <external-ip>
```

#### BGP 模式状态

```bash
# 查看 BGPPeer 配置
kubectl get bgppeers -n metallb-system -o yaml

# 检查 BGP 会话状态
kubectl logs -n metallb-system -l app.kubernetes.io/component=speaker --tail=200 | grep -i "bgp\|session\|established"
```

#### 抓包分析

```bash
# 如果 VIP 跑在 bond0 上，在 speaker 节点上抓包
tcpdump -i bond0 arp and host <vip>
```

## 故障排查

### 症状 1：Service 一直 Pending，没有 ExternalIP

**排查流程：**

1. **检查 MetalLB 是否安装并运行**
   ```bash
   kubectl get pods -n metallb-system
   ```
   - 如果没有 Pod → MetalLB 未安装
   - 如果 Pod 不是 Running → 检查 Pod 事件和日志

2. **检查是否配置了 IPAddressPool**
   ```bash
   kubectl get ipaddresspools -n metallb-system
   ```
   - 如果没有 → 创建 IPAddressPool
   - **IPAddressPool 必须在 `metallb-system` namespace 中**

3. **检查是否配置了 Advertisement**
   ```bash
   kubectl get l2advertisements,bgpadvertisements -n metallb-system
   ```
   - 如果都没有 → 创建 L2Advertisement 或 BGPAdvertisement

4. **检查 IP 池是否已耗尽**
   ```bash
   kubectl get svc -A --field-selector spec.type=LoadBalancer -o jsonpath='{range .items[*]}{.status.loadBalancer.ingress[0].ip}{"\n"}{end}' | sort -u | wc -l
   kubectl get ipaddresspools -n metallb-system -o yaml
   ```

5. **检查 controller 日志**
   ```bash
   kubectl logs -n metallb-system -l app.kubernetes.io/component=controller --tail=100
   ```
   查找 "no available IPs"、"pool exhausted"、"failed to allocate" 等错误。

6. **检查 speaker 节点标签**
   ```bash
   kubectl get nodes --show-labels | grep exclude-from-external-load-balancers
   ```
   如果节点有 `node.kubernetes.io/exclude-from-external-load-balancers` 标签，speaker 不会在该节点宣告 VIP。设置 `speaker.ignoreExcludeLB: true` 可以忽略此标签。

**常见原因总结：**
- 未创建 IPAddressPool
- 未创建 L2Advertisement/BGPAdvertisement
- IPAddressPool 不在 metallb-system namespace
- IP 池耗尽
- Controller Pod 未就绪
- 节点有 `exclude-from-external-load-balancers` 标签

### 症状 2：IP 已分配但从外部不可达

**排查流程：**

1. **确认 IP 已分配**
   ```bash
   kubectl get svc <service-name> -n <namespace> -o wide
   ```

2. **L2 模式排查**

   a. 检查 speaker Pod 状态：
   ```bash
   kubectl get pods -n metallb-system -l app.kubernetes.io/component=speaker -o wide
   ```

   b. 使用 arping 定位 VIP 节点：
   ```bash
   arping <external-ip>
   # 如果无响应 → speaker 未正常工作或网络隔离
   # 如果有响应 → 通过 MAC 查找节点
   arp -n | grep <mac-from-arping>
   ```

   c. 从 speaker 节点抓包确认：
   ```bash
   tcpdump -i <interface> arp and host <external-ip>
   ```

   d. 清除客户端 ARP 缓存重试：
   ```bash
   # Linux
   ip neigh del <external-ip> dev <interface>
   # macOS
   arp -d <external-ip>
   ping -c 3 <external-ip>
   ```

3. **检查 externalTrafficPolicy**

   当 Service 设置 `externalTrafficPolicy: Local` 时：
   - Speaker **只会在有后端 Pod 的节点上宣告 VIP**
   - 这意味着只有高可用没有负载均衡作用
   - 主要用于保留客户端源 IP
   - 确保后端 Pod 和 speaker 运行在相同节点上

4. **检查 Service 的 Endpoints**
   ```bash
   kubectl get endpoints <service-name> -n <namespace>
   ```
   如果没有 endpoints → 后端 Pod 未就绪或 selector 不匹配。

5. **BGP 模式排查**

   ```bash
   # 检查 BGP 会话
   kubectl logs -n metallb-system -l app.kubernetes.io/component=speaker --tail=200 | grep -i "bgp\|session"
   # 检查防火墙（BGP 端口 TCP 179）
   kubectl exec -n metallb-system <speaker-pod> -- nc -zv <router-ip> 179
   ```

### 症状 3：BGP 对等体连接失败

**排查流程：**

1. **检查配置**
   ```bash
   kubectl get bgppeers -n metallb-system -o yaml
   ```
   确认 `myASN`、`peerASN`、`peerAddress` 是否正确。

2. **检查网络连通性**
   ```bash
   kubectl exec -n metallb-system <speaker-pod> -- ping -c 3 <router-ip>
   kubectl exec -n metallb-system <speaker-pod> -- nc -zv <router-ip> 179
   ```

3. **检查 speaker 日志**
   ```bash
   kubectl logs -n metallb-system -l app.kubernetes.io/component=speaker --tail=200 | grep -i "bgp\|peer\|error\|fail"
   ```
   - "connection refused" → 路由器未监听 BGP 或防火墙阻止
   - "ASN mismatch" → ASN 配置不一致
   - "hold timer expired" → 网络不稳定

4. **路由器侧检查**
   - BGP 邻居是否配置了集群节点 IP
   - ASN 号是否与 MetalLB 配置匹配
   - BGP 进程是否运行
   - 路由表中是否有 Service IP 路由

### 症状 4：L2 模式 ARP 问题

**排查流程：**

1. **检查 L2 通告节点**
   ```bash
   kubectl logs -n metallb-system -l app.kubernetes.io/component=speaker --tail=200 | grep -E "arp|gratuitous|announce|leader"
   ```

2. **抓包确认 ARP 通告**
   ```bash
   # 在 speaker 节点上
   tcpdump -i <interface> arp and host <external-ip>
   ```

3. **网络交换机问题**
   - 检查 DHCP snooping、Dynamic ARP Inspection (DAI) 等安全特性
   - 确认交换机允许 Gratuitous ARP

4. **多网卡环境**
   Speaker 可能在错误的网卡上通告 ARP，使用 `interfaces` 字段限制：
   ```yaml
   apiVersion: metallb.io/v1beta1
   kind: L2Advertisement
   metadata:
     name: l2adv
     namespace: metallb-system
   spec:
     ipAddressPools:
       - default
     interfaces:
       - eth0          # 只在 eth0 上通告
   ```

### 症状 5：Speaker Pod 异常

1. **CrashLoopBackOff**
   ```bash
   kubectl logs -n metallb-system <speaker-pod> --previous
   ```
   常见原因：权限不足、RBAC 缺失

2. **Speaker 未调度到某些节点**
   ```bash
   kubectl describe daemonset -n metallb-system speaker
   ```
   检查 nodeSelector、tolerations。master/control-plane 节点需要 toleration。

3. **Memberlist 通信失败（speaker 间选举异常）**
   ```bash
   kubectl logs -n metallb-system <speaker-pod> --tail=100 | grep -i "memberlist"
   ```
   确认节点间 7946 端口（TCP+UDP）已放行。

### 症状 6：Failover 延迟

**L2 模式：**
- 切换时间取决于客户端 ARP 缓存超时
- MetalLB 发送 Gratuitous ARP，但某些客户端/交换机可能不处理
- 改善：确保网络设备支持 Gratuitous ARP

**BGP 模式：**
- 默认故障检测依赖 BGP Hold Timer（90s）
- 启用 BFD 可缩短到毫秒级
- **已知限制**：节点故障时 ECMP 哈希重算可能导致已有连接被重分配，有状态长连接需应用层重连

## 卸载

```bash
# 先删除配置资源
kubectl delete -k .

# Helmwave 部署的
helmwave down

# Helm 部署的
helm uninstall metallb --namespace metallb-system

# 清理 CRD（完全清理时）
kubectl delete crd ipaddresspools.metallb.io l2advertisements.metallb.io bgpadvertisements.metallb.io bgppeers.metallb.io bfdprofiles.metallb.io communities.metallb.io

# 清理 namespace
kubectl delete namespace metallb-system
```

## 诊断脚本

使用 Bash 工具调用诊断脚本快速检查 MetalLB 健康状态：

```bash
cd <skill-directory>/skills/metallb
node scripts/metallb-diag.js [--namespace metallb-system] [--json]
```

脚本会检查：CRD 安装状态、Pod 状态、IPAddressPool 配置、Advertisement 配置、BGPPeer 配置、LoadBalancer Service 分配情况，并汇总健康评分。

## 重要说明

- 所有 MetalLB 配置资源必须在 `metallb-system` namespace 中创建
- IP 池地址范围不能与节点 IP、Pod CIDR、Service CIDR 冲突
- L2 模式分配的 IP 必须与节点在同一个二层网络
- 确保 speaker 运行节点未设置 `node.kubernetes.io/exclude-from-external-load-balancers` 标签（或设置 `ignoreExcludeLB: true`）
- 当 `externalTrafficPolicy: Local` 时，speaker 只在有后端 Pod 的节点上宣告 VIP
- MetalLB v0.13+ 使用 CRD 配置，旧版本 ConfigMap 已废弃

## 参考文档

详细的 CRD API 参考和版本兼容信息请参考：[references/TECHNICAL_SPECS.md](references/TECHNICAL_SPECS.md)
