package com.castrel.chaos.order.repository;

import com.castrel.chaos.order.entity.OrderInboxEvent;
import org.springframework.data.jpa.repository.JpaRepository;

public interface OrderInboxRepository extends JpaRepository<OrderInboxEvent, String> {
}