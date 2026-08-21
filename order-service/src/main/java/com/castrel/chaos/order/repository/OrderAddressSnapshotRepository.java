package com.castrel.chaos.order.repository;

import com.castrel.chaos.order.entity.OrderAddressSnapshot;
import org.springframework.data.jpa.repository.JpaRepository;

public interface OrderAddressSnapshotRepository extends JpaRepository<OrderAddressSnapshot, Long> {
}
