package com.castrel.chaos.gateway.controller;

import com.castrel.chaos.common.ApiResponse;
import com.castrel.chaos.common.TraceContext;
import com.castrel.chaos.gateway.dto.InventoryResetDispatchRequest;
import com.castrel.chaos.gateway.service.FixedInternalDispatchService;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

import java.util.Map;

@RestController
@RequestMapping("/internal/gateway")
public class InventoryResetDispatchController {

    private static final String INVENTORY_SERVICE = "inventory-service";

        private final FixedInternalDispatchService dispatchService;

        public InventoryResetDispatchController(FixedInternalDispatchService dispatchService) {
        this.dispatchService = dispatchService;
    }

    @PostMapping("/inventory-reset/plan")
    public Mono<ApiResponse<Object>> resetPlan(
            @RequestHeader(value = TraceContext.TRACE_ID_HEADER, required = false) String traceId
    ) {
        return dispatchService.inventoryResetPlan(traceId)
                .map(ApiResponse::ok);
    }

    @PostMapping("/inventory-reset")
    public Mono<ApiResponse<Object>> reset(
            @RequestBody InventoryResetDispatchRequest req,
            @RequestHeader(value = TraceContext.TRACE_ID_HEADER, required = false) String traceId
    ) {
        Map<String, Object> body = Map.of(
                "expectedVersion", req.expectedVersion(),
                "scope", req.scope()
        );
        return dispatchService.inventoryReset(body, traceId)
                .map(ApiResponse::ok);
    }
}
