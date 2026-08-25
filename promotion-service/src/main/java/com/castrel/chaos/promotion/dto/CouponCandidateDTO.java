package com.castrel.chaos.promotion.dto;

import java.math.BigDecimal;
import java.time.LocalDateTime;

public record CouponCandidateDTO(
        Long id,
        String promotionType,
        String promotionName,
        BigDecimal minAmount,
        BigDecimal discount,
        BigDecimal reduceAmount,
        LocalDateTime expireAt,
        String status
) {
}