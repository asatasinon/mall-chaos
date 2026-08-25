package com.castrel.chaos.promotion.repository;

import com.castrel.chaos.promotion.entity.CouponIssuanceBatch;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CouponIssuanceBatchRepository extends JpaRepository<CouponIssuanceBatch, Long> {
    boolean existsByWindowIdAndCustomerIdAndPromotionId(
            String windowId, Long customerId, Long promotionId);
}
