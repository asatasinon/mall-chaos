package com.castrel.chaos.runner.entity;

import jakarta.persistence.*;
import lombok.Data;

@Entity
@Table(name = "runner_inventory_reset_policy")
@Data
public class RunnerInventoryResetPolicy {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private Integer enabled;

    @Column(name = "cron_expr")
    private String cronExpr;

    private String timezone;

    @Column(name = "allowed_window")
    private String allowedWindow;

    @Column(name = "reset_scope")
    private String resetScope;

    @Column(name = "baseline_version")
    private Integer baselineVersion;

    private Integer version;
}
