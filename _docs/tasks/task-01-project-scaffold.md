# Task 01 — Maven 多模块脚手架

**阶段**：Phase 0 — 基础搭建  
**依赖**：无  
**产出**：可编译的 Maven 多模块项目骨架

---

## 目标
建立整个项目的 Maven 多模块父子结构，定义统一依赖版本，确保每个服务模块可独立打包。

## 模块结构
```
castrel-chaos/
├── pom.xml                          # 父 POM（dependencyManagement）
├── common/                          # 公共库（共享 DTO、异常、响应封装）
├── gateway-service/
├── user-service/
├── catalog-service/
├── inventory-service/
├── order-service/
├── payment-service/
├── traffic-control-plane/
├── promotion-service/
├── risk-service/
├── fulfillment-service/
└── notification-service/
```

## 子任务

### 1.1 父 POM 配置
- [ ] 创建根 `pom.xml`，`<packaging>pom</packaging>`
- [ ] 声明 `<modules>`，列出全部 12 个子模块（含 `common`）
- [ ] 在 `<properties>` 锁定版本：
  - `java.version=21`
  - `spring-boot.version=3.3.x`（最新 GA）
  - `spring-cloud.version`（如需 Gateway）
- [ ] `<dependencyManagement>` 导入 Spring Boot BOM、Spring Cloud BOM
- [ ] 配置 `spring-boot-maven-plugin`（子模块按需覆盖）

### 1.2 common 模块
- [ ] 创建 `common/pom.xml`（jar 包，无 main class）
- [ ] 公共类：
  - `ApiResponse<T>`（`code`, `message`, `data`）
  - `BizException`（含 `errorCode`）
  - `TraceContext`（traceId 透传工具）
  - `ChaosScope` 枚举（`ALL`, `PARTIAL`）
- [ ] 公共依赖：`spring-boot-starter`, `lombok`, `jackson`

### 1.3 各服务模块骨架
对每个服务模块执行：
- [ ] 创建 `<module>/pom.xml`，继承父 POM，依赖 `common`
- [ ] 创建主启动类 `XxxApplication.java`，`@SpringBootApplication`
- [ ] 创建 `src/main/resources/application.yml`（最小配置：`server.port`, `spring.application.name`）
- [ ] 服务端口分配：

  | 服务 | 端口 |
  |---|---|
  | gateway-service | 8080 |
  | user-service | 8081 |
  | catalog-service | 8082 |
  | inventory-service | 8083 |
  | order-service | 8084 |
  | payment-service | 8085 |
  | traffic-control-plane | 8086 |
  | promotion-service | 8087 |
  | risk-service | 8088 |
  | fulfillment-service | 8089 |
  | notification-service | 8090 |

### 1.4 编译验证
- [ ] 根目录执行 `mvn clean package -DskipTests`，所有模块 BUILD SUCCESS
- [ ] 确认每个服务模块生成可执行 JAR

## 技术要点
- 父 POM `<build><pluginManagement>` 统一配置 `maven-compiler-plugin`，指定 `--enable-preview` 或直接 `release=21`
- `common` 不打可执行 JAR，配置 `<skip>true</skip>` 于 `spring-boot-maven-plugin`
- 所有服务默认激活 `local` profile，`chaos` profile 仅在 chaos 接口所在模块按需声明
