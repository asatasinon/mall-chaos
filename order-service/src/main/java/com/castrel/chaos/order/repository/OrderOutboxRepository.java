package com.castrel.chaos.order.repository;

import com.castrel.chaos.order.entity.OrderOutboxEvent;
import org.springframework.data.jpa.repository.JpaRepository;

public interface OrderOutboxRepository extends JpaRepository<OrderOutboxEvent, Long> {
}