# 场景与业务接口映射

控制面使用场景代码管理运行生命周期；业务服务只暴露正常业务语义的内部能力，不在类名、方法名或 HTTP 路径中使用故障演练、故障注入等词汇。下表是场景代码与固定业务接口的唯一映射，接口均由 Gateway 固定转发，不接受任意目标地址。

## 锁分组

| 场景代码 | 业务目标 | 准备接口 | 释放接口 | 清理接口 | 观测接口 |
| --- | --- | --- | --- | --- | --- |
| `PROMOTION_LOCK_CONTENTION` | `promotion-service` / `coupon-reservation-consistency` | `POST /internal/promotion/coupons/reservations/prepare` | `POST /internal/promotion/coupons/reservations/release` | `POST /internal/promotion/coupons/reservations/remove` | `POST /internal/promotion/coupons/reservations/consistency` |
| `INVENTORY_TABLE_EXCLUSIVE` | `inventory-service` / `inventory-availability-report` | `POST /internal/inventory/availability/prepare` | `POST /internal/inventory/availability/release` | `POST /internal/inventory/availability/remove` | `POST /internal/inventory/availability/report` |
| `INVENTORY_ROW_LOCK` | `inventory-service` / `inventory-reservation-summary` | `POST /internal/inventory/reservations/prepare` | `POST /internal/inventory/reservations/release` | `POST /internal/inventory/reservations/remove` | `POST /internal/inventory/reservations/summary` |

三个 Inventory 路径彼此独立：availability 使用专用连接执行表级读取保护，reservations 使用另一套专用连接对固定库存记录执行 `SELECT ... FOR UPDATE`，Promotion reservations 使用优惠券预留一致性检查。行锁不复用表锁的准备、释放或观测接口。

## 控制面入口

创建、停止和查询运行仍由受保护的控制面 API 负责。创建请求中的 `scenario` 由 catalog 校验，并只能得到上表中对应的固定目标。worker 只调用对应的观测接口，因此从 Gateway 请求路径即可区分三种锁能力。