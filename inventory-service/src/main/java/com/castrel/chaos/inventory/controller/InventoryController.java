package com.castrel.chaos.inventory.controller;

import com.castrel.chaos.common.ApiResponse;
import com.castrel.chaos.common.BizException;
import com.castrel.chaos.common.security.JwtTokenService;
import com.castrel.chaos.inventory.dto.DemoInventoryReplenishmentResult;
import org.springframework.beans.factory.annotation.Value;
import com.castrel.chaos.inventory.dto.ReserveRequest;
import com.castrel.chaos.inventory.dto.ResetRequest;
import com.castrel.chaos.inventory.dto.InventoryOperationRequest;
import com.castrel.chaos.inventory.service.InventoryService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

@RestController
public class InventoryController {

    @Autowired
    private InventoryService inventoryService;

    @Autowired
    private JwtTokenService jwtTokenService;

    @Value("${CASTREL_INTERNAL_SERVICE_KEY:}")
    private String internalServiceKey;

    @PostMapping("/internal/inventory/demo-stock/replenish")
    public ApiResponse<DemoInventoryReplenishmentResult> replenishDemoStock(
            @RequestBody(required = false) Map<String, Object> body,
            @RequestHeader(value = "X-Downstream-Principal", required = false) String downstreamPrincipal,
            @RequestHeader(value = "X-Internal-Service-Key", required = false) String suppliedServiceKey) {
        if (body != null && !body.isEmpty()) {
            throw new BizException("INVALID_REPLENISHMENT_REQUEST",
                    "Replenishment command does not accept parameters");
        }
        if (!hasReplenishmentAuthority(downstreamPrincipal, suppliedServiceKey)) {
            throw new BizException("REPLENISHMENT_FORBIDDEN",
                    "Replenishment service authentication required");
        }
        return ApiResponse.ok(inventoryService.replenishDemoInventory());
    }

    private boolean hasReplenishmentAuthority(String downstreamPrincipal, String suppliedServiceKey) {
        if (!internalServiceKey.isBlank() && suppliedServiceKey != null
                && MessageDigest.isEqual(internalServiceKey.getBytes(StandardCharsets.UTF_8),
                        suppliedServiceKey.getBytes(StandardCharsets.UTF_8))) {
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

    @PostMapping("/internal/inventory/reserve")
    public ApiResponse<Map<String, Object>> reserve(@RequestBody ReserveRequest req) {
        return ApiResponse.ok(inventoryService.reserve(req.getOrderId(), req.getSku(), req.getQty(),
            req.getReservationId(), req.getOperationId()));
    }

    @PostMapping("/internal/inventory/release")
    public ApiResponse<Void> release(@RequestBody InventoryOperationRequest req) {
        inventoryService.release(req.getOrderId(), req.getSku(), req.getReservationId(), req.getOperationId());
        return ApiResponse.ok();
    }

    @PostMapping("/internal/inventory/confirm")
    public ApiResponse<Void> confirm(@RequestBody InventoryOperationRequest req) {
        inventoryService.confirm(req.getOrderId(), req.getSku(), req.getReservationId(), req.getOperationId());
        return ApiResponse.ok();
    }

    @PostMapping("/internal/inventory/expire")
    public ApiResponse<Void> expire(@RequestBody InventoryOperationRequest req) {
        inventoryService.expire(req.getReservationId(), req.getSku(), req.getOperationId());
        return ApiResponse.ok();
    }

    @GetMapping("/internal/inventory/{sku}")
    public ApiResponse<Map<String, Object>> query(@PathVariable String sku) {
        return ApiResponse.ok(inventoryService.query(sku));
    }

    @PostMapping("/internal/inventory/reset/plan")
    public ApiResponse<List<Map<String, Object>>> resetPlan() {
        return ApiResponse.ok(inventoryService.resetPlan());
    }

    @PostMapping("/internal/inventory/reset")
    public ApiResponse<Map<String, Object>> reset(@RequestBody ResetRequest req) {
        return ApiResponse.ok(inventoryService.reset(req));
    }
}
