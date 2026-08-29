package com.castrel.chaos.inventory.controller;

import com.castrel.chaos.common.ApiResponse;
import com.castrel.chaos.common.BizException;
import com.castrel.chaos.common.security.JwtTokenService;
import com.castrel.chaos.inventory.dto.DemoInventoryReplenishmentResult;
import com.castrel.chaos.inventory.dto.ReserveRequest;
import com.castrel.chaos.inventory.dto.ResetRequest;
import com.castrel.chaos.inventory.dto.InventoryOperationRequest;
import com.castrel.chaos.inventory.service.InventoryService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
public class InventoryController {

    @Autowired
    private InventoryService inventoryService;

    @Autowired
    private JwtTokenService jwtTokenService;

    @PostMapping("/internal/inventory/demo-stock/replenish")
    public ApiResponse<DemoInventoryReplenishmentResult> replenishDemoStock(
            @RequestBody(required = false) Map<String, Object> body,
            @RequestHeader(value = "X-Downstream-Principal", required = false) String downstreamPrincipal,
            @RequestHeader(value = "X-Replenishment-Run-Id", required = false) String runId) {
        if (body != null && !body.isEmpty()) {
            throw new BizException("INVALID_REPLENISHMENT_REQUEST",
                    "Replenishment command does not accept parameters");
        }
        if (!hasReplenishmentAuthority(downstreamPrincipal)) {
            throw new BizException("REPLENISHMENT_FORBIDDEN",
                    "Replenishment service authentication required");
        }
        if (runId == null || !runId.matches("[A-Za-z0-9:_-]{1,64}")) {
            throw new BizException("INVALID_REPLENISHMENT_RUN", "A valid replenishment run ID is required");
        }
        return ApiResponse.ok(inventoryService.replenishDemoInventory(runId));
    }

    private boolean hasReplenishmentAuthority(String downstreamPrincipal) {
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
