package com.castrel.chaos.gateway.controller;

import com.castrel.chaos.common.ApiResponse;
import com.castrel.chaos.common.TraceContext;
import com.castrel.chaos.gateway.service.ChaosDispatchService;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import reactor.core.publisher.Mono;

import java.util.Map;

@RestController
@RequestMapping("/internal/gateway")
public class ReplenishmentDispatchController {

    private final ChaosDispatchService dispatchService;

    public ReplenishmentDispatchController(ChaosDispatchService dispatchService) {
        this.dispatchService = dispatchService;
    }

    @PostMapping("/promotions/demo-coupons/replenish")
    public Mono<ApiResponse<Object>> replenishCoupons(
            @RequestBody(required = false) Map<String, Object> body,
            @RequestHeader(value = TraceContext.TRACE_ID_HEADER, required = false) String traceId) {
        return dispatch("promotion-service", "/internal/promotions/demo-coupons/replenish", body, traceId);
    }

    @PostMapping("/inventory/demo-stock/replenish")
    public Mono<ApiResponse<Object>> replenishStock(
            @RequestBody(required = false) Map<String, Object> body,
            @RequestHeader(value = TraceContext.TRACE_ID_HEADER, required = false) String traceId) {
        return dispatch("inventory-service", "/internal/inventory/demo-stock/replenish", body, traceId);
    }

    private Mono<ApiResponse<Object>> dispatch(
            String serviceName, String targetPath, Map<String, Object> body, String traceId) {
        if (body != null && !body.isEmpty()) {
            return Mono.error(new ResponseStatusException(
                    HttpStatus.BAD_REQUEST, "Replenishment commands do not accept parameters"));
        }
        return dispatchService.postToServiceAsInternal(serviceName, targetPath, Map.of(), traceId)
                .map(ApiResponse::ok);
    }
}