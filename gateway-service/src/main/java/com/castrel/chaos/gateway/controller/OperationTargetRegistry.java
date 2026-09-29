package com.castrel.chaos.gateway.controller;

import java.util.Map;

public final class OperationTargetRegistry {

    private static final Map<String, Target> TARGETS = Map.ofEntries(
            Map.entry("products-browse-report", new Target("catalog-service", "/internal/catalog/reports/product-browse/prepare", "/internal/catalog/reports/product-browse/release", "/internal/catalog/reports/product-browse/cleanup")),
            Map.entry("orders-query-report", new Target("order-service", "/internal/orders/reports/order-query/prepare", "/internal/orders/reports/order-query/release", "/internal/orders/reports/order-query/cleanup")),
            Map.entry("product-detail-cache", new Target("catalog-service", "/internal/catalog/product-details/cache/prepare", "/internal/catalog/product-details/cache/release", "/internal/catalog/product-details/cache/cleanup")),
            Map.entry("cart-product-validation", new Target("catalog-service", "/internal/catalog/dependencies/cart-product-validation/prepare", "/internal/catalog/dependencies/cart-product-validation/release", "/internal/catalog/dependencies/cart-product-validation/cleanup")),
            Map.entry("notification-retention", new Target("notification-service", "/internal/notification/retention/prepare", "/internal/notification/retention/release", "/internal/notification/retention/cleanup")),
            Map.entry("notification-storage", new Target("notification-service", "/internal/notification/storage/prepare", "/internal/notification/storage/release", "/internal/notification/storage/cleanup")),
            Map.entry("coupon-reservation-consistency", new Target("promotion-service", "/internal/promotion/coupons/reservations/prepare", "/internal/promotion/coupons/reservations/release", "/internal/promotion/coupons/reservations/remove")),
            Map.entry("inventory-availability-report", new Target("inventory-service", "/internal/inventory/availability/prepare", "/internal/inventory/availability/release", "/internal/inventory/availability/remove")),
            Map.entry("inventory-reservation-summary", new Target("inventory-service", "/internal/inventory/reservations/prepare", "/internal/inventory/reservations/release", "/internal/inventory/reservations/remove")),
            Map.entry("provider-outcome", new Target("psp-simulator", "/internal/psp/provider-outcome/prepare", "/internal/psp/provider-outcome/release", "/internal/psp/provider-outcome/cleanup"))
    );

    private OperationTargetRegistry() {
    }

    public static Map<String, Target> entries() {
        return TARGETS;
    }

    public static Target find(Object operation) {
        return operation instanceof String name ? TARGETS.get(name) : null;
    }

    public record Target(String service, String preparePath, String releasePath, String cleanupPath) {
    }
}
