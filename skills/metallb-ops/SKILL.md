---
name: metallb-ops
description: MetalLB 负载均衡器的部署、运维和故障排查。当用户提到 MetalLB、LoadBalancer、L2 模式、BGP 模式、IPAddressPool、L2Advertisement、BGPAdvertisement、BGPPeer、负载均衡器 IP、speaker、ExternalIP、裸金属负载均衡、bare-metal load balancer、Service 没有外部 IP、Service Pending 时使用此 skill。即使用户没有明确说"MetalLB"，只要涉及 Kubernetes 裸金属集群的 LoadBalancer 类型 Service、外部 IP 分配、L2/BGP 网络通告相关的问题都应该触发此 skill。
---

# MetalLB 运维助手

帮助用户在 Kubernetes 裸金属集群中部署、运维和排查 MetalLB 负载均衡器。

## 概述

MetalLB 为裸金属 Kubernetes 集群提供 LoadBalancer 类型 Service 的实现。云环境中 LoadBalancer 由云厂商提供，裸金属环境需要 MetalLB 来分配和通告外部 IP。

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

### 方式一：Helm 安装（推荐）

```bash
# 添加 Helm 仓库
helm repo add metallb https://metallb.universe.tf
helm repo update

# 安装到 metallb-system namespace
helm install metallb metallb/metallb --namespace metallb-system --create-namespace

# 等待 Pod 就绪
kubectl wait --namespace metallb-system \
  --for=condition=ready pod \
  --selector=app.kubernetes.io/name=metallb \
  --timeout=120s
```

### 方式二：Manifest 安装

```bash
# 安装 MetalLB（使用最新稳定版）
kubectl apply -f https://raw.githubusercontent.com/metallb/metallb/v0.14.9/config/manifests/metallb-native.yaml

# 等待 Pod 就绪
kubectl wait --namespace metallb-system \
  --for=condition=ready pod \
  --selector=app.kubernetes.io/name=metallb \
  --timeout=120s
```

### 配置 L2 模式

L2 模式需要两个资源：`IPAddressPool` + `L2Advertisement`。

```yaml
# 1. 创建 IP 地址池
apiVersion: metallb.io/v1beta1
kind: IPAddressPool
metadata:
  name: default-pool
  namespace: metallb-system
spec:
  addresses:
    - 192.168.1.240-192.168.1.250    # IP 范围
    # - 10.0.0.0/24                  # 也支持 CIDR 格式
    # - fc00:f853:0ccd:e799::/124    # 支持 IPv6
---
# 2. 创建 L2 通告
apiVersion: metallb.io/v1beta1
kind: L2Advertisement
metadata:
  name: default-l2adv
  namespace: metallb-system
spec:
  ipAddressPools:
    - default-pool               # 关联的 IP 池名称
  # nodeSelectors:               # 可选：限制 speaker 通告的节点
  #   - matchLabels:
  #       kubernetes.io/os: linux
```

应用配置：

```bash
kubectl apply -f metallb-l2-config.yaml
```

### 配置 BGP 模式

BGP 模式需要三个资源：`IPAddressPool` + `BGPPeer` + `BGPAdvertisement`。

```yaml
# 1. IP 地址池（同 L2）
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
  myASN: 64500           # 集群 ASN
  peerASN: 64501          # 路由器 ASN
  peerAddress: 10.0.0.1   # 路由器 IP
  # peerPort: 179         # BGP 端口（默认 179）
  # holdTime: 90s         # Hold timer
  # keepaliveTime: 30s    # Keepalive timer
  # nodeSelectors:        # 限定哪些节点与此路由器建立 BGP
  #   - matchLabels:
  #       rack: rack-1
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
  # localPref: 100        # LOCAL_PREF 属性
  # communities:          # BGP Community
  #   - 64500:100
  # aggregationLength: 32 # 路由聚合长度
```

### 配置混合模式（L2 + BGP）

同一个 IP 池可以同时通过 L2 和 BGP 通告：

```yaml
apiVersion: metallb.io/v1beta1
kind: IPAddressPool
metadata:
  name: hybrid-pool
  namespace: metallb-system
spec:
  addresses:
    - 192.168.1.240-192.168.1.250
---
apiVersion: metallb.io/v1beta1
kind: L2Advertisement
metadata:
  name: hybrid-l2
  namespace: metallb-system
spec:
  ipAddressPools:
    - hybrid-pool
---
apiVersion: metallb.io/v1beta1
kind: BGPAdvertisement
metadata:
  name: hybrid-bgp
  namespace: metallb-system
spec:
  ipAddressPools:
    - hybrid-pool
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

### Service 指定 IP 池

通过注解让 Service 从特定池分配 IP：

```yaml
apiVersion: v1
kind: Service
metadata:
  name: my-service
  annotations:
    metallb.universe.tf/address-pool: bgp-pool      # 指定 IP 池
    # metallb.universe.tf/loadBalancerIPs: 192.168.1.241  # 指定具体 IP
spec:
  type: LoadBalancer
  # loadBalancerIP: 192.168.1.241   # 也可通过 spec 字段指定具体 IP
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
      targetPort: 8080
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
      targetPort: 5353
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

指定 namespace：

```bash
node scripts/metallb-diag.js --namespace metallb-system
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

# 检查某个节点的 speaker
kubectl logs -n metallb-system -l app.kubernetes.io/component=speaker --field-selector spec.nodeName=<node-name> --tail=50
```

#### 查看 IP 分配情况

```bash
# 查看所有 IPAddressPool
kubectl get ipaddresspools -n metallb-system -o wide

# 查看 IPAddressPool 详情
kubectl describe ipaddresspool -n metallb-system <pool-name>

# 查看所有 LoadBalancer Service 及其 ExternalIP
kubectl get svc -A --field-selector spec.type=LoadBalancer

# 查看 Service 事件（包含 IP 分配信息）
kubectl describe svc <service-name> -n <namespace>
```

#### L2 模式状态

```bash
# 查看 L2Advertisement
kubectl get l2advertisements -n metallb-system -o yaml

# 查看哪个节点在响应 ARP（通过 speaker 日志）
kubectl logs -n metallb-system -l app.kubernetes.io/component=speaker --tail=100 | grep -i "arp\|announce\|leader"

# 从集群外检查 ARP
arp -a | grep <external-ip>
```

#### BGP 模式状态

```bash
# 查看 BGPPeer 配置
kubectl get bgppeers -n metallb-system -o yaml

# 查看 BGPAdvertisement
kubectl get bgpadvertisements -n metallb-system -o yaml

# 查看 BFDProfile
kubectl get bfdprofiles -n metallb-system -o yaml

# 检查 BGP 会话状态（通过 speaker 日志）
kubectl logs -n metallb-system -l app.kubernetes.io/component=speaker --tail=100 | grep -i "bgp\|peer\|session"
```

#### 管理 IP 池

```bash
# 添加新的 IP 池
kubectl apply -f - <<EOF
apiVersion: metallb.io/v1beta1
kind: IPAddressPool
metadata:
  name: new-pool
  namespace: metallb-system
spec:
  addresses:
    - 10.0.100.0/28
EOF

# 扩展现有池（编辑 addresses 列表）
kubectl edit ipaddresspool -n metallb-system <pool-name>

# 删除 IP 池（注意：已分配的 IP 不会立即回收）
kubectl delete ipaddresspool -n metallb-system <pool-name>
```

#### 配置验证

```bash
# 检查 MetalLB CRD 是否已安装
kubectl get crd | grep metallb

# 验证 webhook 是否正常（MetalLB 使用 validating webhook）
kubectl get validatingwebhookconfigurations | grep metallb

# 检查 MetalLB 版本
kubectl get deploy -n metallb-system controller -o jsonpath='{.spec.template.spec.containers[0].image}'
```

## 故障排查

### 症状 1：Service 一直 Pending，没有 ExternalIP

**排查流程：**

1. **检查 MetalLB 是否安装并运行**
   ```bash
   kubectl get pods -n metallb-system
   ```
   - 如果没有 Pod → MetalLB 未安装，参考部署指南
   - 如果 Pod 不是 Running → 检查 Pod 事件和日志

2. **检查是否配置了 IPAddressPool**
   ```bash
   kubectl get ipaddresspools -n metallb-system
   ```
   - 如果没有 → 创建 IPAddressPool
   - **注意：IPAddressPool 必须在 `metallb-system` namespace 中**

3. **检查是否配置了 Advertisement**
   ```bash
   kubectl get l2advertisements,bgpadvertisements -n metallb-system
   ```
   - 如果都没有 → 创建 L2Advertisement 或 BGPAdvertisement 关联到 IP 池

4. **检查 IP 池是否已耗尽**
   ```bash
   # 查看已分配的 IP 数
   kubectl get svc -A --field-selector spec.type=LoadBalancer -o jsonpath='{range .items[*]}{.status.loadBalancer.ingress[0].ip}{"\n"}{end}' | sort -u | wc -l
   # 对比 IP 池大小
   kubectl get ipaddresspools -n metallb-system -o yaml
   ```
   - 如果 IP 已耗尽 → 扩展 IP 池或添加新池

5. **检查 controller 日志**
   ```bash
   kubectl logs -n metallb-system -l app.kubernetes.io/component=controller --tail=100
   ```
   - 查找 "no available IPs"、"pool exhausted"、"failed to allocate" 等错误

6. **检查 Webhook 问题**
   ```bash
   kubectl get events -n metallb-system --sort-by='.lastTimestamp'
   ```
   - Webhook 验证失败会阻止配置生效

**常见原因总结：**
- 未创建 IPAddressPool
- 未创建 L2Advertisement/BGPAdvertisement
- IPAddressPool 不在 metallb-system namespace
- IP 池耗尽
- Controller Pod 未就绪

### 症状 2：IP 已分配但从外部不可达

**排查流程：**

1. **确认 IP 确实已分配**
   ```bash
   kubectl get svc <service-name> -n <namespace> -o wide
   ```

2. **L2 模式排查**

   a. 检查 speaker Pod 状态：
   ```bash
   kubectl get pods -n metallb-system -l app.kubernetes.io/component=speaker -o wide
   ```
   - 确保所有节点都有 speaker Pod 在运行

   b. 检查哪个节点是 leader（负责 ARP 应答）：
   ```bash
   kubectl logs -n metallb-system -l app.kubernetes.io/component=speaker --tail=200 | grep -i "leader\|announce"
   ```

   c. 从客户端检查 ARP：
   ```bash
   # 客户端机器上
   arp -d <external-ip> 2>/dev/null; ping -c 1 <external-ip>
   arp -a | grep <external-ip>
   ```
   - 如果无 ARP 响应 → speaker 未正常工作或网络隔离

   d. 检查节点网络：
   ```bash
   # 确认 leader 节点上的网络接口
   kubectl exec -n metallb-system <speaker-pod> -- ip addr
   ```

3. **BGP 模式排查**

   a. 检查 BGP 会话：
   ```bash
   kubectl logs -n metallb-system -l app.kubernetes.io/component=speaker --tail=200 | grep -i "bgp\|session\|established\|connect"
   ```
   - "session established" → 正常
   - "connection refused" / "timeout" → 路由器端问题

   b. 在路由器上确认：
   - BGP 邻居是否建立
   - 是否收到了路由通告
   - 路由表中是否有 Service IP 的路由

   c. 检查防火墙：
   ```bash
   # 确认 BGP 端口（TCP 179）可达
   kubectl exec -n metallb-system <speaker-pod> -- nc -zv <router-ip> 179
   ```

4. **通用排查**

   a. 检查 Service 的 Endpoints：
   ```bash
   kubectl get endpoints <service-name> -n <namespace>
   ```
   - 如果没有 endpoints → 后端 Pod 未就绪或 selector 不匹配

   b. 检查 kube-proxy：
   ```bash
   # 在节点上检查 iptables/ipvs 规则
   kubectl get pods -n kube-system -l k8s-app=kube-proxy
   ```

   c. 检查节点防火墙规则是否阻止了流量

### 症状 3：BGP 对等体连接失败

**排查流程：**

1. **检查配置**
   ```bash
   kubectl get bgppeers -n metallb-system -o yaml
   ```
   - `myASN` 和 `peerASN` 是否正确
   - `peerAddress` 是否可达
   - `peerPort` 是否正确（默认 179）

2. **检查网络连通性**
   ```bash
   # 从 speaker Pod 测试到路由器的连通性
   kubectl exec -n metallb-system <speaker-pod> -- ping -c 3 <router-ip>
   kubectl exec -n metallb-system <speaker-pod> -- nc -zv <router-ip> 179
   ```

3. **检查 speaker 日志**
   ```bash
   kubectl logs -n metallb-system -l app.kubernetes.io/component=speaker --tail=200 | grep -i "bgp\|peer\|error\|fail"
   ```
   - "connection refused" → 路由器未监听 BGP 或防火墙阻止
   - "ASN mismatch" → ASN 配置不一致
   - "hold timer expired" → 网络不稳定或路由器负载过高

4. **路由器侧检查**
   - 确认 BGP 邻居配置中包含集群节点 IP
   - 确认 ASN 号与 MetalLB 配置匹配
   - 确认路由器的 BGP 进程正在运行
   - 检查路由器日志中的 BGP 错误

5. **nodeSelector 问题**
   ```bash
   kubectl get bgppeers -n metallb-system -o jsonpath='{.items[*].spec.nodeSelectors}'
   ```
   - 如果配置了 nodeSelector，确认有节点匹配

### 症状 4：L2 模式 ARP 问题

**排查流程：**

1. **确认 L2 模式配置**
   ```bash
   kubectl get l2advertisements -n metallb-system -o yaml
   ```

2. **查找 ARP 通告节点**
   ```bash
   kubectl logs -n metallb-system -l app.kubernetes.io/component=speaker --tail=200 | grep -E "arp|gratuitous|announce|leader"
   ```

3. **客户端 ARP 排查**
   ```bash
   # 清除客户端 ARP 缓存后重试
   # Linux
   ip neigh del <external-ip> dev <interface>
   # macOS
   arp -d <external-ip>
   # 然后 ping
   ping -c 3 <external-ip>
   # 查看 ARP 表
   arp -a | grep <external-ip>
   ```

4. **网络交换机问题**
   - 某些交换机有 ARP 过滤或安全策略
   - 检查 DHCP snooping、Dynamic ARP Inspection (DAI) 等安全特性
   - 确认交换机允许 Gratuitous ARP

5. **多网卡环境**
   - Speaker 可能在错误的网卡上通告 ARP
   - 使用 `interfaces` 字段限制通告接口：
   ```yaml
   apiVersion: metallb.io/v1beta1
   kind: L2Advertisement
   metadata:
     name: l2adv
     namespace: metallb-system
   spec:
     ipAddressPools:
       - default-pool
     interfaces:
       - eth0          # 只在 eth0 上通告
   ```

### 症状 5：Speaker Pod 异常

**排查流程：**

1. **检查 Pod 状态**
   ```bash
   kubectl get pods -n metallb-system -l app.kubernetes.io/component=speaker -o wide
   kubectl describe pod -n metallb-system <speaker-pod>
   ```

2. **常见问题**

   - **CrashLoopBackOff**：
     ```bash
     kubectl logs -n metallb-system <speaker-pod> --previous
     ```
     - 权限不足 → 检查 SecurityContext 和 RBAC
     - 配置错误 → 检查 ConfigMap 或 CRD 配置

   - **Speaker 未调度到某些节点**：
     ```bash
     kubectl get nodes -o wide
     kubectl describe daemonset -n metallb-system speaker
     ```
     - 检查 nodeSelector、tolerations 是否匹配
     - master/control-plane 节点需要 toleration

   - **Memberlist 错误**（speaker 间通信失败）：
     ```bash
     kubectl logs -n metallb-system <speaker-pod> --tail=100 | grep -i "memberlist\|join\|member"
     ```
     - 确认节点间 7946 端口（TCP+UDP）已放行

3. **资源不足**
   ```bash
   kubectl top pod -n metallb-system
   ```

### 症状 6：Failover 延迟或连接中断

**L2 模式 Failover：**

- 切换时间取决于客户端 ARP 缓存超时
- MetalLB 会发送 Gratuitous ARP，但某些客户端/交换机可能不处理
- 改善方法：
  - 减少客户端 ARP 缓存超时
  - 确保网络设备支持 Gratuitous ARP

**BGP 模式 Failover：**

- 默认故障检测依赖 BGP Hold Timer（默认 90s）
- 改善方法：
  1. 启用 BFD 缩短检测时间到毫秒级
  2. 减小 `holdTime`（但不建议低于 9s）
  3. 注意：节点故障时活跃连接可能中断（路由器 ECMP 哈希表重算）

**连接中断是 BGP 模式已知限制：**
- 当 ECMP 路径数变化时，路由器的哈希算法会重新分配流量
- 这可能导致现有连接被分发到不同的节点
- 无状态服务不受影响，有状态长连接需要应用层重连机制

## 版本升级

### Helm 升级

```bash
helm repo update
helm upgrade metallb metallb/metallb --namespace metallb-system
```

### Manifest 升级

```bash
kubectl apply -f https://raw.githubusercontent.com/metallb/metallb/v<新版本>/config/manifests/metallb-native.yaml
```

### 升级注意事项

- 升级前备份所有 MetalLB CRD 资源配置
- 检查新版本的 Breaking Changes
- v0.13+ 从 ConfigMap 配置迁移到 CRD 配置
- 升级过程中 LoadBalancer Service 会短暂中断（speaker 重启）
- 建议在维护窗口内操作

## 卸载

```bash
# Helm 安装的
helm uninstall metallb --namespace metallb-system

# Manifest 安装的
kubectl delete -f https://raw.githubusercontent.com/metallb/metallb/v<版本>/config/manifests/metallb-native.yaml

# 清理 CRD（如果需要完全清理）
kubectl delete crd ipaddresspools.metallb.io l2advertisements.metallb.io bgpadvertisements.metallb.io bgppeers.metallb.io bfdprofiles.metallb.io communities.metallb.io

# 清理 namespace
kubectl delete namespace metallb-system
```

## 诊断脚本

### 使用方法

使用 Bash 工具调用诊断脚本快速检查 MetalLB 健康状态：

```bash
cd <skill-directory>/skills/metallb-ops
node scripts/metallb-diag.js [--namespace metallb-system] [--json]
```

参数说明：
- `--namespace`：MetalLB 安装的 namespace（默认 `metallb-system`）
- `--json`：以 JSON 格式输出

脚本会检查：
- MetalLB CRD 安装状态
- Controller 和 Speaker Pod 状态
- IPAddressPool 配置和 IP 使用情况
- L2Advertisement / BGPAdvertisement 配置
- BGPPeer 配置
- LoadBalancer Service 和 ExternalIP 分配情况
- 汇总健康评分和问题列表

### 使用步骤

1. 当用户请求检查 MetalLB 状态时，先运行诊断脚本获取概览
2. 根据诊断结果，针对发现的问题提供具体排查建议
3. 如需深入排查，使用上方"手动检查命令"章节中的命令

## 重要说明

- 所有 MetalLB 配置资源（IPAddressPool、L2Advertisement 等）必须在 MetalLB 安装的 namespace 中创建（默认 `metallb-system`）
- IP 池的地址范围不能与集群节点 IP、Pod CIDR、Service CIDR 冲突
- L2 模式下分配的 IP 必须与节点在同一个二层网络
- BGP 模式需要路由器侧同步配置
- 多个 IP 池可以共存，通过 annotation 指定 Service 使用哪个池
- MetalLB v0.13+ 使用 CRD 配置，旧版本使用 ConfigMap（已废弃）

## 参考文档

详细的 CRD API 参考和版本兼容信息请参考：[references/TECHNICAL_SPECS.md](references/TECHNICAL_SPECS.md)
