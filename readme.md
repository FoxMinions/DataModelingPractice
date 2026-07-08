# 数据说明文档

## 一、数据概览

| 文件名 | 表名 | 记录数 | 说明 |
|--------|------|--------|------|
| [host_detail.dat](./host_detail.dat) | host_detail | 20 | 主机信息明细表（20台服务器） |
| [mod_detail.dat](./mod_detail.dat) | mod_detail | 55 | 指标MOD字典表（35个磁盘指标 + 20个性能指标） |
| [disk_tsar.dat](./disk_tsar.dat) | tsar_detail (type=disk) | 12,000 | 磁盘监控采集明细（≥1万条） |
| [pref_tsar.dat](./pref_tsar.dat) | tsar_detail (type=pref) | 67,200 | 性能监控采集明细（20台主机 × 7天 × 24小时 × 20个指标） |

> 数据时间范围：`2026-07-01 00:00:00` 起（磁盘每5分钟一次采样，性能每小时一次采样）  
> 主机域名后缀：`hismartlab.cn`  
> 分隔符：制表符 `\t`（Tab）

---

## 二、表结构说明

### 1. host_detail — 主机信息明细表

| 字段 | 类型 | 含义 | 示例 |
|------|------|------|------|
| hostid | string | 主机ID（主键） | host001 |
| hostname | string | 主机FQDN名 | server-001.hismartlab.cn |
| owner | string | 负责人 | 张三 / 李四 / 王五 / ... |
| model | string | 硬件型号 | Dell R740 / HP DL388 / Lenovo SR650 / Huawei 2288H / ... |
| location1 | string | 机房位置 | A机房 / B机房 / C机房 / D机房 / E机房 |
| location2 | string | 机柜编号 | 机柜01 ~ 机柜12 |

### 2. mod_detail — 指标（MOD）字典表

| 字段 | 类型 | 含义 | 示例 |
|------|------|------|------|
| mod | string | 指标代码（主键，关联 tsar_detail.mod） | sda_util / cpu_usage |
| type | string | 资源类型 | disk / pref |
| desc | string | 指标中文说明 | 磁盘A使用率 / 用户态CPU使用率 |
| unit | string | 单位 | % / MB / MB/s / ms / req/s / sectors/s / pkt/s / 个 |
| tag | string | 指标分类标签 | disk_util_percent / cpu_percent / ... |

#### 磁盘类指标（type=disk，共35个）

按磁盘 sda / sdb / sdc / sdd / sde × 7种指标组合：

| 指标后缀 | 说明 | 单位 | 分类tag |
|----------|------|------|---------|
| `_rqm` | 每秒合并读请求数 | req/s | disk_rqm_per_sec |
| `_read` | 每秒读取扇区数 | sectors/s | disk_rw_sectors |
| `_write` | 每秒写入扇区数 | sectors/s | disk_rw_sectors |
| `_avgrq` | 平均请求扇区大小 | sectors | disk_other_metric |
| `_await` | 平均I/O等待时间 | ms | disk_latency_ms |
| `_util` | 磁盘使用率 | % | disk_util_percent |
| `_svctm` | 平均服务时间 | ms | disk_latency_ms |

#### 性能类指标（type=pref，共20个）

| 分类 | mod | 说明 | 单位 | tag |
|------|-----|------|------|-----|
| CPU | cpu_user | 用户态CPU使用率 | % | cpu_percent |
| CPU | cpu_sys | 系统态CPU使用率 | % | cpu_percent |
| CPU | cpu_wait | IO等待CPU使用率 | % | cpu_percent |
| CPU | cpu_idle | CPU空闲率 | % | cpu_percent |
| CPU | cpu_usage | CPU综合使用率 | % | cpu_percent |
| 内存 | mem_used | 已使用内存 | MB | mem_metric |
| 内存 | mem_free | 空闲内存 | MB | mem_metric |
| 内存 | mem_buff | 缓冲区内存 | MB | mem_metric |
| 内存 | mem_cache | 缓存内存 | MB | mem_metric |
| 内存 | mem_swap | 交换区使用 | MB | mem_metric |
| 网络 | net_in | 网络入站带宽 | MB/s | net_speed_mb |
| 网络 | net_out | 网络出站带宽 | MB/s | net_speed_mb |
| 网络 | net_pktin | 每秒入站数据包数 | pkt/s | net_packets |
| 网络 | net_pktout | 每秒出站数据包数 | pkt/s | net_packets |
| 负载 | load1 | 1分钟平均负载 |  | load_average |
| 负载 | load5 | 5分钟平均负载 |  | load_average |
| 负载 | load15 | 15分钟平均负载 |  | load_average |
| 进程 | proc_run | 运行中进程数 | 个 | proc_count |
| 进程 | proc_block | 阻塞进程数 | 个 | proc_count |
| 进程 | proc_total | 总进程数 | 个 | proc_count |

### 3. disk_tsar.dat / pref_tsar.dat — 采集明细表（tsar_detail）

两个文件结构相同，通过 `type` 字段区分磁盘(disk)或性能(pref)：

| 字段 | 类型 | 含义 | 关联 |
|------|------|------|------|
| ts | long | 采集时间戳（毫秒） | — |
| hostid | string | 主机ID | → host_detail.hostid |
| type | string | 资源类型 | disk / pref |
| mod | string | 指标代码 | → mod_detail.mod |
| value | string | 采集值（数值字符串） | mod_detail.unit 为单位 |
| tag | string | 指标分类标签 | → mod_detail.tag |

---

## 三、ER 关系

```
host_detail (1) ──── hostid ──── (N) tsar_detail (disk_tsar + pref_tsar)
                                              │
                                              │ mod
                                              ▼
                                     mod_detail (1)
```

- **host_detail 1 : N tsar_detail**：一台主机产生多条采集记录
- **mod_detail 1 : N tsar_detail**：一个指标（mod）出现在多条采集记录中
- **tsar_detail = disk_tsar.dat ∪ pref_tsar.dat**：两个文件同结构，仅 type 值不同

---

## 四、数据样例

### host_detail.dat 样例

```
hostid  hostname                    owner   model        location1  location2
host001 server-001.hismartlab.cn    陈三    Dell R750    A机房      机柜12
host002 server-002.hismartlab.cn    钱七    HP DL388     B机房      机柜03
host003 server-003.hismartlab.cn    林四    Dell R750    E机房      机柜02
...
```

### mod_detail.dat 样例

```
mod          type   desc                      unit         tag
sda_util     disk   磁盘A使用率                %            disk_util_percent
sda_await    disk   磁盘A平均I/O等待时间       ms           disk_latency_ms
cpu_user     pref   用户态CPU使用率            %            cpu_percent
mem_used     pref   已使用内存                 MB           mem_metric
net_in       pref   网络入站带宽               MB/s         net_speed_mb
load1        pref   1分钟平均负载                            load_average
proc_total   pref   总进程数                   个           proc_count
...
```

### disk_tsar.dat 样例

```
ts              hostid   type   mod         value    tag
1782835200000   host003  disk   sda_write   280043   disk_rw_sectors
1782835500000   host008  disk   sda_write   242357   disk_rw_sectors
1782835800000   host013  disk   sdc_avgrq   989.52   disk_other_metric
1782840300000   host015  disk   sdd_svctm   12.65    disk_latency_ms
...
```

### pref_tsar.dat 样例

```
ts              hostid   type   mod         value    tag
1782835200000   host001  pref   cpu_user    21.70    cpu_percent
1782835200000   host001  pref   cpu_sys     11.98    cpu_percent
1782835200000   host001  pref   mem_used    65536    mem_metric
1782835200000   host001  pref   net_in      156.32   net_speed_mb
...
```

---

## 五、Web 监控面板

启动：`node server.js` → 访问 `http://localhost:3000`

### 总览页
![总览页](screenshot-overview.png)

### CPU 监控
![CPU 监控](screenshot-cpu.png)

### 内存/网络监控
![内存/网络监控](screenshot-memnet.png)
