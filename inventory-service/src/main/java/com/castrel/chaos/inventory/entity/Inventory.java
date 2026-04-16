package com.castrel.chaos.inventory.entity;

import jakarta.persistence.*;
import lombok.Data;

import java.time.LocalDateTime;

@Entity
@Table(name = "inventories")
@Data
public class Inventory {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String sku;

    @Column(name = "available_qty")
    private Integer availableQty;

    @Column(name = "reserved_qty")
    private Integer reservedQty;

    private Integer version;

    @Column(name = "updated_at")
    private LocalDateTime updatedAt;
}
