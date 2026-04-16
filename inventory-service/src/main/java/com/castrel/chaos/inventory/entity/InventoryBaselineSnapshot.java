package com.castrel.chaos.inventory.entity;

import jakarta.persistence.*;
import lombok.Data;

import java.time.LocalDateTime;

@Entity
@Table(name = "inventory_baseline_snapshot")
@Data
public class InventoryBaselineSnapshot {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String sku;

    @Column(name = "baseline_qty")
    private Integer baselineQty;

    @Column(name = "baseline_version")
    private Integer baselineVersion;

    @Column(name = "updated_at")
    private LocalDateTime updatedAt;
}
