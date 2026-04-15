---
name: troubleshoot-guide
description: 基础设施故障排错指南。当用户提到故障排查、排错、troubleshoot、debug、问题诊断、服务异常、系统故障、网络故障、存储故障、K8s 故障、Pod 异常、节点故障、容器问题时使用此 skill。即使用户没有明确说"排错"或"故障"，只要涉及系统异常、服务不可用、性能问题、错误排查等相关问题都应该触发此 skill。
---

# 基础设施故障排错指南

帮助用户系统化地排查和解决基础设施故障。提供常见故障分类、排错思路、诊断命令和解决方案，覆盖 Kubernetes、网络、存储、系统等多个领域。

## 工作流程

1. 识别故障类别（K8s / 网络 / 存储 / 系统 / 应用）
2. 收集故障现象和上下文信息
3. 根据故障类别提供排错思路和诊断命令
4. 引导用户逐步排查，定位根因
5. 提供解决方案和预防建议

## 故障类别总览

| 类别 | 常见症状 | 排查优先级 |
|------|----------|-----------|
| **Kubernetes** | Pod 异常、调度失败、服务不通、资源不足 | 高 |
| **网络** | 连通性问题、DNS 解析失败、延迟高、丢包 | 高 |
| **存储** | IO 性能差、挂载失败、空间不足、数据损坏 | 高 |
| **系统** | 负载高、OOM、磁盘满、内核异常 | 中 |
| **应用** | 进程崩溃、性能瓶颈、连接池耗尽、配置错误 | 中 |

## 通用排错方法论

### 排错五步法

1. **定义问题**：明确故障现象，区分「不工作」和「异常表现」
2. **收集信息**：收集日志、指标、事件，确定时间线
3. **分析原因**：从最可能的原因开始排查，逐步缩小范围
4. **验证假设**：用最小变更验证推测的原因
5. **记录复盘**：记录根因和修复过程，防止再次发生

### 黄金法则

- **先看日志再猜原因**：`journalctl`、`kubectl logs`、`/var/log/` 是第一手信息
- **先观察再行动**：在没有理解问题之前，避免做破坏性操作
- **二分法定位**：把问题域一分为二，快速缩小范围
- **最近变更优先**：大多数故障和最近的变更相关，先查看最近做了什么

## 一、Kubernetes 故障排错

### 1.1 Pod 异常状态

#### CrashLoopBackOff

**现象**：Pod 反复重启，状态显示 CrashLoopBackOff

**排错思路**：
```bash
# 1. 查看 Pod 状态和事件
kubectl describe pod <pod-name> -n <namespace>

# 2. 查看当前容器日志
kubectl logs <pod-name> -n <namespace>

# 3. 查看上一次崩溃的日志
kubectl logs <pod-name> -n <namespace> --previous

# 4. 如果容器有多个，指定容器名
kubectl logs <pod-name> -n <namespace> -c <container-name> --previous
```

**常见原因及解决方案**：

| 原因 | 特征 | 解决方案 |
|------|------|----------|
| 应用启动失败 | 日志中有启动错误 | 检查配置文件、环境变量、依赖服务 |
| OOMKilled | `Last State: OOMKilled` | 增加 `resources.limits.memory` |
| 健康检查失败 | `Liveness probe failed` | 调整 probe 参数或修复健康检查端点 |
| 配置错误 | ConfigMap/Secret 引用错误 | 验证 ConfigMap/Secret 是否存在且正确 |
| 镜像问题 | `exec format error` | 确认镜像架构匹配节点架构 (amd64/arm64) |

#### ImagePullBackOff

**现象**：Pod 无法拉取镜像

**排错思路**：
```bash
# 1. 查看事件中的具体错误
kubectl describe pod <pod-name> -n <namespace> | grep -A 10 Events

# 2. 检查镜像是否存在
# 3. 检查 imagePullSecrets 配置
kubectl get pod <pod-name> -n <namespace> -o jsonpath='{.spec.imagePullSecrets}'

# 4. 验证 Secret 是否正确
kubectl get secret <secret-name> -n <namespace> -o jsonpath='{.data.\.dockerconfigjson}' | base64 -d
```

**常见原因**：
- 镜像名称或 tag 拼写错误
- 私有仓库未配置 imagePullSecrets
- 仓库认证信息过期
- 网络无法访问镜像仓库

#### Pending 状态

**现象**：Pod 一直处于 Pending 状态

**排错思路**：
```bash
# 1. 查看调度事件
kubectl describe pod <pod-name> -n <namespace> | grep -A 20 Events

# 2. 查看节点资源使用情况
kubectl top nodes
kubectl describe nodes | grep -A 5 "Allocated resources"

# 3. 检查节点污点和 Pod 容忍度
kubectl get nodes -o custom-columns=NAME:.metadata.name,TAINTS:.spec.taints
kubectl get pod <pod-name> -n <namespace> -o jsonpath='{.spec.tolerations}'

# 4. 检查 PVC 绑定状态（如果使用 PV）
kubectl get pvc -n <namespace>
```

**常见原因**：
- 资源不足：CPU/内存请求超过可用资源
- 节点亲和性：没有符合条件的节点
- PVC 未绑定：StorageClass 配置问题或无可用 PV
- 污点/容忍：节点有污点但 Pod 没有对应容忍

### 1.2 Service 和网络连通性

**现象**：服务之间无法通信、外部无法访问服务

**排错思路**：
```bash
# 1. 确认 Pod 是否运行且 Ready
kubectl get pods -n <namespace> -l <label-selector>

# 2. 检查 Service 配置和 Endpoints
kubectl get svc <service-name> -n <namespace>
kubectl get endpoints <service-name> -n <namespace>

# 3. 从集群内部测试连通性
kubectl run debug --image=nicolaka/netshoot --rm -it -- bash
# 在 debug pod 中：
nslookup <service-name>.<namespace>.svc.cluster.local
curl -v <service-name>.<namespace>.svc.cluster.local:<port>

# 4. 检查 NetworkPolicy
kubectl get networkpolicy -n <namespace>

# 5. 检查 Ingress/Gateway 配置
kubectl get ingress -n <namespace>
kubectl describe ingress <ingress-name> -n <namespace>
```

**常见原因**：
- Endpoints 为空：Pod 标签与 Service selector 不匹配
- DNS 解析失败：CoreDNS 异常
- NetworkPolicy 阻断：过于严格的网络策略
- Port 不匹配：Service port 与容器 port 不一致

### 1.3 节点故障

**现象**：节点 NotReady 或不可调度

**排错思路**：
```bash
# 1. 查看节点状态和条件
kubectl get nodes
kubectl describe node <node-name>

# 2. 检查 kubelet 状态
ssh <node> systemctl status kubelet
ssh <node> journalctl -u kubelet --since "10 minutes ago"

# 3. 检查系统资源
ssh <node> df -h          # 磁盘空间
ssh <node> free -h        # 内存
ssh <node> top -bn1       # CPU 和负载

# 4. 检查容器运行时
ssh <node> systemctl status containerd  # 或 docker
ssh <node> crictl ps                     # 容器状态
```

**常见原因**：
- kubelet 崩溃或无法启动
- 磁盘压力（DiskPressure）
- 内存压力（MemoryPressure）
- 容器运行时异常
- 证书过期
- 网络分区

### 1.4 资源与调度

**排错思路**：
```bash
# 查看集群资源总览
kubectl top nodes
kubectl top pods -n <namespace> --sort-by=memory

# 查看资源配额
kubectl get resourcequota -n <namespace>
kubectl describe resourcequota -n <namespace>

# 查看 LimitRange
kubectl get limitrange -n <namespace>

# 查看 PDB（Pod Disruption Budget）
kubectl get pdb -n <namespace>
```

### 1.5 ETCD 故障

**排错思路**：
```bash
# 1. 检查 etcd 集群健康状态
ETCDCTL_API=3 etcdctl --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  endpoint health

# 2. 检查 etcd 成员列表
ETCDCTL_API=3 etcdctl member list --write-out=table

# 3. 检查 etcd 性能（磁盘延迟）
ETCDCTL_API=3 etcdctl check perf

# 4. 查看 etcd 日志
journalctl -u etcd --since "30 minutes ago"
# 或 kubeadm 部署方式
kubectl logs -n kube-system etcd-<node-name>
```

**常见问题**：
- 磁盘 IO 延迟高导致 leader 选举频繁
- 数据库过大需要压缩（compact + defrag）
- 证书过期

## 二、网络故障排错

### 2.1 连通性问题

**排错思路**：
```bash
# 1. 基础连通性
ping <target-ip>
traceroute <target-ip>
mtr <target-ip>

# 2. 端口连通性
nc -zv <target-ip> <port>
curl -v telnet://<target-ip>:<port>

# 3. DNS 解析
dig <domain>
nslookup <domain>
dig @<dns-server> <domain>

# 4. 路由检查
ip route show
ip route get <target-ip>

# 5. 防火墙规则
iptables -L -n -v
nft list ruleset
```

### 2.2 DNS 故障

**排错思路**：
```bash
# 1. 检查本地 DNS 配置
cat /etc/resolv.conf

# 2. 测试 DNS 解析
dig <domain> +trace
dig <domain> @8.8.8.8

# 3. K8s 内 CoreDNS 排查
kubectl get pods -n kube-system -l k8s-app=kube-dns
kubectl logs -n kube-system -l k8s-app=kube-dns
kubectl get configmap coredns -n kube-system -o yaml
```

**常见原因**：
- CoreDNS Pod 异常
- resolv.conf 配置错误
- 上游 DNS 不可达
- DNS 缓存过期问题
- ndots 配置不当导致解析慢

### 2.3 网络性能问题

**排错思路**：
```bash
# 1. 带宽测试
iperf3 -s                  # 服务端
iperf3 -c <server-ip>      # 客户端

# 2. 网络延迟
ping -c 100 <target>       # 查看 avg/max/mdev

# 3. 丢包分析
mtr -r -c 100 <target>

# 4. 网卡状态
ethtool <interface>
ip -s link show <interface>

# 5. TCP 连接分析
ss -tunapo
ss -s                       # 连接统计
```

## 三、存储故障排错

### 3.1 磁盘空间不足

**排错思路**：
```bash
# 1. 查看磁盘使用
df -h
df -ih                      # inode 使用情况

# 2. 找出大文件
du -sh /* | sort -rh | head -20
find / -xdev -type f -size +1G -exec ls -lh {} \;

# 3. 检查已删除但仍被占用的文件
lsof +L1

# 4. 清理方案
journalctl --vacuum-size=500M     # 清理 journal 日志
docker system prune -af           # 清理 Docker
crictl rmi --prune                # 清理未使用的镜像
```

### 3.2 IO 性能问题

**排错思路**：
```bash
# 1. 查看 IO 状态
iostat -xz 1 5

# 2. 查看 IO 延迟
ioping -c 10 /dev/sda

# 3. 查看 IO 等待进程
iotop -o

# 4. 磁盘健康检查
smartctl -a /dev/sda

# 5. 文件系统检查
xfs_info /dev/sda1           # XFS
tune2fs -l /dev/sda1         # ext4
```

### 3.3 K8s 存储（PV/PVC）故障

**排错思路**：
```bash
# 1. 检查 PVC 状态
kubectl get pvc -n <namespace>
kubectl describe pvc <pvc-name> -n <namespace>

# 2. 检查 PV 状态
kubectl get pv
kubectl describe pv <pv-name>

# 3. 检查 StorageClass
kubectl get sc
kubectl describe sc <sc-name>

# 4. 检查 CSI 驱动
kubectl get pods -n kube-system | grep csi
kubectl logs -n kube-system <csi-pod>

# 5. 检查节点上的挂载
ssh <node> mount | grep <pv-name>
ssh <node> dmesg | tail -50
```

**常见原因**：
- StorageClass 不存在或配置错误
- CSI 驱动未安装或异常
- 后端存储不可达
- 节点上挂载失败（权限、驱动）
- PV 回收策略问题

## 四、系统故障排错

### 4.1 高负载 / CPU 问题

**排错思路**：
```bash
# 1. 查看系统负载
uptime
top -bn1 | head -20
vmstat 1 5

# 2. 找出 CPU 消耗最高的进程
ps aux --sort=-%cpu | head -20

# 3. 查看中断和上下文切换
mpstat -P ALL 1 5
vmstat 1 5    # 关注 cs 列

# 4. perf 分析（深入排查）
perf top
perf record -g -p <pid> -- sleep 10
perf report
```

### 4.2 内存问题（OOM）

**排错思路**：
```bash
# 1. 查看内存使用
free -h
cat /proc/meminfo

# 2. 检查 OOM 历史
dmesg | grep -i "oom\|out of memory"
journalctl -k | grep -i oom

# 3. 找出内存消耗最高的进程
ps aux --sort=-%mem | head -20

# 4. 查看 swap 使用
swapon --show
vmstat 1 5    # 关注 si/so 列

# 5. 查看 cgroup 内存限制
cat /sys/fs/cgroup/memory/memory.limit_in_bytes
cat /sys/fs/cgroup/memory/memory.usage_in_bytes
```

### 4.3 内核和系统日志

**排错思路**：
```bash
# 1. 内核消息
dmesg -T | tail -50
dmesg -T --level=err,warn

# 2. 系统日志
journalctl --since "1 hour ago" --priority=err
journalctl -u <service-name> --since "30 minutes ago"

# 3. 审计日志
ausearch -m avc --start recent    # SELinux 拒绝
journalctl _TRANSPORT=audit --since "1 hour ago"
```

## 五、应用层故障排错

### 5.1 进程崩溃

**排错思路**：
```bash
# 1. 查看进程状态
systemctl status <service>
ps aux | grep <process>

# 2. 查看 coredump
coredumpctl list
coredumpctl info <pid>

# 3. 检查文件描述符限制
ulimit -a
cat /proc/<pid>/limits
ls /proc/<pid>/fd | wc -l

# 4. 检查 systemd 资源限制
systemctl show <service> | grep -i limit
```

### 5.2 连接池 / 端口耗尽

**排错思路**：
```bash
# 1. 查看连接状态
ss -tunapo | awk '{print $2}' | sort | uniq -c | sort -rn

# 2. 查看 TIME_WAIT 连接数
ss -tan state time-wait | wc -l

# 3. 查看端口使用
ss -tlnp

# 4. 检查系统端口范围
sysctl net.ipv4.ip_local_port_range
sysctl net.ipv4.tcp_tw_reuse
```

## 使用步骤

### 步骤 1：识别故障类别

根据用户描述的故障现象，判断故障所属类别：
- 提到 Pod、容器、Deployment、Service → **Kubernetes**
- 提到连接不上、DNS、延迟、丢包 → **网络**
- 提到磁盘、IO、PV、挂载 → **存储**
- 提到 CPU、内存、OOM、负载高 → **系统**
- 提到进程崩溃、连接池、超时 → **应用**

如果无法判断，先引导用户描述具体现象。

### 步骤 2：收集上下文

询问用户：
1. **故障现象**：具体表现是什么？
2. **影响范围**：影响哪些服务/节点？全部还是部分？
3. **时间线**：什么时候开始的？最近做了什么变更？
4. **环境信息**：K8s 版本、OS 版本、网络方案（Calico/Cilium/Flannel）

### 步骤 3：引导排查

根据故障类别，按照上述对应章节的排错思路引导用户：
1. 给出需要执行的诊断命令
2. 让用户执行命令并反馈结果
3. 根据结果分析原因
4. 给出解决方案

### 步骤 4：提供解决方案

解决方案应包含：
1. **临时修复**：快速恢复服务的方法
2. **根本解决**：彻底修复的方案
3. **预防措施**：避免再次发生的建议

## 重要说明

- 所有排错步骤遵循**先观察后行动**原则，避免在不了解问题的情况下做破坏性操作
- 涉及生产环境时，优先建议**临时修复**（如重启、扩容）恢复服务，再做根因分析
- 给出的命令需要适配用户的实际环境（如容器运行时是 containerd 还是 docker）
- K8s 相关排错命令需要足够的 RBAC 权限
- 参考更详细的排错知识库：[references/TROUBLESHOOT_GUIDE.md](references/TROUBLESHOOT_GUIDE.md)
