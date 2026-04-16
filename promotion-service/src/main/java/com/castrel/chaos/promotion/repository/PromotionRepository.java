package com.castrel.chaos.promotion.repository;

import com.castrel.chaos.promotion.entity.Promotion;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.LocalDateTime;
import java.util.List;

public interface PromotionRepository extends JpaRepository<Promotion, Long> {

    List<Promotion> findByEnabledAndEndAtAfterOrEndAtIsNull(Integer enabled, LocalDateTime now);
}
