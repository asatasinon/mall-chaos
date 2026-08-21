package com.castrel.chaos.cart.controller;

import com.castrel.chaos.cart.dto.CartDTO;
import com.castrel.chaos.cart.dto.CartItemRequest;
import com.castrel.chaos.cart.dto.CheckoutFreezeDTO;
import com.castrel.chaos.cart.dto.CheckoutFreezeRequest;
import com.castrel.chaos.cart.service.CartService;
import com.castrel.chaos.common.ApiResponse;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/cart")
public class CartController {
    private final CartService cartService;

    public CartController(CartService cartService) {
        this.cartService = cartService;
    }

    @GetMapping
    public ApiResponse<CartDTO> getCart(@RequestHeader("X-User-Id") Long customerId) {
        return ApiResponse.ok(cartService.getCart(customerId));
    }

    @PostMapping("/items")
    public ApiResponse<CartDTO> addItem(
            @RequestHeader("X-User-Id") Long customerId, @RequestBody CartItemRequest request) {
        return ApiResponse.ok(cartService.addItem(customerId, request));
    }

    @PatchMapping("/items/{itemId}")
    public ApiResponse<CartDTO> updateItem(
            @RequestHeader("X-User-Id") Long customerId,
            @PathVariable Long itemId,
            @RequestBody CartItemRequest request) {
        return ApiResponse.ok(cartService.updateItem(customerId, itemId, request));
    }

    @DeleteMapping("/items/{itemId}")
    public ApiResponse<CartDTO> removeItem(
            @RequestHeader("X-User-Id") Long customerId, @PathVariable Long itemId) {
        return ApiResponse.ok(cartService.removeItem(customerId, itemId));
    }

    @DeleteMapping
    public ApiResponse<CartDTO> clear(@RequestHeader("X-User-Id") Long customerId) {
        return ApiResponse.ok(cartService.clear(customerId));
    }

    @PostMapping("/internal/freeze")
    public ApiResponse<CheckoutFreezeDTO> freeze(
            @RequestHeader("X-User-Id") Long customerId,
            @RequestBody CheckoutFreezeRequest request) {
        return ApiResponse.ok(cartService.freeze(customerId, request));
    }

    @PostMapping("/internal/freeze/{checkoutId}/release")
    public ApiResponse<Void> release(
            @RequestHeader("X-User-Id") Long customerId,
            @PathVariable String checkoutId,
            @RequestHeader("X-Checkout-Freeze-Token") String token) {
        cartService.releaseFreeze(customerId, checkoutId, token);
        return ApiResponse.ok();
    }

    @PostMapping("/internal/freeze/{checkoutId}/consume")
    public ApiResponse<Void> consume(
            @RequestHeader("X-User-Id") Long customerId,
            @PathVariable String checkoutId,
            @RequestHeader("X-Checkout-Freeze-Token") String token) {
        cartService.consumeFreeze(customerId, checkoutId, token);
        return ApiResponse.ok();
    }
}
