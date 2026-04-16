package com.castrel.chaos.risk.entity;

import jakarta.persistence.*;
import lombok.Data;

@Entity
@Table(name = "risk_rules")
@Data
public class RiskRule {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "rule_type", length = 32, nullable = false)
    private String ruleType; // FREQ_LIMIT / AMOUNT_LIMIT / BLACKLIST

    private Integer threshold;

    @Column(name = "window_sec")
    private Integer windowSec;

    @Column(nullable = false)
    private Integer enabled = 1;

    @Column(length = 256)
    private String description;
}
