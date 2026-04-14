---
name: cilium-ops
description: Cilium CNI 的部署、运维和故障排查。当用户提到 Cilium、eBPF CNI、Hubble、CiliumNetworkPolicy、CiliumClusterwideNetworkPolicy、kube-proxy 替代、Cilium BGP、Cilium L2、Cilium Gateway API、Cilium Service Mesh、ClusterMesh、WireGuard 加密、IPsec 加密、Bandwidth Manager、Host Routing、eBPF 数据面、cilium-agent、cilium-operator、cilium connectivity test、Cilium Ingress、Cilium LoadBalancer、Cilium IPAM、CiliumBGPPeeringPolicy、CiliumLoadBalancerIPPool、CiliumL2AnnouncementPolicy 时使用此 skill。即使用户没有明确说"Cilium"，只要涉及 Kubernetes eBPF 网络、高性能 CNI、网络策略可视化、透明加密、Service Mesh without sidecar 相关的问题都应该触发此 skill。
---

# Cilium 运维助手

帮助用户在 Kubernetes 集群中部署、运维和排查 Cilium CNI 及其生态组件。

## 概述

Cilium 是基于 eBPF 的 Kubernetes CNI 插件，提供网络连接、安全策略、可观测性和负载均衡。相比传统 iptables 方案，Cilium 的 eBPF 数据面提供更高性能和更细粒度的控制。

### 核心组件

| 组件 | 类型 | 功能 |
|------|------|------|
| **cilium-agent** | DaemonSet | 运行在每个节点，管理 eBPF 程序，处理网络策略和负载均衡 |
| **cilium-operator** | Deployment | 集群级操作，如 IPAM 分配、CIDR identity GC、CRD 管理 |
| **Hubble** | 内嵌于 agent | 网络可观测性，提供流量日志、Service Map |
| **Hubble Relay** | Deployment | 聚合所有节点的 Hubble 数据 |
| **Hubble UI** | Deployment | 可视化界面（可选） |

### 关键特性

| 特性 | 说明 |
|------|------|
| **kube-proxy 替代** | 完全替代 kube-proxy，用 eBPF 实现 Service 负载均衡 |
| **Host Routing** | 绕过 iptables，eBPF 直接路由，减少延迟 |
| **Bandwidth Manager** | 基于 EDT (Earliest Departure Time) 的带宽限速 |
| **WireGuard / IPsec** | 透明的节点间流量加密 |
| **Gateway API** | 原生支持 Kubernetes Gateway API |
| **ClusterMesh** | 多集群互联 |
| **BGP Control Plane** | 原生 BGP 路由通告 |
| **L2 Announcements** | 二层 ARP 通告（类似 MetalLB L2 模式） |

## 部署指南

### 前置条件

- Kubernetes 1.21+（推荐 1.25+）
- Linux 内核 >= 5.4（推荐 5.10+，完整 eBPF 特性需要 5.10+）
- 如果替代 kube-proxy，需在安装前移除或禁用 kube-proxy
- 节点需支持 eBPF（大部分主流发行版默认支持）

### 安装 Cilium CLI

```bash
CILIUM_CLI_VERSION=$(curl -s https://raw.githubusercontent.com/cilium/cilium-cli/main/stable.txt)
CLI_ARCH=amd64
if [ "$(uname -m)" = "aarch64" ]; then CLI_ARCH=arm64; fi
curl -L --fail --remote-name-all \
  "https://github.com/cilium/cilium-cli/releases/download/${CILIUM_CLI_VERSION}/cilium-linux-${CLI_ARCH}.tar.gz{,.sha256sum}"
sha256sum --check cilium-linux-${CLI_ARCH}.tar.gz.sha256sum
sudo tar xzvfC cilium-linux-${CLI_ARCH}.tar.gz /usr/local/bin
rm cilium-linux-${CLI_ARCH}.tar.gz{,.sha256sum}
```

### 方式一：Cilium CLI 安装（推荐）

```bash
# 基础安装
cilium install

# 替代 kube-proxy 安装
cilium install --set kubeProxyReplacement=true

# 启用 Hubble
cilium hubble enable --ui

# 等待就绪
cilium status --wait
```

### 方式二：Helm 安装

```bash
helm repo add cilium https://helm.cilium.io/
helm repo update

# 基础安装
helm install cilium cilium/cilium --version 1.16.5 \
  --namespace kube-system \
  --set operator.replicas=2

# 高性能安装（替代 kube-proxy + host routing + bandwidth manager）
helm install cilium cilium/cilium --version 1.16.5 \
  --namespace kube-system \
  --set kubeProxyReplacement=true \
  --set k8sServiceHost=<API_SERVER_IP> \
  --set k8sServicePort=<API_SERVER_PORT> \
  --set bpf.masquerade=true \
  --set routingMode=native \
  --set ipv4NativeRoutingCIDR=<POD_CIDR> \
  --set autoDirectNodeRoutes=true \
  --set bandwidthManager.enabled=true \
  --set hubble.relay.enabled=true \
  --set hubble.ui.enabled=true \
  --set operator.replicas=2

# 等待就绪
kubectl -n kube-system rollout status daemonset/cilium --timeout=300s
kubectl -n kube-system rollout status deployment/cilium-operator --timeout=300s
```

### 启用 WireGuard 加密

```bash
helm upgrade cilium cilium/cilium --namespace kube-system \
  --reuse-values \
  --set encryption.enabled=true \
  --set encryption.type=wireguard
```

### 启用 IPsec 加密

```bash
# 先生成 IPsec 密钥
kubectl create -n kube-system secret generic cilium-ipsec-keys \
  --from-literal=keys="3+ rfc4106(gcm(aes)) $(dd if=/dev/urandom count=20 bs=1 2>/dev/null | xxd -p -c 40) 128"

helm upgrade cilium cilium/cilium --namespace kube-system \
  --reuse-values \
  --set encryption.enabled=true \
  --set encryption.type=ipsec
```

### 移除 kube-proxy（替代模式下）

安装 Cilium 并启用 `kubeProxyReplacement=true` 后：

```bash
# 删除 kube-proxy DaemonSet
kubectl -n kube-system delete ds kube-proxy

# 清理 kube-proxy 遗留的 iptables 规则
kubectl -n kube-system exec ds/cilium -- cilium-dbg cleanup -f
```

## 网络策略

### CiliumNetworkPolicy（命名空间级）

```yaml
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: allow-http
  namespace: default
spec:
  endpointSelector:
    matchLabels:
      app: myapp
  ingress:
    - fromEndpoints:
        - matchLabels:
            app: frontend
      toPorts:
        - ports:
            - port: "80"
              protocol: TCP
  egress:
    - toEndpoints:
        - matchLabels:
            app: database
      toPorts:
        - ports:
            - port: "3306"
              protocol: TCP
    - toFQDNs:
        - matchName: api.example.com
      toPorts:
        - ports:
            - port: "443"
              protocol: TCP
```

### CiliumClusterwideNetworkPolicy（集群级）

```yaml
apiVersion: cilium.io/v2
kind: CiliumClusterwideNetworkPolicy
metadata:
  name: deny-external-by-default
spec:
  endpointSelector: {}
  egress:
    - toEntities:
        - cluster
        - kube-apiserver
    - toCIDR:
        - 10.0.0.0/8
```

### L7 策略（HTTP 层过滤）

```yaml
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: l7-rule
  namespace: default
spec:
  endpointSelector:
    matchLabels:
      app: api-server
  ingress:
    - fromEndpoints:
        - matchLabels:
            app: frontend
      toPorts:
        - ports:
            - port: "80"
              protocol: TCP
          rules:
            http:
              - method: GET
                path: "/api/v1/.*"
              - method: POST
                path: "/api/v1/submit"
```

## BGP Control Plane

### 配置 BGP 对等体

```yaml
apiVersion: cilium.io/v2alpha1
kind: CiliumBGPPeeringPolicy
metadata:
  name: bgp-peering
spec:
  nodeSelector:
    matchLabels:
      bgp-policy: active
  virtualRouters:
    - localASN: 64512
      exportPodCIDR: true
      neighbors:
        - peerAddress: "10.0.0.1/32"
          peerASN: 64501
          # eBGP multihop
          # eBGPMultihopTTL: 2
          # graceful restart
          gracefulRestart:
            enabled: true
            restartTimeSeconds: 120
      serviceSelector:
        matchExpressions:
          - key: cilium.io/bgp-announce
            operator: In
            values:
              - "true"
```

### BGP + LoadBalancer IP 池

```yaml
apiVersion: cilium.io/v2alpha1
kind: CiliumLoadBalancerIPPool
metadata:
  name: bgp-pool
spec:
  blocks:
    - cidr: "203.0.113.0/24"
---
apiVersion: v1
kind: Service
metadata:
  name: my-service
  labels:
    cilium.io/bgp-announce: "true"
spec:
  type: LoadBalancer
  ports:
    - port: 80
      targetPort: 8080
  selector:
    app: my-app
```

## L2 Announcements

### 配置 L2 通告（类似 MetalLB L2 模式）

```yaml
apiVersion: cilium.io/v2alpha1
kind: CiliumL2AnnouncementPolicy
metadata:
  name: l2-policy
spec:
  # 选择哪些节点参与 L2 通告
  nodeSelector:
    matchExpressions:
      - key: node-role.kubernetes.io/control-plane
        operator: DoesNotExist
  # 选择哪些 Service 参与
  serviceSelector:
    matchLabels:
      l2-announce: "true"
  # 通告的网卡接口（可选，默认所有接口）
  interfaces:
    - ^eth[0-9]+
  # ExternalIP 也通告
  externalIPs: true
  # LoadBalancer IP 通告
  loadBalancerIPs: true
---
apiVersion: cilium.io/v2alpha1
kind: CiliumLoadBalancerIPPool
metadata:
  name: l2-pool
spec:
  blocks:
    - cidr: "192.168.1.240/28"
```

启用 L2 通告需要 Helm 参数：

```bash
helm upgrade cilium cilium/cilium --namespace kube-system \
  --reuse-values \
  --set l2announcements.enabled=true \
  --set externalIPs.enabled=true
```

## Gateway API

### 启用 Gateway API 支持

```bash
# 安装 Gateway API CRDs
kubectl apply -f https://raw.githubusercontent.com/kubernetes-sigs/gateway-api/v1.1.0/config/crd/standard/gateway.networking.k8s.io_gatewayclasses.yaml
kubectl apply -f https://raw.githubusercontent.com/kubernetes-sigs/gateway-api/v1.1.0/config/crd/standard/gateway.networking.k8s.io_gateways.yaml
kubectl apply -f https://raw.githubusercontent.com/kubernetes-sigs/gateway-api/v1.1.0/config/crd/standard/gateway.networking.k8s.io_httproutes.yaml
kubectl apply -f https://raw.githubusercontent.com/kubernetes-sigs/gateway-api/v1.1.0/config/crd/standard/gateway.networking.k8s.io_referencegrants.yaml

# 启用 Cilium Gateway API
helm upgrade cilium cilium/cilium --namespace kube-system \
  --reuse-values \
  --set gatewayAPI.enabled=true
```

### 配置 Gateway

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: GatewayClass
metadata:
  name: cilium
spec:
  controllerName: io.cilium/gateway-controller
---
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: my-gateway
  namespace: default
spec:
  gatewayClassName: cilium
  listeners:
    - name: http
      protocol: HTTP
      port: 80
    - name: https
      protocol: HTTPS
      port: 443
      tls:
        mode: Terminate
        certificateRefs:
          - name: my-tls-secret
---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: my-route
  namespace: default
spec:
  parentRefs:
    - name: my-gateway
  hostnames:
    - "app.example.com"
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /api
      backendRefs:
        - name: api-service
          port: 80
    - matches:
        - path:
            type: PathPrefix
            value: /
      backendRefs:
        - name: frontend-service
          port: 80
```

## ClusterMesh（多集群互联）

### 前置条件

- 每个集群必须有唯一的 cluster-id（1-255）
- 每个集群的 PodCIDR 不能重叠
- 集群间需要网络可达（至少 cilium-agent 之间）

### 启用 ClusterMesh

```bash
# 集群 1
cilium clustermesh enable --context cluster1 --service-type LoadBalancer
# 集群 2
cilium clustermesh enable --context cluster2 --service-type LoadBalancer

# 连接集群
cilium clustermesh connect --context cluster1 --destination-context cluster2

# 检查状态
cilium clustermesh status --context cluster1
```

### 跨集群服务发现

在两个集群中创建同名 Service 并添加注解：

```yaml
apiVersion: v1
kind: Service
metadata:
  name: my-global-service
  annotations:
    service.cilium.io/global: "true"
    # 可选：是否也使用本集群后端
    service.cilium.io/shared: "true"
spec:
  type: ClusterIP
  ports:
    - port: 80
  selector:
    app: my-app
```

## 运维操作

### 日常巡检

使用诊断脚本快速检查 Cilium 集群状态：

```bash
node scripts/cilium-diag.js
```

加 `--json` 参数可输出 JSON 格式：

```bash
node scripts/cilium-diag.js --json
```

指定 namespace：

```bash
node scripts/cilium-diag.js --namespace kube-system
```

### 手动检查命令

#### Cilium CLI 检查

```bash
# 整体状态
cilium status

# 连通性测试（创建临时 Pod 测试网络连通性）
cilium connectivity test

# 查看 BPF 程序和 map 状态
cilium-dbg bpf endpoint list
cilium-dbg bpf ct list global
cilium-dbg bpf lb list

# 查看 kube-proxy 替代状态
cilium-dbg status --verbose | grep KubeProxyReplacement

# 查看节点间隧道/路由
cilium-dbg bpf tunnel list
cilium-dbg node list
```

#### kubectl 检查

```bash
# 查看 Cilium Pod 状态
kubectl get pods -n kube-system -l k8s-app=cilium -o wide
kubectl get pods -n kube-system -l app.kubernetes.io/name=cilium-operator -o wide

# 查看 CiliumNode 状态（IPAM 分配）
kubectl get ciliumnodes -o wide

# 查看 CiliumEndpoint（每个 Pod 的 Cilium 端点）
kubectl get ciliumendpoints -A

# 查看 CiliumIdentity（安全标识）
kubectl get ciliumidentities

# 查看 CiliumNetworkPolicy 状态
kubectl get cnp -A
kubectl get ccnp

# 查看 Cilium 版本
kubectl exec -n kube-system ds/cilium -- cilium-dbg version
```

#### Hubble 可观测性

```bash
# 安装 Hubble CLI
HUBBLE_VERSION=$(curl -s https://raw.githubusercontent.com/cilium/hubble/master/stable.txt)
HUBBLE_ARCH=amd64
if [ "$(uname -m)" = "aarch64" ]; then HUBBLE_ARCH=arm64; fi
curl -L --fail --remote-name-all \
  "https://github.com/cilium/hubble/releases/download/$HUBBLE_VERSION/hubble-linux-${HUBBLE_ARCH}.tar.gz{,.sha256sum}"
sha256sum --check hubble-linux-${HUBBLE_ARCH}.tar.gz.sha256sum
sudo tar xzvfC hubble-linux-${HUBBLE_ARCH}.tar.gz /usr/local/bin
rm hubble-linux-${HUBBLE_ARCH}.tar.gz{,.sha256sum}

# 端口转发
cilium hubble port-forward &

# 实时流量观察
hubble observe
hubble observe --namespace default
hubble observe --pod default/myapp --protocol TCP --port 80

# 查看被拒绝的流量（策略 deny）
hubble observe --verdict DROPPED

# 查看特定类型
hubble observe --type drop
hubble observe --type policy-verdict
hubble observe --type l7

# 流量统计
hubble observe --output json | jq -r '.flow.verdict' | sort | uniq -c
```

### 配置热更新

大部分 Cilium 配置支持热更新（通过 `helm upgrade --reuse-values`）：

```bash
# 示例：启用 Hubble
helm upgrade cilium cilium/cilium --namespace kube-system \
  --reuse-values \
  --set hubble.relay.enabled=true \
  --set hubble.ui.enabled=true

# cilium-agent 会自动滚动重启
kubectl -n kube-system rollout status daemonset/cilium --timeout=300s
```

### 版本升级

```bash
# 使用 Cilium CLI
cilium upgrade --version 1.16.5

# 使用 Helm
helm repo update
helm upgrade cilium cilium/cilium --namespace kube-system --version 1.16.5 --reuse-values

# 验证升级
cilium status --wait
cilium connectivity test
```

**升级注意事项：**

- Cilium 支持跨一个次版本升级（如 1.14 → 1.15），不要跳版本
- 升级前阅读 [Upgrade Notes](https://docs.cilium.io/en/stable/operations/upgrade/)
- 升级过程中网络策略保持生效，但短暂中断可能发生
- 建议先升级 Operator，再升级 Agent（Helm 会自动处理顺序）
- 升级前备份 CiliumNetworkPolicy 和 CiliumClusterwideNetworkPolicy

## 故障排查

### 症状 1：Pod 无法通信

**排查流程：**

1. **检查 Cilium Agent 状态**
   ```bash
   cilium status
   kubectl get pods -n kube-system -l k8s-app=cilium -o wide
   ```
   - 确认所有节点的 cilium-agent Pod 都是 Running

2. **检查 Endpoint 状态**
   ```bash
   kubectl get ciliumendpoints -n <namespace>
   kubectl exec -n kube-system <cilium-pod> -- cilium-dbg endpoint list
   ```
   - 确认 Pod 对应的 endpoint 状态为 `ready`
   - 如果 endpoint 状态异常，检查 cilium-agent 日志

3. **运行连通性测试**
   ```bash
   cilium connectivity test
   ```
   - 定位具体哪个测试失败

4. **使用 Hubble 观察流量**
   ```bash
   hubble observe --pod <namespace>/<pod-name> --verdict DROPPED
   ```
   - 查看是否有策略 DROP 或其他原因

5. **检查网络策略**
   ```bash
   kubectl get cnp,ccnp -A
   kubectl exec -n kube-system <cilium-pod> -- cilium-dbg policy get
   ```
   - 确认策略规则是否正确

6. **检查路由/隧道**
   ```bash
   kubectl exec -n kube-system <cilium-pod> -- cilium-dbg bpf tunnel list
   kubectl exec -n kube-system <cilium-pod> -- cilium-dbg node list
   ```

### 症状 2：Service 无法访问

**排查流程：**

1. **确认 kube-proxy 替代是否正常**
   ```bash
   kubectl exec -n kube-system ds/cilium -- cilium-dbg status --verbose | grep KubeProxyReplacement
   ```
   - 如果输出 `Disabled` 但预期是替代模式，检查 Helm values

2. **检查 BPF Service 表**
   ```bash
   kubectl exec -n kube-system ds/cilium -- cilium-dbg bpf lb list
   ```
   - 确认 Service 的 ClusterIP/NodePort/LoadBalancerIP 在 BPF map 中

3. **检查后端 Endpoint**
   ```bash
   kubectl get endpoints <service-name> -n <namespace>
   kubectl exec -n kube-system ds/cilium -- cilium-dbg service list
   ```

4. **检查 NodePort 连通性**
   ```bash
   # 在节点上直接测试
   curl -v http://<node-ip>:<node-port>
   ```

### 症状 3：cilium-agent CrashLoopBackOff

**排查流程：**

1. **查看日志**
   ```bash
   kubectl logs -n kube-system <cilium-pod> --previous --tail=200
   ```

2. **常见原因**
   - **内核版本过低**：Cilium 需要 >= 5.4，部分特性需要 5.10+
     ```bash
     kubectl exec -n kube-system ds/cilium -- uname -r
     ```
   - **BPF 文件系统未挂载**：
     ```bash
     kubectl exec -n kube-system ds/cilium -- mount | grep bpf
     ```
   - **资源不足**：Agent 默认需要较多内存
     ```bash
     kubectl describe pod -n kube-system <cilium-pod> | grep -A 5 Resources
     kubectl top pod -n kube-system -l k8s-app=cilium
     ```
   - **CIDR 冲突**：Pod CIDR 与已有网络冲突
   - **kube-proxy 残留**：替代模式下 kube-proxy 仍在运行导致冲突

3. **检查 ConfigMap**
   ```bash
   kubectl get configmap -n kube-system cilium-config -o yaml
   ```

### 症状 4：网络策略不生效

**排查流程：**

1. **确认策略已被 Cilium 加载**
   ```bash
   kubectl get cnp <policy-name> -n <namespace> -o yaml
   # 检查 status 字段是否有错误
   ```

2. **查看 Endpoint 上的策略**
   ```bash
   kubectl exec -n kube-system <cilium-pod> -- cilium-dbg endpoint list
   kubectl exec -n kube-system <cilium-pod> -- cilium-dbg policy get -n <namespace>
   ```

3. **Hubble 验证策略效果**
   ```bash
   hubble observe --pod <namespace>/<pod-name> --type policy-verdict
   ```
   - `FORWARDED` = 策略允许
   - `DROPPED` = 策略拒绝
   - `AUDIT` = 审计模式（不实际丢包）

4. **常见问题**
   - Label 不匹配：endpoint selector 与 Pod label 不一致
   - 默认行为：无策略时默认允许所有流量，一旦添加 ingress/egress 策略，未明确允许的流量会被拒绝
   - FQDN 策略：需要 DNS proxy 正常工作

### 症状 5：Hubble 无数据

**排查流程：**

1. **确认 Hubble 已启用**
   ```bash
   cilium status | grep Hubble
   kubectl get pods -n kube-system -l app.kubernetes.io/name=hubble-relay
   ```

2. **检查 Hubble Relay**
   ```bash
   kubectl logs -n kube-system -l app.kubernetes.io/name=hubble-relay --tail=50
   ```

3. **直接从 Agent 查询**
   ```bash
   kubectl exec -n kube-system <cilium-pod> -- hubble observe --last 10
   ```
   - 如果 Agent 有数据但 Relay 无数据，说明 Relay 连接问题

4. **检查 Hubble 端口转发**
   ```bash
   cilium hubble port-forward &
   hubble status
   ```

### 症状 6：L2 Announcement / LoadBalancer IP 不工作

**排查流程：**

1. **确认特性已启用**
   ```bash
   kubectl get configmap -n kube-system cilium-config -o yaml | grep -i l2
   ```

2. **检查 CiliumL2AnnouncementPolicy**
   ```bash
   kubectl get ciliuml2announcementpolicies -o yaml
   ```

3. **检查 CiliumLoadBalancerIPPool**
   ```bash
   kubectl get ciliumloadbalancerippools -o yaml
   ```

4. **检查 Service 是否获得 IP**
   ```bash
   kubectl get svc -A --field-selector spec.type=LoadBalancer
   ```

5. **检查 Leases（leader election for L2）**
   ```bash
   kubectl get leases -n kube-system | grep cilium-l2announce
   ```

### 症状 7：BGP 路由通告异常

**排查流程：**

1. **检查 CiliumBGPPeeringPolicy**
   ```bash
   kubectl get ciliumbgppeeringpolicies -o yaml
   ```

2. **检查 BGP 会话状态**
   ```bash
   cilium bgp peers
   ```

3. **检查节点是否匹配 nodeSelector**
   ```bash
   kubectl get nodes --show-labels | grep bgp
   ```

4. **检查 Agent 日志中的 BGP 信息**
   ```bash
   kubectl logs -n kube-system <cilium-pod> --tail=200 | grep -i bgp
   ```

## 卸载

```bash
# 使用 Cilium CLI
cilium uninstall

# 使用 Helm
helm uninstall cilium --namespace kube-system

# 清理 CRD（完全清理）
kubectl get crd -o name | grep cilium | xargs kubectl delete

# 清理 BPF 残留（在每个节点上）
# 注意：这会中断所有 Pod 网络，确保已切换到其他 CNI
sudo rm -rf /var/run/cilium /opt/cni/bin/cilium-cni /etc/cni/net.d/05-cilium.conflist
```

## 诊断脚本

### 使用方法

使用 Bash 工具调用诊断脚本快速检查 Cilium 健康状态：

```bash
cd <skill-directory>/skills/cilium-ops
node scripts/cilium-diag.js [--namespace kube-system] [--json]
```

参数说明：
- `--namespace`：Cilium 安装的 namespace（默认 `kube-system`）
- `--json`：以 JSON 格式输出

脚本会检查：
- Cilium CRD 安装状态
- cilium-agent 和 cilium-operator Pod 状态
- CiliumNode 和 IPAM 分配情况
- CiliumEndpoint 健康状态
- CiliumNetworkPolicy / CiliumClusterwideNetworkPolicy 状态
- Hubble 组件状态
- LoadBalancer Service 和 IP 分配情况
- 汇总健康评分和问题列表

### 使用步骤

1. 当用户请求检查 Cilium 状态时，先运行诊断脚本获取概览
2. 根据诊断结果，针对发现的问题提供具体排查建议
3. 如需深入排查，使用上方"手动检查命令"章节中的命令

## 重要说明

- Cilium 默认安装在 `kube-system` namespace
- 替代 kube-proxy 模式需要在安装时就指定，后期切换需要重新安装
- L2 Announcement 和 BGP Control Plane 是 beta 特性，生产环境需充分测试
- ClusterMesh 要求所有集群使用相同的 Cilium 版本
- WireGuard 加密需要节点内核支持 WireGuard 模块
- Bandwidth Manager 需要 `routingMode=native` 和内核 >= 5.1
- 网络策略从"默认允许"变为"默认拒绝"只在 Pod 有对应方向（ingress/egress）的策略时生效

## 参考文档

- [Cilium 官方文档](https://docs.cilium.io/en/stable/)
- [Cilium 安装指南](https://docs.cilium.io/en/stable/gettingstarted/)
- [Cilium 网络策略](https://docs.cilium.io/en/stable/security/policy/)
- [Cilium BGP Control Plane](https://docs.cilium.io/en/stable/network/bgp-control-plane/)
- [Cilium L2 Announcements](https://docs.cilium.io/en/stable/network/l2-announcements/)
- [Cilium Gateway API](https://docs.cilium.io/en/stable/network/servicemesh/gateway-api/gateway-api/)
- [Cilium ClusterMesh](https://docs.cilium.io/en/stable/network/clustermesh/)
- [Hubble 可观测性](https://docs.cilium.io/en/stable/observability/)
