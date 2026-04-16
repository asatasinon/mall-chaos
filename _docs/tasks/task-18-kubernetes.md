# Task 18 — Kubernetes 部署

**阶段**：Phase 4 — 部署与验收  
**依赖**：Task 01–17（所有服务与 Chaos 功能完成）  
**产出**：可在 K8s 上一键部署的完整集群配置（Deployment / Service / ConfigMap / Ingress）

---

## 目标
提供与 Docker Compose 对等的 Kubernetes 部署方案，支持 Chaos Mesh 故障注入。

## 目录结构
```
k8s/
├── namespace.yaml
├── configmap/
│   ├── mysql-config.yaml
│   └── app-config.yaml          # 公共环境变量（DB URL、Redis URL）
├── secrets/
│   └── db-secret.yaml           # MySQL 密码（Base64）
├── infra/
│   ├── mysql-deployment.yaml
│   ├── mysql-service.yaml
│   ├── redis-deployment.yaml
│   ├── redis-service.yaml
│   ├── prometheus-deployment.yaml
│   ├── grafana-deployment.yaml
│   ├── loki-deployment.yaml
│   └── tempo-deployment.yaml
├── services/
│   ├── gateway/
│   │   ├── deployment.yaml
│   │   └── service.yaml
│   ├── user/
│   ├── catalog/
│   ├── inventory/
│   ├── order/
│   ├── payment/
│   ├── traffic-runner/
│   ├── promotion/
│   ├── risk/
│   ├── fulfillment/
│   └── notification/
├── ingress/
│   └── gateway-ingress.yaml
├── chaos/
│   ├── network-delay.yaml       # Task 17 中准备的 Chaos Mesh YAML
│   ├── pod-kill.yaml
│   └── stress-mem.yaml
└── kustomization.yaml           # 可选，用 kustomize 管理 overlay
```

## 子任务

### 18.1 Namespace 与基础资源
- [ ] 创建 `castrel` namespace
- [ ] ConfigMap `app-config`：
  ```yaml
  SPRING_DATASOURCE_URL: jdbc:mysql://mysql:3306/castrel_chaos
  SPRING_REDIS_HOST: redis
  SPRING_PROFILES_ACTIVE: docker,chaos
  ```
- [ ] Secret `db-secret`：MySQL 用户名密码

### 18.2 基础设施 Deployment
- [ ] MySQL StatefulSet（PVC 持久化数据目录）
- [ ] Redis Deployment（可接受重启丢失，使用 emptyDir）
- [ ] Prometheus、Grafana、Loki、Tempo Deployment（挂载 ConfigMap）
- [ ] ToxiProxy Deployment（可选，或使用 Chaos Mesh 替代）

### 18.3 业务服务 Deployment（每服务通用模板）
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-service
  namespace: castrel
spec:
  replicas: 1
  selector:
    matchLabels:
      app: order-service
  template:
    metadata:
      labels:
        app: order-service
    spec:
      containers:
        - name: order-service
          image: castrel/order-service:latest
          ports:
            - containerPort: 8084
          envFrom:
            - configMapRef:
                name: app-config
            - secretRef:
                name: db-secret
          resources:
            requests:
              memory: "256Mi"
              cpu: "250m"
            limits:
              memory: "512Mi"
              cpu: "500m"
          readinessProbe:
            httpGet:
              path: /actuator/health
              port: 8084
            initialDelaySeconds: 30
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /actuator/health
              port: 8084
            initialDelaySeconds: 60
            periodSeconds: 30
          env:
            - name: JAVA_OPTS
              value: "-Xms256m -Xmx512m -XX:+HeapDumpOnOutOfMemoryError"
```
- [ ] 按上述模板为全部 11 个业务服务创建 Deployment + ClusterIP Service
- [ ] traffic-runner 设置 `replicas: 1`（单实例，避免重复流量）

### 18.4 Ingress（对外暴露 gateway）
```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: castrel-gateway
  namespace: castrel
spec:
  rules:
    - host: castrel.local
      http:
        paths:
          - path: /api
            pathType: Prefix
            backend:
              service:
                name: gateway-service
                port:
                  number: 8080
          - path: /internal
            pathType: Prefix
            backend:
              service:
                name: gateway-service
                port:
                  number: 8080
```

### 18.5 Chaos Mesh 安装
```bash
# 使用 Helm 安装 Chaos Mesh
helm repo add chaos-mesh https://charts.chaos-mesh.org
helm install chaos-mesh chaos-mesh/chaos-mesh \
  --namespace=chaos-mesh --create-namespace \
  --set chaosDaemon.runtime=containerd \
  --set chaosDaemon.socketPath=/run/containerd/containerd.sock
```
- [ ] 验证 Chaos Mesh Dashboard 可访问（`port-forward chaos-dashboard`）

### 18.6 镜像构建
- [ ] 每个服务根目录添加 `Dockerfile`：
  ```dockerfile
  FROM eclipse-temurin:21-jre-alpine
  WORKDIR /app
  COPY target/*.jar app.jar
  ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]
  ```
- [ ] 提供 `scripts/build-all.sh`：循环 `mvn package -pl <service> -DskipTests && docker build`

### 18.7 一键部署脚本
```bash
# scripts/k8s-deploy.sh
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/configmap/
kubectl apply -f k8s/secrets/
kubectl apply -f k8s/infra/
kubectl apply -f k8s/services/
kubectl apply -f k8s/ingress/
```

### 18.8 验证
- [ ] `kubectl get pods -n castrel` 全部 Running
- [ ] `curl http://castrel.local/api/products` 返回商品列表
- [ ] Grafana 数据源全绿（通过 port-forward 访问）
- [ ] Chaos Mesh Dashboard 可应用 `network-delay.yaml`，故障注入生效
