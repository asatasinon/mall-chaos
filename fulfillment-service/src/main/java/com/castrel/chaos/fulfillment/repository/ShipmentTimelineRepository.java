package com.castrel.chaos.fulfillment.repository;

import com.castrel.chaos.fulfillment.entity.ShipmentTimelineEvent;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface ShipmentTimelineRepository extends JpaRepository<ShipmentTimelineEvent, Long> {
    List<ShipmentTimelineEvent> findByShipmentIdOrderByOccurredAtAsc(Long shipmentId);
    boolean existsByShipmentIdAndStatus(Long shipmentId, String status);
}