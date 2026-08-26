package com.castrel.chaos.gateway.controller;

import com.castrel.chaos.common.ApiResponse;
import com.castrel.chaos.common.TraceContext;
import com.castrel.chaos.gateway.service.FixedInternalDispatchService;
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

    private final FixedInternalDispatchService dispatchService;

    public ReplenishmentDispatchController(FixedInternalDispatchService dispatchService) {
        this.dispatchService = dispatchService;
    }

    @PostMapping("/promotions/demo-coupons/replenish")
    public Mono<ApiResponse<Object>> replenishCoupons(
            @RequestBody(required = false) Map<String, Object> body,
            @RequestHeader(value = TraceContext.TRACE_ID_HEADER, required = false) String traceId) {
        return dispatch(body, traceId, dispatchService::replenishCoupons);
    }

    @PostMapping("/inventory/demo-stock/replenish")
    public Mono<ApiResponse<Object>> replenishStock(
            @RequestBody(required = false) Map<String, Object> body,
            @RequestHeader(value = TraceContext.TRACE_ID_HEADER, required = false) String traceId) {
        return dispatch(body, traceId, dispatchService::replenishStock);
    }

        private Mono<ApiResponse<Object>> dispatch(
            Map<String, Object> body, String traceId,
            java.util.function.Function<String, Mono<Object>> target) {
        if (body != null && !body.isEmpty()) {
            return Mono.error(new ResponseStatusException(
                    HttpStatus.BAD_REQUEST, "Replenishment commands do not accept parameters"));
        }
        return target.apply(traceId)
                .map(ApiResponse::ok);
    }
}