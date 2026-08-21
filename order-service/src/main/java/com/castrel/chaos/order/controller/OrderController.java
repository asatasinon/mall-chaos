package com.castrel.chaos.order.controller;

import com.castrel.chaos.common.ApiResponse;
import com.castrel.chaos.order.dto.CreateOrderRequest;
import com.castrel.chaos.order.dto.OrderDTO;
import com.castrel.chaos.order.dto.CheckoutCommand;
import com.castrel.chaos.order.service.OrderService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;

@RestController
public class OrderController {

    @Autowired
    private OrderService orderService;

    @PostMapping("/api/checkout")
    public ApiResponse<OrderDTO> checkout(
            @RequestHeader("X-User-Id") Long customerId,
            @RequestBody CheckoutCommand command) {
        return ApiResponse.ok(orderService.checkout(customerId, command));
    }

    @PostMapping("/api/orders")
    public ApiResponse<OrderDTO> createOrder(@RequestBody CreateOrderRequest req) {
        return ApiResponse.ok(orderService.createOrder(req));
    }

    @GetMapping("/api/orders/{id}")
    public ApiResponse<OrderDTO> getOrder(
            @RequestHeader("X-User-Id") Long customerId, @PathVariable Long id) {
        return ApiResponse.ok(orderService.getCustomerOrder(customerId, id));
    }

    @GetMapping("/api/orders")
    public ApiResponse<Page<OrderDTO>> listOrders(
            @RequestHeader("X-User-Id") Long customerId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return ApiResponse.ok(orderService.listCustomerOrders(
                customerId, PageRequest.of(Math.max(page, 0), Math.min(Math.max(size, 1), 100))));
    }

    @PostMapping("/internal/orders/create")
    public ApiResponse<OrderDTO> createOrderInternal(@RequestBody CreateOrderRequest req) {
        return ApiResponse.ok(orderService.createOrder(req));
    }

    @PostMapping("/api/orders/{id}/cancel")
    public ApiResponse<OrderDTO> cancelOrderPublic(
            @RequestHeader("X-User-Id") Long customerId, @PathVariable Long id) {
        return ApiResponse.ok(orderService.cancelCustomerOrder(customerId, id));
    }

    @PostMapping("/internal/orders/{id}/cancel")
    public ApiResponse<OrderDTO> cancelOrder(@PathVariable Long id) {
        return ApiResponse.ok(orderService.cancelOrder(id));
    }
}
