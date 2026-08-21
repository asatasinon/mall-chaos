package com.castrel.chaos.inventory.repository;

import com.castrel.chaos.inventory.entity.InventoryReservation;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface InventoryReservationRepository extends JpaRepository<InventoryReservation, Long> {
    Optional<InventoryReservation> findByReservationIdAndSku(String reservationId, String sku);
    Optional<InventoryReservation> findByOperationIdAndSku(String operationId, String sku);
}