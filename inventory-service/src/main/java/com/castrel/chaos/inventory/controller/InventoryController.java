package com.castrel.chaos.inventory.controller;

import com.castrel.chaos.common.ApiResponse;
import com.castrel.chaos.inventory.dto.ReserveRequest;
import com.castrel.chaos.inventory.dto.ResetRequest;
import com.castrel.chaos.inventory.service.InventoryService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
public class InventoryController {

    @Autowired
    private InventoryService inventoryService;

    @PostMapping("/internal/inventory/reserve")
    public ApiResponse<Map<String, Object>> reserve(@RequestBody ReserveRequest req) {
        return ApiResponse.ok(inventoryService.reserve(req.getOrderId(), req.getSku(), req.getQty()));
    }

    @PostMapping("/internal/inventory/release")
    public ApiResponse<Void> release(@RequestBody ReserveRequest req) {
        inventoryService.release(req.getOrderId(), req.getSku(), req.getQty(),
                req.getReservationId() == null ? req.getOrderId() + ":" + req.getSku() : req.getReservationId());
        return ApiResponse.ok();
    }

    @PostMapping("/internal/inventory/confirm")
    public ApiResponse<Void> confirm(@RequestBody ReserveRequest req) {
        inventoryService.confirm(req.getOrderId(), req.getSku(), req.getReservationId());
        return ApiResponse.ok();
    }

    @PostMapping("/internal/inventory/expire")
    public ApiResponse<Void> expire(@RequestBody ReserveRequest req) {
        inventoryService.expire(req.getReservationId(), req.getSku());
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
