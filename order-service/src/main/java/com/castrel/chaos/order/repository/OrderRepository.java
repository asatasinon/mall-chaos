package com.castrel.chaos.order.repository;

import com.castrel.chaos.order.entity.Order;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface OrderRepository extends JpaRepository<Order, Long> {

    Optional<Order> findByOrderNo(String orderNo);

    Optional<Order> findByUserIdAndIdempotencyKey(Long userId, String idempotencyKey);
}
