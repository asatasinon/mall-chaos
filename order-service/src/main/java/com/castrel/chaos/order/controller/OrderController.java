package com.castrel.chaos.order.controller;

import com.castrel.chaos.common.ApiResponse;
import com.castrel.chaos.order.dto.CreateOrderRequest;
import com.castrel.chaos.order.dto.OrderDTO;
import com.castrel.chaos.order.service.OrderService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

@RestController
public class OrderController {

    @Autowired
    private OrderService orderService;

    @PostMapping("/api/orders")
    public ApiResponse<OrderDTO> createOrder(@RequestBody CreateOrderRequest req) {
        return ApiResponse.ok(orderService.createOrder(req));
    }

    @GetMapping("/api/orders/{id}")
    public ApiResponse<OrderDTO> getOrder(@PathVariable Long id) {
        return ApiResponse.ok(orderService.getOrder(id));
    }

    @PostMapping("/internal/orders/create")
    public ApiResponse<OrderDTO> createOrderInternal(@RequestBody CreateOrderRequest req) {
        return ApiResponse.ok(orderService.createOrder(req));
    }

    @PostMapping("/internal/orders/{id}/cancel")
    public ApiResponse<OrderDTO> cancelOrder(@PathVariable Long id) {
        return ApiResponse.ok(orderService.cancelOrder(id));
    }
}
