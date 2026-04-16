package com.castrel.chaos.risk.repository;

import com.castrel.chaos.risk.entity.RiskRule;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface RiskRuleRepository extends JpaRepository<RiskRule, Long> {

    List<RiskRule> findByEnabledAndRuleType(Integer enabled, String ruleType);
}
