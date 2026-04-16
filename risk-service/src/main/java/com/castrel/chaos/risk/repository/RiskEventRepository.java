package com.castrel.chaos.risk.repository;

import com.castrel.chaos.risk.entity.RiskEvent;
import org.springframework.data.jpa.repository.JpaRepository;

public interface RiskEventRepository extends JpaRepository<RiskEvent, Long> {
}
