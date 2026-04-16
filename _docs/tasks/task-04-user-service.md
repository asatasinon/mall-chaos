# Task 04 — user-service

**阶段**：Phase 1 — 基础 7 服务  
**依赖**：Task 01、Task 02  
**产出**：用户资料与收货地址查询服务

---

## 职责
用户资料与收货地址查询，供 order-service 下单编排调用。

## 接口清单

| 方法 | 路径 | 分组 | 说明 |
|---|---|---|---|
| GET | `/api/users/{id}` | 对外 | 获取用户基础信息 |
| GET | `/internal/users/{id}` | 内部 | 供 order-service 获取用户信息 |
| GET | `/internal/users/{id}/address` | 内部 | 返回默认收货地址 |

## 子任务

### 4.1 数据模型

**`users` 表**
```sql
CREATE TABLE users (
    id          BIGINT PRIMARY KEY AUTO_INCREMENT,
    nickname    VARCHAR(64)  NOT NULL,
    level       TINYINT      NOT NULL DEFAULT 1,  -- 1=普通, 2=VIP, 3=SVIP
    status      TINYINT      NOT NULL DEFAULT 1,  -- 1=正常, 0=封禁
    email       VARCHAR(128),
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

**`user_addresses` 表**
```sql
CREATE TABLE user_addresses (
    id          BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id     BIGINT       NOT NULL,
    is_default  TINYINT      NOT NULL DEFAULT 0,
    province    VARCHAR(32),
    city        VARCHAR(32),
    district    VARCHAR(32),
    detail      VARCHAR(256),
    receiver    VARCHAR(64),
    phone       VARCHAR(16),
    INDEX idx_user_id (user_id)
);
```

### 4.2 初始化数据
- [ ] `00-schema.sql` 插入 10–20 条测试用户（id=1~20）
- [ ] 每个用户有 1 条默认地址

### 4.3 实现 UserController
- [ ] `GET /api/users/{id}` → 返回 `UserDTO`（id, nickname, level, status）
- [ ] `GET /internal/users/{id}` → 同上，供内部调用
- [ ] `GET /internal/users/{id}/address` → 返回 `UserAddressDTO`（province, city, district, detail, receiver, phone）
- [ ] 用户不存在时返回 404 + `BizException`

### 4.4 Service & Repository
- [ ] `UserService`，`UserRepository`（Spring Data JPA 或 MyBatis）
- [ ] 查询走 `findById`，无复杂 SQL

### 4.5 actuator & metrics
- [ ] 暴露 `health`、`prometheus`
- [ ] 记录 `user.query.count`（按 userId 维度 tag）

### 4.6 验证
- [ ] `GET /internal/users/1` 返回正确用户信息
- [ ] `GET /internal/users/1/address` 返回地址
- [ ] 不存在用户 ID 返回 404
