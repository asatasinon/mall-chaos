# P0-09：只读观测、retention 与告警接入核验

> 核验时间：2026-09-16 18:58 CST（运行时检查约为 2026-09-16T10:56:10Z）
>
> 本记录只保存配置摘要、状态、查询引用和限制，不保存 Prometheus/Loki/Tempo 查询结果、告警 envelope、日志、trace、凭据或 Basic Auth 密码。

## 后续代码/配置修订说明（2026-09-17）

下方运行时表格和结论保留 2026-09-16 的历史快照，不回写为不存在的运行时证据。其后 P0-13 已完成以下代码/配置修订：

- Prometheus Compose/Kubernetes retention 目标统一为 `168h`；本文件下方旧表中的 `7d` 仅代表当时的已加载配置。
- 控制面已新增精确的 `POST /internal/alertmanager/webhook` route，使用 `CASTREL_INTERNAL_SERVICE_KEY` 机器认证，并将 firing/resolved 告警保存为受控低基数 `alert_receipts`；未执行真实 Alertmanager 投递，因此没有 receipt 运行证据。
- Compose/Kubernetes Alertmanager receiver 已配置 credentials-file 认证；配置语法已通过静态校验，但不能替代真实投递、重复投递和数据库读回核验。
- Kubernetes Loki 已新增包含 retention 的 ConfigMap 和 `/etc/loki/local-config.yaml` 挂载，并保留 `emptyDir`；Kubernetes runtime 仍未部署或查询。

因此，当前实现边界是“代码和静态配置已具备，真实 receipt、Kubernetes runtime 和场景 firing 仍待获批运行核验”。

**P0-14 更新（2026-09-17）：** 上述内容保留 P0-13/历史观测窗口事实。
远端 Compose 已在控制面运行后真实核验 Alertmanager route、机器认证、
firing/resolved receipt 和重复投递；本文件末尾记录该运行窗口。真实
Prometheus/Loki/Tempo adapter 仍未实现，因此场景 baseline 的 observation
状态仍必须保留为 `UNKNOWN`/limitation；Kubernetes runtime 仍未执行。

## 核验范围与方法

- Compose 只启动 `prometheus`、`alertmanager`、`loki`、`tempo` 和 `obs-auth-proxy`；没有启动 Web、Worker、业务服务，没有创建 Fault Run，也没有执行 Data Warmup 写入。
- 通过宿主机 `obs-auth-proxy` 的 Basic Auth 入口执行健康、状态和有限时间窗口查询；每个 HTTP 请求设置 10 秒总超时。
- 只记录 HTTP 状态、API `status`/ready 状态、有效 retention 字段和查询路径；不记录查询返回的数据。
- Kubernetes 只读取当前 kustomize 清单。当前 context 的 namespace 查询未在允许窗口内返回，因此 Kubernetes 运行时状态标为 `UNKNOWN`，不把清单声明当作运行事实。

## Compose 配置 revision

| 配置 | 来源 | SHA-256 | 说明 |
| --- | --- | --- | --- |
| Prometheus | `infra/prometheus/prometheus.yml` | `520d0bdb31b2ddfd92ec2fd128fed706417104a1ccf744650456ee8854f12cc4` | 运行容器 bind mount 与该文件一致 |
| Prometheus rules | `infra/prometheus/rules/alert-rules.yml` | `fff8238ee10b780c690fda3ac4ce1cd214f6c0c2011a47d9d297ca8567d1e1f8` | 运行容器 rules mount 与该文件一致 |
| Alertmanager source/data | `infra/alertmanager/alertmanager.yml`、`data/alertmanager-config/alertmanager.yml` | `e823d3e3bb33c09a4a27eb74ed8ceda68fe165d03f4f56f1f868d7abb28b8e12` | 两份文件一致，运行容器加载该 revision |
| Loki | `infra/loki/loki-config.yml` | `cf0808f85d970b6a179ac37dfa40ea6815dc3d1a3acee18f499f19580016cec0` | Compose bind mount |
| Tempo | `infra/tempo/tempo-config.yml` | `840a65e2083b48201c057a7ff7342a3bd45b5e9ce76ab296f75e89cb6c335681` | Compose bind mount |

Alertmanager 在运行容器内通过 `amtool check-config` 校验成功，包含 3 个 receiver、0 个 inhibit rule 和 0 个 template。

## Compose 运行时核验（2026-09-16 历史快照）

| 系统 | declared | observed | status | 查询引用与限制 |
| --- | --- | --- | --- | --- |
| Prometheus | `--storage.tsdb.retention.time=7d` | `/api/v1/status/runtimeinfo` 返回 `storageRetention=1w`，与声明为同一周级窗口 | `AVAILABLE` | `/-/ready` 为 HTTP 200；`/api/v1/query_range` 在 5 分钟窗口执行成功；未保存结果 |
| Loki | `limits_config.retention_period=168h`、`compactor.retention_enabled=true` | `/config` 的 limits retention 为 `1w` 且 retention enabled；有效配置还暴露 legacy `table_manager.retention_period=0s`，未将其解释为当前 limits retention | `AVAILABLE` | 初次启动 settling 期间 `/ready` 为 503，稳定后为 HTTP 200；`/loki/api/v1/query_range` 在 5 分钟窗口执行成功；未保存结果 |
| Tempo | `compactor.compaction.block_retention=168h` | `/status/config` 的 compactor retention 为 `168h0m0s`；同一 effective config 还暴露 backend scheduler provider 的 `block_retention=336h0m0s`，两者语义不能在本批次擅自合并 | `AVAILABLE_WITH_LIMITATION` | 稳定后 `/ready` 为 HTTP 200；`/api/search` 在 5 分钟窗口返回有效 JSON；未保存 trace 或 search result；后续必须明确两个 retention 字段的实际适用范围 |
| Alertmanager | `resolve_timeout=5m`；default/critical/warning 三个 receiver 均 `send_resolved=true` | `/api/v2/status` 为 ready；运行版本 `0.28.1`；active config 校验成功；3 个 receiver 均仍指向控制面内部 webhook | `AVAILABLE_WITH_LIMITATION` | `/-/ready` 为 HTTP 200；`/api/v2/alerts` 可读；历史快照没有外部 receiver 或 `http_config` 机器认证配置；控制面未启动且当时 checkout 不存在对应 route，因此当时 webhook 投递能力为 `UNAVAILABLE` |

Compose 的观测 HTTP API 通过 Nginx Basic Auth 暴露。首次使用旧文档中的开发凭据探针返回 HTTP 401；当前部署凭据只从 `infra/nginx/.htpasswd` 读取并且没有写入本记录，维护文档已改为引用该文件作为唯一来源。

## Alertmanager route 接入结论（2026-09-16 历史快照）

当前 Compose 和 Kubernetes 配置都声明以下内部目标：

```text
http://traffic-control-plane:3086/internal/alertmanager/webhook
```

但在该历史快照的 `traffic-control-plane/src/app` 下没有对应 route；同时 Alertmanager receiver 没有配置独立的机器认证。配置文件有效、`send_resolved` 正确和 Alertmanager API 可用，都不能证明控制面能够接收 webhook。该历史结论已由 P0-13 的代码/配置修订部分解决，但真实投递和 receipt 仍不能在 Phase 0 伪造成功。

## Kubernetes 声明核验（2026-09-16 历史快照）

| 系统 | 声明事实 | 当前结论 |
| --- | --- | --- |
| Prometheus | `--storage.tsdb.retention.time=7d`，数据为 `emptyDir` | retention 有声明；非持久化，运行时未核验 |
| Alertmanager | 三个 receiver 均 `send_resolved=true`，数据为 `emptyDir` | route 有声明；无独立认证，webhook route 仍不存在 |
| Loki | Deployment 使用 `-config.file=/etc/loki/local-config.yaml`，但清单没有挂载包含 retention 的 ConfigMap | 没有可核验的 Kubernetes retention 声明；不要把 Compose 的 168h 复制给 Kubernetes |
| Tempo | `block_retention=168h`，数据为 `emptyDir` | retention 有声明；非持久化，运行时未核验 |
| 观测入口 | 未部署 Compose `obs-auth-proxy` 或对应观测 Ingress；服务为 ClusterIP | 只能依赖集群网络边界，不能宣称有 Nginx Basic Auth |

Kubernetes 清单 revision：

| 文件 | SHA-256 |
| --- | --- |
| `k8s/infra/prometheus.yaml` | `6d1d69758963a085707121f62527144c9f43b7a13ec2aa6df04268a699c2a74d` |
| `k8s/infra/alertmanager.yaml` | `8e5fc96d18658fcfc21697a3764fa8cc60680f96ade35db4b6839fa0927cb201` |
| `k8s/infra/loki.yaml` | `f1a058f0deb011581bf57497a6387630f03b6032a8da62c19b3a79d9dea3949b` |
| `k8s/infra/tempo.yaml` | `d6834ffb876f93130a9597f42bbbacb900a11e607408b9d673694e0241476071` |
| `k8s/configmap/prometheus-alert-rules.yaml` | `ab94f7ce7c5564ae1563d6ae592d1e2c1944bef1d32a904891982eccb0c8ebf6` |

## Pilot 影响

- Compose Prometheus、Loki、Tempo 和 Alertmanager 的只读 API 已在短窗口内可用，但 Tempo retention 语义仍需拆解。
- Alertmanager 真实投递和 receipt 没有事实证据；不能把任何候选标记为 `SELECTED`。
- Kubernetes runtime、Loki retention、持久化和观测认证未核验；这些事实不能从 Compose 借用。
- P0-10 必须保持零个 `SELECTED`，直到 route、认证、retention 和告警实际 receipt 均有独立证据。

## P0-14 远端 Compose 运行窗口（2026-09-17）

远端最终部署为 `CASTREL_DEPLOYMENT_MODE=compose`、`CASTREL_RELEASE_REVISION=1.4.0`，
`BASELINE_CAPTURE_ENABLED=false`、`DATA_WARMUP_ENABLED=true`。源码为干净
`a2df62984548625e10588e5de9948e71c4059ea2`；Catalog 镜像为
`sha256:f4cd1e9cbf18093ec5f7fc11d4e7bb0cce8e4b76c19512605515c08dc0ced03d`，
控制面与 Worker 镜像为
`sha256:f9e5fd0ce3ebfcc51e97a83019a60f90fcb59cabfff554a791529602a173c8a5`。
这组 digest 只作为发布一致性证据，不替代 Kubernetes image/runtime 证据。

### Alertmanager runtime receipt

在远端控制面通过受保护 webhook 入口执行了 firing/resolved 和重复投递验证：

| 检查 | 结果 |
| --- | --- |
| 未认证入口 | HTTP 401 |
| 首次 firing/resolved | HTTP 200，`accepted=1`、`duplicates=0` |
| 重复 firing/resolved | HTTP 200，`accepted=0`、`duplicates=1` |
| 数据库 receipt 表 | 6 条：3 条 `firing`、3 条 `resolved` |
| 低基数/敏感输出 | 未保存原始告警 envelope、凭据或完整 labels；baseline/event 安全扫描 0 命中 |

该验证证明控制面接收端点、机器认证和 receipt 幂等可用；它不是某个 Catalog
场景已经触发 Prometheus rule 的证明。场景级 `actual firing` 和查询窗口仍为
`UNKNOWN`，因为当前 capture 只有 observation executor interface，没有真实
Prometheus/Loki/Tempo adapter。

### Compose observation and rollback boundary

Prometheus/Loki/Tempo readiness 与短窗口 API 的历史结果仍为可用，Prometheus/Loki
retention 约为一周，Tempo 同时暴露 root `168h` 与 backend scheduler `336h`
字段，语义未在本批次擅自合并。P0-14 因此把 Compose 组件可用性记为
`AVAILABLE_WITH_LIMITATION`，不把它升级成每个场景的观测证据。

baseline 开关关闭后的 smoke 保持既有 Fault Run/baseline 可读，baseline 写入口
返回 `BASELINE_CAPTURE_DISABLED`，Gateway 商品接口、Runner status 和
Alertmanager route 仍可用；未删除业务数据、Data Warmup 进度或历史 baseline。
Kubernetes runtime、持久化、认证入口和真实 retention 查询仍需专用 namespace
与批准窗口，不能从这次 Compose 结果推断。
