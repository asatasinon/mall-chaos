package com.castrel.chaos.inventory.repository;

import com.castrel.chaos.inventory.entity.InventoryReplenishmentBatch;
import org.springframework.data.jpa.repository.JpaRepository;

public interface InventoryReplenishmentBatchRepository extends JpaRepository<InventoryReplenishmentBatch, Long> {
    boolean existsByWindowIdAndSku(String windowId, String sku);
}
