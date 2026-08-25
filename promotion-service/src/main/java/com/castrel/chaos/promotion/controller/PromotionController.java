package com.castrel.chaos.promotion.controller;

import com.castrel.chaos.common.ApiResponse;
import com.castrel.chaos.common.BizException;
import com.castrel.chaos.common.security.JwtTokenService;
import com.castrel.chaos.promotion.dto.CouponCandidateDTO;
import com.castrel.chaos.promotion.dto.DemoCouponReplenishmentResult;
import com.castrel.chaos.promotion.dto.PromotionRequest;
import com.castrel.chaos.promotion.dto.PromotionResultDTO;
import com.castrel.chaos.promotion.service.PromotionService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
public class PromotionController {

    @Autowired
    private PromotionService promotionService;

    @Autowired
    private JwtTokenService jwtTokenService;

    @PostMapping("/internal/promotions/demo-coupons/replenish")
    public ApiResponse<DemoCouponReplenishmentResult> replenishDemoCoupons(
            @RequestBody(required = false) Map<String, Object> body,
            @RequestHeader(value = "X-Downstream-Principal", required = false) String downstreamPrincipal,
            @RequestHeader(value = "X-Internal-Service-Key", required = false) String internalServiceKey) {
        if (body != null && !body.isEmpty()) {
            throw new BizException("INVALID_REPLENISHMENT_REQUEST",
                    "Replenishment command does not accept parameters");
        }
        if (!hasReplenishmentAuthority(downstreamPrincipal, internalServiceKey)) {
            throw new BizException("REPLENISHMENT_FORBIDDEN",
                    "Replenishment service authentication required");
        }
        return ApiResponse.ok(promotionService.replenishDemoCouponPool());
    }

    private boolean hasReplenishmentAuthority(String downstreamPrincipal, String internalServiceKey) {
        if (internalServiceKey != null && !internalServiceKey.isBlank()) {
            return true;
        }
        if (downstreamPrincipal == null || downstreamPrincipal.isBlank()) return false;
        try {
            return jwtTokenService.verifyDownstreamPrincipal(downstreamPrincipal)
                    .allowedActions().contains("TRAFFIC_REPLENISH");
        } catch (IllegalArgumentException exception) {
            return false;
        }
    }

    @GetMapping("/api/me/coupons")
    public ApiResponse<List<CouponCandidateDTO>> coupons(
            @RequestParam(defaultValue = "AVAILABLE") String status,
            @RequestHeader(value = "X-Downstream-Principal", required = false) String downstreamPrincipal) {
        if (!"AVAILABLE".equalsIgnoreCase(status)) {
            throw new BizException("INVALID_COUPON_STATUS", "Only AVAILABLE coupons can be queried");
        }
        return ApiResponse.ok(promotionService.findAvailableCoupons(customerId(downstreamPrincipal)));
    }

    private Long customerId(String downstreamPrincipal) {
        if (downstreamPrincipal == null || downstreamPrincipal.isBlank()) {
            throw new BizException("CUSTOMER_PRINCIPAL_REQUIRED", "Customer principal is required");
        }
        try {
            JwtTokenService.DownstreamPrincipal principal =
                    jwtTokenService.verifyDownstreamPrincipal(downstreamPrincipal);
            if (!principal.allowedActions().contains("CUSTOMER_API")) {
                throw new BizException("CUSTOMER_PRINCIPAL_REQUIRED", "Customer principal is required");
            }
            return principal.customerId();
        } catch (IllegalArgumentException exception) {
            throw new BizException("CUSTOMER_PRINCIPAL_REQUIRED", "Customer principal is required", exception);
        }
    }

    @PostMapping("/api/promotions/preview")
    public ApiResponse<PromotionResultDTO> preview(@RequestBody PromotionRequest req) {
        return ApiResponse.ok(promotionService.preview(req));
    }

    @PostMapping("/internal/promotions/calculate")
    public ApiResponse<PromotionResultDTO> calculate(@RequestBody PromotionRequest req) {
        return ApiResponse.ok(promotionService.calculate(req));
    }

    @PostMapping("/internal/promotions/{orderId}/coupon/{couponId}/release")
    public ApiResponse<Void> release(@PathVariable String orderId, @PathVariable Long couponId) {
        promotionService.releaseReservation(orderId, couponId);
        return ApiResponse.ok();
    }

    @PostMapping("/internal/promotions/{orderId}/coupon/{couponId}/confirm")
    public ApiResponse<Void> confirm(@PathVariable String orderId, @PathVariable Long couponId) {
        promotionService.confirmReservation(orderId, couponId);
        return ApiResponse.ok();
    }
}
