package com.castrel.chaos.inventory.repository;

import com.castrel.chaos.inventory.entity.Inventory;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;

public interface InventoryRepository extends JpaRepository<Inventory, Long> {

    Optional<Inventory> findBySku(String sku);

    @Modifying
    @Query("UPDATE Inventory i SET i.availableQty = i.availableQty - :qty, " +
           "i.reservedQty = i.reservedQty + :qty, i.version = i.version + 1 " +
           "WHERE i.sku = :sku AND i.availableQty >= :qty AND i.version = :version")
    int reserve(@Param("sku") String sku, @Param("qty") int qty, @Param("version") int version);

    @Modifying
    @Query("UPDATE Inventory i SET i.availableQty = i.availableQty + :qty, " +
           "i.reservedQty = i.reservedQty - :qty, i.version = i.version + 1 " +
           "WHERE i.sku = :sku")
    int release(@Param("sku") String sku, @Param("qty") int qty);
}
