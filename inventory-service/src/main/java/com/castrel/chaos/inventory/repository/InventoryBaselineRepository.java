package com.castrel.chaos.inventory.repository;

import com.castrel.chaos.inventory.entity.InventoryBaselineSnapshot;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface InventoryBaselineRepository extends JpaRepository<InventoryBaselineSnapshot, Long> {

    Optional<InventoryBaselineSnapshot> findFirstByOrderByBaselineVersionAsc();
}
