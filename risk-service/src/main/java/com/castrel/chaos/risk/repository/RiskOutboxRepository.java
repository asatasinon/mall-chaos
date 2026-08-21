package com.castrel.chaos.risk.repository;

import com.castrel.chaos.risk.entity.RiskOutboxEvent;
import org.springframework.data.jpa.repository.JpaRepository;

public interface RiskOutboxRepository extends JpaRepository<RiskOutboxEvent, Long> {
}