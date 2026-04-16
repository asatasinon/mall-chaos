package com.castrel.chaos.runner.entity;

import jakarta.persistence.*;
import lombok.Data;

@Entity
@Table(name = "runner_profile")
@Data
public class RunnerProfile {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private Integer enabled;

    @Column(name = "base_qps")
    private Integer baseQps;

    @Column(name = "peak_multiplier")
    private Float peakMultiplier;

    @Column(name = "cycle_minutes")
    private Integer cycleMinutes;

    @Column(name = "jitter_pct")
    private Float jitterPct;

    private Integer version;
}
