package com.castrel.chaos.order.client;

import com.castrel.chaos.common.ApiResponse;
import com.castrel.chaos.common.TraceContext;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.boot.web.client.RestTemplateBuilder;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import com.castrel.chaos.order.dto.CheckoutFreeze;
import com.castrel.chaos.order.dto.CheckoutCommand;

@Component
public class DownstreamClients {

    private final RestTemplate client;
    private final ObjectMapper mapper = new ObjectMapper();

    @Value("${services.user-url:http://localhost:8081}")
    private String userUrl;

    @Value("${services.catalog-url:http://localhost:8082}")
    private String catalogUrl;

    @Value("${services.inventory-url:http://localhost:8083}")
    private String inventoryUrl;

    @Value("${services.payment-url:http://localhost:8085}")
    private String paymentUrl;

    @Value("${services.risk-url:http://localhost:18088}")
    private String riskUrl;

    @Value("${services.promotion-url:http://localhost:18087}")
    private String promotionUrl;

    @Value("${services.cart-url:http://cart-service:8091}")
    private String cartUrl;

    public DownstreamClients(RestTemplateBuilder builder) {
        this.client = builder.build();
    }

    private HttpHeaders headersWithTrace() {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        String tid = TraceContext.getTraceId();
        if (tid != null) {
            headers.set(TraceContext.TRACE_ID_HEADER, tid);
        }
        ServletRequestAttributes attributes =
                (ServletRequestAttributes) RequestContextHolder.getRequestAttributes();
        if (attributes != null) {
            String principal = attributes.getRequest().getHeader("X-Downstream-Principal");
            if (principal != null && !principal.isBlank()) {
                headers.set("X-Downstream-Principal", principal);
            }
            String userId = attributes.getRequest().getHeader("X-User-Id");
            if (userId != null && !userId.isBlank()) {
                headers.set("X-User-Id", userId);
            }
        }
        return headers;
    }

    private <T> T exchange(String url, HttpMethod method, Object body, Class<T> responseType) {
        HttpEntity<?> entity = body == null
                ? new HttpEntity<>(headersWithTrace())
                : new HttpEntity<>(body, headersWithTrace());
        return client.exchange(url, method, entity, responseType).getBody();
    }

    public Map<String, Object> getUser(Long userId) {
        return exchange(userUrl + "/internal/users/" + userId, HttpMethod.GET, null, Map.class);
    }

    public Map<String, Object> getDefaultAddress(Long userId) {
        return exchange(userUrl + "/internal/users/" + userId + "/address", HttpMethod.GET, null, Map.class);
    }

    public Map<String, Object> getAddress(Long userId, Long addressId) {
        return exchange(userUrl + "/internal/users/" + userId + "/address/" + addressId,
                HttpMethod.GET, null, Map.class);
    }

    public List<Map<String, Object>> batchCatalog(List<String> skus) {
        Map<String, Object> reqBody = Map.of("skus", skus);
        Map<String, Object> resp = exchange(catalogUrl + "/internal/catalog/batch", HttpMethod.POST, reqBody, Map.class);
        Object data = ((Map<?, ?>) resp).get("data");
        if (data instanceof Map<?, ?> dataMap) {
            return (List<Map<String, Object>>) dataMap.get("products");
        }
        return List.of();
    }

    public void releaseInventory(String orderId, String sku, String reservationId) {
        Map<String, Object> body = Map.of("orderId", orderId, "sku", sku, "reservationId", reservationId, "qty", 0);
        exchange(inventoryUrl + "/internal/inventory/release", HttpMethod.POST, body, Map.class);
    }

    public void releaseCoupon(String orderId, Long couponId) {
        exchange(promotionUrl + "/internal/promotions/" + orderId + "/coupon/" + couponId + "/release",
                HttpMethod.POST, Map.of(), Map.class);
    }

    public void confirmCoupon(String orderId, Long couponId) {
        exchange(promotionUrl + "/internal/promotions/" + orderId + "/coupon/" + couponId + "/confirm",
                HttpMethod.POST, Map.of(), Map.class);
    }

    public void confirmInventory(String orderId, String sku, String reservationId) {
        exchange(inventoryUrl + "/internal/inventory/confirm", HttpMethod.POST,
                Map.of("orderId", orderId, "sku", sku, "reservationId", reservationId), Map.class);
    }

    public void expireInventory(String reservationId, String sku) {
        exchange(inventoryUrl + "/internal/inventory/expire", HttpMethod.POST,
                Map.of("reservationId", reservationId, "sku", sku), Map.class);
    }

    public Map<String, Object> retryPayment(Long paymentId) {
        Map<String, Object> response = exchange(paymentUrl + "/internal/payments/" + paymentId + "/retry",
                HttpMethod.POST, Map.of(), Map.class);
        return (Map<String, Object>) ((Map<?, ?>) response).get("data");
    }

    public Map<String, Object> charge(String orderId, String orderNo, Long userId, BigDecimal amount) {
        Map<String, Object> reqBody = Map.of(
                "orderId", orderId, "orderNo", orderNo, "userId", userId, "amount", amount);
    Map<String, Object> resp = exchange(paymentUrl + "/internal/payments/charge", HttpMethod.POST, reqBody, Map.class);
        return (Map<String, Object>) ((Map<?, ?>) resp).get("data");
    }

    public CheckoutFreeze freezeCart(Long userId, CheckoutCommand command) {
        Map<String, Object> body = Map.of(
                "checkoutId", command.getIdempotencyKey(),
                "cartId", command.getCartId(),
                "cartVersion", command.getCartVersion());
        Map<String, Object> response = exchange(
            cartUrl + "/api/cart/internal/freeze", HttpMethod.POST, body, Map.class);
        return mapper.convertValue(((Map<?, ?>) response).get("data"), CheckoutFreeze.class);
    }

    public void releaseCartFreeze(String checkoutId, String token) {
        HttpHeaders headers = headersWithTrace();
        headers.set("X-Checkout-Freeze-Token", token);
        ServletRequestAttributes attributes =
            (ServletRequestAttributes) RequestContextHolder.getRequestAttributes();
        if (attributes != null) {
            String userId = attributes.getRequest().getHeader("X-User-Id");
            if (userId != null) headers.set("X-User-Id", userId);
        }
        client.exchange(cartUrl + "/api/cart/internal/freeze/" + checkoutId + "/release",
                HttpMethod.POST, new HttpEntity<>(headers), Map.class);
    }

    public void consumeCartFreeze(String checkoutId, String token) {
        HttpHeaders headers = headersWithTrace();
        headers.set("X-Checkout-Freeze-Token", token);
        ServletRequestAttributes attributes =
                (ServletRequestAttributes) RequestContextHolder.getRequestAttributes();
        if (attributes != null) {
            String userId = attributes.getRequest().getHeader("X-User-Id");
            if (userId != null) headers.set("X-User-Id", userId);
        }
        client.exchange(cartUrl + "/api/cart/internal/freeze/" + checkoutId + "/consume",
                HttpMethod.POST, new HttpEntity<>(headers), Map.class);
    }

    public Map<String, Object> reserveInventory(String orderId, String sku, int qty,
                            String reservationId, String operationId) {
        Map<String, Object> reqBody = Map.of("orderId", orderId, "sku", sku, "qty", qty,
            "reservationId", reservationId, "operationId", operationId);
        Map<String, Object> resp = exchange(inventoryUrl + "/internal/inventory/reserve",
            HttpMethod.POST, reqBody, Map.class);
        return (Map<String, Object>) ((Map<?, ?>) resp).get("data");
    }

    public Map<String, Object> preCheckRisk(Long userId, String orderNo, BigDecimal amount,
                                String sku, int qty) {
            Map<String, Object> body = Map.of("userId", userId, "orderNo", orderNo,
                "amount", amount, "sku", sku, "qty", qty);
            Map<String, Object> response = exchange(riskUrl + "/internal/risk/pre-check",
                HttpMethod.POST, body, Map.class);
            return (Map<String, Object>) ((Map<?, ?>) response).get("data");
    }

            public Map<String, Object> calculatePromotion(Long userId, String orderNo,
                                                          List<Map<String, Object>> items) {
                Map<String, Object> response = exchange(promotionUrl + "/internal/promotions/calculate",
                        HttpMethod.POST, Map.of("userId", userId, "orderId", orderNo, "skus", items), Map.class);
                return (Map<String, Object>) ((Map<?, ?>) response).get("data");
            }
}
