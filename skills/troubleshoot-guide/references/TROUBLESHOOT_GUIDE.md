# 故障排错知识库 - 详细参考文档

## 目录

1. [Kubernetes 深度排错](#1-kubernetes-深度排错)
2. [网络故障排错进阶](#2-网络故障排错进阶)
3. [存储故障排错进阶](#3-存储故障排错进阶)
4. [系统级故障排错](#4-系统级故障排错)
5. [排错工具速查表](#5-排错工具速查表)

---

## 1. Kubernetes 深度排错

### 1.1 控制面组件故障

#### kube-apiserver 排错

```bash
# 检查 apiserver 状态
kubectl get componentstatuses
kubectl get --raw='/healthz?verbose'

# 查看 apiserver 日志
kubectl logs -n kube-system kube-apiserver-<node> --tail=200
# 或
journalctl -u kube-apiserver --since "30 minutes ago"

# 检查证书有效期
kubeadm certs check-expiration
openssl x509 -in /etc/kubernetes/pki/apiserver.crt -noout -dates

# 检查 apiserver 审计日志
# 路径通常在 /var/log/kubernetes/audit.log
```

**常见问题**：
- 证书过期：`kubeadm certs renew all`
- ETCD 连接失败：检查 ETCD 集群健康状态
- Admission Webhook 阻断：`kubectl get validatingwebhookconfigurations` 和 `kubectl get mutatingwebhookconfigurations`
- OOM：增加 apiserver 内存限制

#### kube-controller-manager 排错

```bash
kubectl logs -n kube-system kube-controller-manager-<node> --tail=200

# 检查 leader 选举
kubectl get endpoints -n kube-system kube-controller-manager -o yaml
```

#### kube-scheduler 排错

```bash
kubectl logs -n kube-system kube-scheduler-<node> --tail=200

# 查看调度失败原因
kubectl get events --sort-by='.lastTimestamp' | grep FailedScheduling

# 检查调度器配置
kubectl get configmap -n kube-system kube-scheduler-config -o yaml
```

### 1.2 网络插件（CNI）排错

#### Calico 排错

```bash
# 检查 Calico 组件状态
kubectl get pods -n calico-system
calicoctl node status

# 检查 BGP 对等状态
calicoctl get bgpPeer
calicoctl get node -o wide

# 检查 IP 池
calicoctl get ipPool -o wide

# 检查网络策略
calicoctl get networkPolicy --all-namespaces
kubectl get networkpolicy --all-namespaces

# Calico 日志
kubectl logs -n calico-system -l k8s-app=calico-node --tail=100
```

#### Cilium 排错

```bash
# Cilium 状态
cilium status
cilium connectivity test

# 检查 Endpoint 状态
cilium endpoint list
cilium endpoint get <id>

# 检查 BPF map
cilium bpf ct list global
cilium bpf policy get --all

# 检查 Hubble（可观测性）
hubble observe --last 100
hubble observe --verdict DROPPED
```

#### Flannel 排错

```bash
# 检查 Flannel 状态
kubectl get pods -n kube-flannel
kubectl logs -n kube-flannel -l app=flannel --tail=100

# 检查子网分配
cat /run/flannel/subnet.env

# 检查 VXLAN 接口
ip -d link show flannel.1
bridge fdb show dev flannel.1
```

### 1.3 CoreDNS 深度排错

```bash
# 检查 CoreDNS Pod 状态
kubectl get pods -n kube-system -l k8s-app=kube-dns -o wide

# 查看 CoreDNS 日志
kubectl logs -n kube-system -l k8s-app=kube-dns --tail=200

# 启用 CoreDNS debug 日志
kubectl edit configmap coredns -n kube-system
# 在 Corefile 中添加 log 插件

# DNS 性能测试
kubectl run dnsperf --image=quay.io/miekg/dnsperf --rm -it -- \
  dnsperf -s kube-dns.kube-system.svc.cluster.local -d /dev/stdin <<EOF
example.com A
kubernetes.default.svc.cluster.local A
EOF

# 检查 DNS 解析链路
kubectl exec -it <pod> -- cat /etc/resolv.conf
kubectl exec -it <pod> -- nslookup kubernetes.default
```

**ndots 优化**：
```yaml
# Pod spec 中优化 DNS 查询
spec:
  dnsConfig:
    options:
      - name: ndots
        value: "2"      # 默认值 5 会导致过多 DNS 查询
      - name: single-request-reopen
```

### 1.4 Helm / 应用部署排错

```bash
# 查看 Helm 发布状态
helm list -n <namespace>
helm status <release> -n <namespace>

# 查看 Helm 历史
helm history <release> -n <namespace>

# 查看渲染后的 manifest
helm get manifest <release> -n <namespace>

# 回滚
helm rollback <release> <revision> -n <namespace>

# Dry-run 调试
helm install <release> <chart> --dry-run --debug
```

### 1.5 RBAC 排错

```bash
# 检查当前用户权限
kubectl auth can-i --list

# 检查特定操作权限
kubectl auth can-i create pods -n <namespace> --as=<user>

# 查看 ClusterRole/Role 绑定
kubectl get clusterrolebinding | grep <user-or-sa>
kubectl get rolebinding -n <namespace> | grep <user-or-sa>

# 查看 ServiceAccount
kubectl get sa -n <namespace>
kubectl get sa <sa-name> -n <namespace> -o yaml
```

## 2. 网络故障排错进阶

### 2.1 TCP 连接排错

```bash
# 全面的连接状态统计
ss -s

# 查看特定端口的连接
ss -tnap sport = :8080

# 查看 SYN 队列溢出
netstat -s | grep -i "syn\|overflow\|drop"

# 查看 TCP 重传
netstat -s | grep -i retrans

# 抓包分析
tcpdump -i eth0 -nn host <target-ip> -w capture.pcap
tcpdump -i eth0 -nn port 80 -c 100

# 使用 tshark 分析
tshark -r capture.pcap -Y "tcp.analysis.retransmission"
```

### 2.2 RDMA/RoCE 网络排错

```bash
# 检查 RDMA 设备
ibstat
ibv_devinfo

# 检查 RDMA 连通性
ibping -S         # 服务端
ibping -c <lid>   # 客户端

# RDMA 带宽测试
ib_write_bw -d <device>        # 服务端
ib_write_bw -d <device> <ip>   # 客户端

# 检查 RoCE 配置
cma_roce_mode -d <device> -p 1
cat /sys/class/infiniband/<device>/ports/1/gid_attrs/types/0

# 检查 PFC（Priority Flow Control）
mlnx_qos -i <interface>
ethtool -S <interface> | grep pause
```

### 2.3 负载均衡排错

```bash
# 检查 kube-proxy 模式
kubectl get configmap -n kube-system kube-proxy -o yaml | grep mode

# IPVS 模式排错
ipvsadm -Ln
ipvsadm -Ln --stats

# iptables 模式排错
iptables -t nat -L KUBE-SERVICES -n
iptables -t nat -L KUBE-NODEPORTS -n

# 检查 Service 的 externalTrafficPolicy
kubectl get svc <service> -o jsonpath='{.spec.externalTrafficPolicy}'
```

## 3. 存储故障排错进阶

### 3.1 GPFS / Spectrum Scale 排错

```bash
# 检查集群状态
mmgetstate -a
mmlscluster

# 检查文件系统状态
mmlsfs all
mmlsmount all

# 检查磁盘状态
mmlsdisk <fs-name> -L
mmlsnsd -m

# 检查配额
mmlsquota -j <fileset> <fs-name>

# 性能分析
mmdiag --iohist
mmfsadm dump waiters

# 检查日志
mmhealth cluster show
/var/adm/ras/mmfs.log.latest
```

### 3.2 Ceph 排错

```bash
# 集群健康状态
ceph health detail
ceph status

# OSD 状态
ceph osd tree
ceph osd stat
ceph osd df

# PG 状态
ceph pg stat
ceph pg dump_stuck

# Pool 信息
ceph osd pool ls detail

# 慢请求分析
ceph daemon osd.<id> dump_historic_slow_ops

# 日志
ceph log last 100
journalctl -u ceph-osd@<id>
```

### 3.3 NFS 排错

```bash
# 检查 NFS 挂载
showmount -e <nfs-server>
mount | grep nfs
nfsstat -c    # 客户端统计
nfsstat -s    # 服务端统计

# 检查 NFS 性能
nfsiostat 1 5

# 检查 RPC 状态
rpcinfo -p <nfs-server>

# 常见问题
# - stale file handle: 重新挂载
# - permission denied: 检查 exports 配置和 UID/GID 映射
# - 性能差: 检查 rsize/wsize、async/sync 挂载选项
```

### 3.4 LVM 排错

```bash
# 查看物理卷
pvs
pvdisplay

# 查看卷组
vgs
vgdisplay

# 查看逻辑卷
lvs
lvdisplay

# 扩展逻辑卷
lvextend -L +50G /dev/<vg>/<lv>
resize2fs /dev/<vg>/<lv>         # ext4
xfs_growfs /mount/point          # XFS
```

## 4. 系统级故障排错

### 4.1 系统启动问题

```bash
# 查看启动日志
journalctl -b          # 当前启动
journalctl -b -1       # 上次启动
journalctl --list-boots # 启动历史

# 检查启动服务
systemctl list-units --state=failed
systemd-analyze blame  # 启动时间分析
systemd-analyze critical-chain

# GRUB 问题
cat /boot/grub2/grub.cfg
grub2-mkconfig -o /boot/grub2/grub.cfg
```

### 4.2 时间同步问题

```bash
# 检查 NTP 同步状态
timedatectl status
chronyc tracking
chronyc sources -v

# 强制同步
chronyc makestep

# 检查时间偏差
# K8s 证书验证、日志时间戳、分布式系统都依赖时间同步
```

### 4.3 安全相关排错

```bash
# SELinux 排错
getenforce
ausearch -m avc --start recent
sealert -a /var/log/audit/audit.log

# AppArmor 排错
aa-status
journalctl | grep apparmor

# 文件权限问题
namei -l /path/to/file
getfacl /path/to/file
```

### 4.4 内核参数调优与排错

```bash
# 常见需要调整的内核参数

# 网络相关
sysctl net.core.somaxconn           # TCP 连接队列（默认 4096）
sysctl net.ipv4.tcp_max_syn_backlog # SYN 队列大小
sysctl net.ipv4.ip_local_port_range # 本地端口范围
sysctl net.ipv4.tcp_tw_reuse        # TIME_WAIT 重用
sysctl net.core.netdev_max_backlog  # 网卡接收队列

# 内存相关
sysctl vm.swappiness                # swap 使用倾向
sysctl vm.overcommit_memory         # 内存过量分配
sysctl vm.dirty_ratio               # 脏页比例
sysctl vm.dirty_background_ratio    # 后台脏页比例

# 文件系统相关
sysctl fs.file-max                  # 最大文件描述符数
sysctl fs.inotify.max_user_watches  # inotify 监听数
```

## 5. 排错工具速查表

### 5.1 K8s 排错工具

| 工具 | 用途 | 安装方式 |
|------|------|----------|
| `kubectl debug` | 调试运行中的 Pod | 内置 (K8s 1.25+) |
| `k9s` | 终端 K8s 管理界面 | `brew install k9s` |
| `stern` | 多 Pod 日志聚合 | `brew install stern` |
| `kubectx/kubens` | 快速切换 context/namespace | `brew install kubectx` |
| `kustomize` | 查看渲染后的 manifest | `brew install kustomize` |
| `kubespy` | 实时观察资源变化 | GitHub release |

### 5.2 网络排错工具

| 工具 | 用途 | 安装方式 |
|------|------|----------|
| `tcpdump` | 抓包分析 | 系统自带 |
| `wireshark/tshark` | 高级抓包分析 | `apt install tshark` |
| `mtr` | 路由追踪+丢包分析 | `apt install mtr` |
| `iperf3` | 带宽测试 | `apt install iperf3` |
| `netshoot` | 网络调试容器 | Docker 镜像 |
| `nmap` | 端口扫描 | `apt install nmap` |
| `curl/httpie` | HTTP 调试 | 系统自带 |

### 5.3 系统排错工具

| 工具 | 用途 | 安装方式 |
|------|------|----------|
| `htop` | 进程监控 | `apt install htop` |
| `iotop` | IO 监控 | `apt install iotop` |
| `vmstat` | 系统资源统计 | 系统自带 |
| `iostat` | 磁盘 IO 统计 | `apt install sysstat` |
| `sar` | 系统活动报告 | `apt install sysstat` |
| `perf` | 性能分析 | `apt install linux-tools` |
| `strace` | 系统调用追踪 | `apt install strace` |
| `bpftrace` | eBPF 追踪 | `apt install bpftrace` |

### 5.4 存储排错工具

| 工具 | 用途 | 安装方式 |
|------|------|----------|
| `smartctl` | 磁盘健康检查 | `apt install smartmontools` |
| `fio` | IO 性能测试 | `apt install fio` |
| `ioping` | IO 延迟测试 | `apt install ioping` |
| `blktrace` | 块设备追踪 | `apt install blktrace` |
| `xfs_repair` | XFS 修复 | `apt install xfsprogs` |
| `e2fsck` | ext4 修复 | 系统自带 |
