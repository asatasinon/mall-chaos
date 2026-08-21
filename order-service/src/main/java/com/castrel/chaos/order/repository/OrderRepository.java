package com.castrel.chaos.order.repository;

import com.castrel.chaos.order.entity.Order;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;

public interface OrderRepository extends JpaRepository<Order, Long> {

    Optional<Order> findByOrderNo(String orderNo);

    Optional<Order> findByUserIdAndIdempotencyKey(Long userId, String idempotencyKey);

    @Modifying
    @Query("update Order o set o.status = 'CANCELLED', o.updatedAt = CURRENT_TIMESTAMP, o.version = o.version + 1 "
            + "where o.id = :id and o.version = :version and o.status in ('PENDING', 'PENDING_PAYMENT')")
    int cancelPending(@Param("id") Long id, @Param("version") Integer version);
}
