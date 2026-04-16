package com.castrel.chaos.runner.entity;

import jakarta.persistence.*;
import lombok.Data;

@Entity
@Table(name = "runner_mix_rule")
@Data
public class RunnerMixRule {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "action_type")
    private String actionType;

    private Float ratio;

    private Integer version;
}
