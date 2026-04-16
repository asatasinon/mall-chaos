# Task 17 — Chaos: 网络故障注入

**阶段**：Phase 3 — Chaos 功能  
**依赖**：Task 02（Docker Compose，ToxiProxy 容器）  
**产出**：网络延迟、丢包、断连故障注入能力（Compose: ToxiProxy + Pumba；K8s: Chaos Mesh）

---

## 目标
实现网络层故障注入，验证服务超时重试、熔断降级与系统恢复能力。不需要修改业务代码，通过基础设施层注入。

## 子任务

### 17.1 ToxiProxy 配置（Docker Compose）

**核心代理链路**（在 `infra/toxiproxy/toxiproxy.json` 中定义）：

```json
{
  "proxies": {
    "order-to-payment": {
      "name": "order-to-payment",
      "listen": "0.0.0.0:18085",
      "upstream": "payment-service:8085",
      "enabled": true
    },
    "order-to-inventory": {
      "name": "order-to-inventory",
      "listen": "0.0.0.0:18083",
      "upstream": "inventory-service:8083",
      "enabled": true
    },
    "gateway-to-order": {
      "name": "gateway-to-order",
      "listen": "0.0.0.0:18084",
      "upstream": "order-service:8084",
      "enabled": true
    }
  }
}
```

- [ ] order-service `application-docker.yml` 将 payment 地址改为 `toxiproxy:18085`
- [ ] order-service 将 inventory 地址改为 `toxiproxy:18083`
- [ ] 不通过 ToxiProxy 的服务（user、catalog）保持直连

### 17.2 ToxiProxy Toxic 操作（CLI 或 API 调用）

**延迟注入**（模拟 order→payment 2-5s 延迟）：
```bash
# 添加 latency toxic
curl -X POST http://toxiproxy:8474/proxies/order-to-payment/toxics \
  -d '{"name":"payment-delay","type":"latency","attributes":{"latency":3000,"jitter":1000}}'

# 移除 toxic
curl -X DELETE http://toxiproxy:8474/proxies/order-to-payment/toxics/payment-delay
```

**丢包注入**（模拟 order→inventory 30% 丢包）：
```bash
curl -X POST http://toxiproxy:8474/proxies/order-to-inventory/toxics \
  -d '{"name":"inventory-bandwidth","type":"bandwidth","attributes":{"rate":0}}'
```

**连接重置**（模拟服务不可用）：
```bash
curl -X POST http://toxiproxy:8474/proxies/order-to-payment/toxics \
  -d '{"name":"payment-reset","type":"reset_peer","attributes":{"timeout":0}}'
```

### 17.3 运维 Chaos 脚本

提供 `scripts/chaos/` 目录下的便捷脚本：

```
scripts/chaos/
├── network-delay.sh          # 注入延迟（参数：proxy, latency, jitter, durationSec）
├── network-remove-toxic.sh   # 移除指定 toxic
├── network-reset-all.sh      # 清除所有 toxics
└── toxiproxy-status.sh       # 查看所有代理状态
```

**`network-delay.sh` 示例**：
```bash
#!/bin/bash
PROXY=${1:-order-to-payment}
LATENCY=${2:-3000}    # ms
JITTER=${3:-500}      # ms
DURATION=${4:-120}    # sec

curl -sX POST http://localhost:8474/proxies/$PROXY/toxics \
  -d "{\"name\":\"chaos-delay\",\"type\":\"latency\",\"attributes\":{\"latency\":$LATENCY,\"jitter\":$JITTER}}"

echo "Delay injected. Auto-removing after ${DURATION}s..."
sleep $DURATION
curl -sX DELETE http://localhost:8474/proxies/$PROXY/toxics/chaos-delay
echo "Delay removed."
```

### 17.4 Pumba（容器级 Chaos）

在 `docker-compose.yml` 中添加可选 `pumba` 服务：
```yaml
pumba:
  image: gaiaadm/pumba:latest
  volumes:
    - /var/run/docker.sock:/var/run/docker.sock
  profiles: ["chaos-pumba"]    # 按需启用
  command: >
    pumba netem --duration 60s --tc-image gaiadocker/iproute2
    delay --time 2000 --jitter 500
    castrel-chaos_order-service_1
```

- [ ] 提供 `scripts/chaos/pumba-delay.sh`，参数化容器名、延迟时间
- [ ] 提供 `scripts/chaos/pumba-kill.sh`，随机重启指定容器（模拟 Pod 崩溃）

### 17.5 Chaos Mesh（Kubernetes）

在 `k8s/chaos/` 目录下准备 YAML 文件（Task 18 中部署 K8s 时使用）：

**网络延迟**（`k8s/chaos/network-delay.yaml`）：
```yaml
apiVersion: chaos-mesh.org/v1alpha1
kind: NetworkChaos
metadata:
  name: order-payment-delay
spec:
  action: delay
  mode: one
  selector:
    namespaces: [castrel]
    labelSelectors:
      app: order-service
  delay:
    latency: "3s"
    jitter: "500ms"
  direction: egress
  target:
    selector:
      namespaces: [castrel]
      labelSelectors:
        app: payment-service
  duration: "2m"
```

**Pod 重启**（`k8s/chaos/pod-kill.yaml`）：
```yaml
apiVersion: chaos-mesh.org/v1alpha1
kind: PodChaos
metadata:
  name: order-pod-kill
spec:
  action: pod-kill
  mode: one
  selector:
    namespaces: [castrel]
    labelSelectors:
      app: order-service
  duration: "30s"
  scheduler:
    cron: "@every 5m"
```

**压力测试**（`k8s/chaos/stress-mem.yaml`）：
```yaml
apiVersion: chaos-mesh.org/v1alpha1
kind: StressChaos
metadata:
  name: payment-stress-mem
spec:
  mode: one
  selector:
    namespaces: [castrel]
    labelSelectors:
      app: payment-service
  stressors:
    memory:
      workers: 2
      size: "256MB"
  duration: "5m"
```

### 17.6 验证场景

**场景 A：order→payment 网络延迟 3s**
- [ ] 注入：`network-delay.sh order-to-payment 3000 500 120`
- [ ] 期望：order-service 调用 payment 超时，触发超时错误计数上升
- [ ] 验证：Grafana `payment.charge.timeout.count` 上升，Tempo trace 可见 payment span 耗时 > 3s

**场景 B：order→inventory 连接重置**
- [ ] 注入连接重置 toxic
- [ ] 期望：order-service 库存预占调用失败，订单创建失败，库存不被错误锁定
- [ ] 验证：runner 成功率下降，Grafana 可见，移除 toxic 后恢复

**场景 C：组合故障（延迟 + 慢 SQL + 死锁）**
- [ ] 同时注入：ToxiProxy 延迟 2s + `order/chaos/slow-sql enable` + `order/chaos/deadlock enable(injectRate=0.2)`
- [ ] 验证：系统 P95 显著上升，成功率下降但不至于 0（系统降级运行）
- [ ] 移除所有 chaos：5 分钟内系统恢复可下单状态
