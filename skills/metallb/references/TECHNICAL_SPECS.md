# MetalLB 技术参考

## CRD API 参考

### IPAddressPool (metallb.io/v1beta1)

定义 MetalLB 可分配的 IP 地址范围。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `spec.addresses` | []string | 是 | IP 地址范围列表，支持 CIDR（`10.0.0.0/24`）和范围（`10.0.0.1-10.0.0.10`）格式，支持 IPv4 和 IPv6 |
| `spec.autoAssign` | bool | 否 | 是否自动分配给未指定池的 Service（默认 `true`） |
| `spec.avoidBuggyIPs` | bool | 否 | 避免分配 `.0` 和 `.255` 结尾的 IP（默认 `false`） |
| `spec.serviceAllocation` | object | 否 | 细粒度的 Service 分配策略 |
| `spec.serviceAllocation.priority` | int | 否 | 池优先级，数字越小越优先 |
| `spec.serviceAllocation.namespaces` | []string | 否 | 限定可使用此池的 namespace |
| `spec.serviceAllocation.namespaceSelectors` | []LabelSelector | 否 | 基于标签选择可使用此池的 namespace |
| `spec.serviceAllocation.serviceSelectors` | []LabelSelector | 否 | 基于标签选择可使用此池的 Service |

### L2Advertisement (metallb.io/v1beta1)

配置 Layer 2 模式的 IP 通告。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `spec.ipAddressPools` | []string | 否 | 关联的 IPAddressPool 名称列表（空=所有池） |
| `spec.ipAddressPoolSelectors` | []LabelSelector | 否 | 基于标签选择关联的 IPAddressPool |
| `spec.nodeSelectors` | []LabelSelector | 否 | 限制通告 ARP/NDP 的节点 |
| `spec.interfaces` | []string | 否 | 限制通告的网络接口（v0.13.10+） |

### BGPAdvertisement (metallb.io/v1beta1)

配置 BGP 模式的路由通告。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `spec.ipAddressPools` | []string | 否 | 关联的 IPAddressPool 名称列表（空=所有池） |
| `spec.ipAddressPoolSelectors` | []LabelSelector | 否 | 基于标签选择关联的 IPAddressPool |
| `spec.nodeSelectors` | []LabelSelector | 否 | 限制通告路由的节点 |
| `spec.aggregationLength` | int | 否 | IPv4 路由聚合前缀长度（默认 32，即 /32 主机路由） |
| `spec.aggregationLengthV6` | int | 否 | IPv6 路由聚合前缀长度（默认 128） |
| `spec.localPref` | uint32 | 否 | BGP LOCAL_PREF 属性 |
| `spec.communities` | []string | 否 | BGP Community 列表 |
| `spec.peers` | []string | 否 | 限定通告路由的 BGPPeer 名称列表（空=所有 Peer） |

### BGPPeer (metallb.io/v1beta1)

配置 BGP 对等体（路由器）连接参数。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `spec.myASN` | uint32 | 是 | 集群的 ASN 号（MetalLB 端） |
| `spec.peerASN` | uint32 | 是 | 路由器的 ASN 号 |
| `spec.peerAddress` | string | 是 | 路由器 IP 地址 |
| `spec.peerPort` | uint16 | 否 | BGP 端口（默认 179） |
| `spec.sourceAddress` | string | 否 | 建立 BGP 连接时使用的源 IP |
| `spec.holdTime` | duration | 否 | BGP Hold Timer（默认 90s） |
| `spec.keepaliveTime` | duration | 否 | BGP Keepalive Timer（默认 holdTime/3） |
| `spec.routerID` | string | 否 | BGP Router ID |
| `spec.nodeSelectors` | []LabelSelector | 否 | 限定与此 Peer 建立 BGP 会话的节点 |
| `spec.password` | string | 否 | BGP MD5 认证密码 |
| `spec.passwordSecret` | SecretRef | 否 | 引用 Secret 中的 BGP 密码 |
| `spec.bfdProfile` | string | 否 | 关联的 BFDProfile 名称 |
| `spec.ebgpMultiHop` | bool | 否 | 是否启用 eBGP Multi-Hop（默认 false） |
| `spec.vrf` | string | 否 | VRF 实例名称（FRR 模式） |

### BFDProfile (metallb.io/v1beta1)

配置 BFD（Bidirectional Forwarding Detection）快速故障检测。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `spec.receiveInterval` | uint32 | 否 | BFD 报文接收间隔（毫秒，默认 300） |
| `spec.transmitInterval` | uint32 | 否 | BFD 报文发送间隔（毫秒，默认 300） |
| `spec.detectMultiplier` | uint32 | 否 | 检测倍数（默认 3，即 3 次丢包后判定故障） |
| `spec.echoInterval` | uint32 | 否 | Echo 模式间隔（毫秒，默认 50） |
| `spec.echoMode` | bool | 否 | 是否启用 Echo 模式（默认 false） |
| `spec.passiveMode` | bool | 否 | 是否为被动模式（默认 false） |
| `spec.minimumTtl` | uint32 | 否 | 最小 TTL 值（默认 254） |

### Community (metallb.io/v1beta1)

定义可在 BGPAdvertisement 中引用的 BGP Community 别名。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `spec.communities` | []CommunityAlias | 是 | Community 别名列表 |
| `spec.communities[].name` | string | 是 | 别名（在 BGPAdvertisement 中引用） |
| `spec.communities[].value` | string | 是 | Community 值（如 `64500:100` 或 `large:64500:100:200`） |

## Service 注解

| 注解 | 说明 |
|------|------|
| `metallb.universe.tf/address-pool` | 指定 Service 使用的 IP 池名称 |
| `metallb.universe.tf/loadBalancerIPs` | 指定具体的 IP 地址（逗号分隔支持多个） |
| `metallb.universe.tf/allow-shared-ip` | 允许多个 Service 共享同一 IP（相同 key 值的 Service 共享） |
| `metallb.universe.tf/ip-allocated-from-pool` | 系统注解，标记 IP 分配来源的池（只读） |

## 版本兼容性

| MetalLB 版本 | Kubernetes 最低版本 | 配置方式 | 备注 |
|-------------|-------------------|---------|------|
| v0.14.x | 1.25+ | CRD | 当前推荐版本 |
| v0.13.x | 1.20+ | CRD | 首个 CRD 配置版本 |
| v0.12.x | 1.13+ | ConfigMap | 已废弃 |
| v0.11.x | 1.13+ | ConfigMap | 已废弃 |

### 从 ConfigMap 迁移到 CRD

MetalLB v0.13+ 不再支持 ConfigMap 配置。迁移方法：

```bash
# 导出现有 ConfigMap 配置
kubectl get configmap -n metallb-system config -o yaml > metallb-config-backup.yaml

# 使用官方迁移工具转换
# 参考：https://metallb.universe.tf/configuration/migration_to_crds/
```

## 网络要求

### L2 模式

| 要求 | 说明 |
|------|------|
| 网络拓扑 | IP 池地址必须与节点在同一个二层广播域 |
| ARP/NDP | 网络必须允许 Gratuitous ARP（IPv4）或 Unsolicited Neighbor Advertisement（IPv6） |
| 交换机 | 不能开启 ARP 过滤（DAI）或严格的 DHCP Snooping |
| 带宽 | 所有流量通过单个 leader 节点，受限于该节点网卡带宽 |

### BGP 模式

| 要求 | 说明 |
|------|------|
| 路由器 | 需要支持 BGP 的路由器，通常为三层交���机或软路由 |
| ASN | 需要为集群和路由器分配 ASN 号（私有 ASN 范围：64512-65534） |
| 端口 | TCP 179 必须在节点和路由器间双向放行 |
| ECMP | 路由器需支持 Equal-Cost Multi-Path 以实现多节点负载分发 |
| BFD（可选） | 路由器需支持 BFD 以启用快速故障检测 |

### Speaker 间通信

| 端口 | 协议 | 说明 |
|------|------|------|
| 7946 | TCP+UDP | Memberlist（speaker 间选举和状态同步） |
| 7472 | TCP | MetalLB metrics |

## 已知限制

### L2 模式

1. **单点瓶颈**：每个 Service IP 只有一个节点响应 ARP，所有外部流量先到该节点
2. **故障切换延迟**：依赖客户端 ARP 缓存超时，通常秒级
3. **无法跨子网**：IP 池地址必须与客户端在同一二层网络

### BGP 模式

1. **有状态连接中断**：节点故障时 ECMP 哈希表重算导致已有连接被重新分配
2. **路由器依赖**：需要路由器侧配置，运维复杂度高
3. **会话建立时间**：BGP 会话建立需要时间，不适合频繁变化的环境

### 通用限制

1. **不支持 DSR**：MetalLB 不支持 Direct Server Return
2. **IPv6 限制**：某些功能在 IPv6 下不完全支持
3. **单集群**：MetalLB 设计为单集群使用，多集群需独立部署，IP 池不能重叠

## 常用 ASN 范围

| 范围 | 类型 | 说明 |
|------|------|------|
| 64512-65534 | 私有 2 字节 ASN | 推荐用于内部网络 |
| 4200000000-4294967294 | 私有 4 字节 ASN | 大型网络使用 |
| 1-64511 | 公共 2 字节 ASN | 需向 RIR 申请 |
