package com.castrel.chaos.order.client;

import com.castrel.chaos.common.ApiResponse;
import com.castrel.chaos.common.TraceContext;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

@Component
public class DownstreamClients {

    private final RestClient client;
    private final ObjectMapper mapper = new ObjectMapper();

    @Value("${services.user-url:http://localhost:8081}")
    private String userUrl;

    @Value("${services.catalog-url:http://localhost:8082}")
    private String catalogUrl;

    @Value("${services.inventory-url:http://localhost:8083}")
    private String inventoryUrl;

    @Value("${services.payment-url:http://localhost:8085}")
    private String paymentUrl;

    public DownstreamClients() {
        this.client = RestClient.builder()
                .defaultHeader(TraceContext.TRACE_ID_HEADER, "")
                .build();
    }

    private RestClient.RequestHeadersSpec<?> withTrace(RestClient.RequestHeadersSpec<?> spec) {
        String tid = TraceContext.getTraceId();
        if (tid != null) {
            return spec.header(TraceContext.TRACE_ID_HEADER, tid);
        }
        return spec;
    }

    public Map<String, Object> getUser(Long userId) {
        return withTrace(client.get().uri(userUrl + "/internal/users/" + userId))
                .retrieve()
                .body(Map.class);
    }

    public List<Map<String, Object>> batchCatalog(List<String> skus) {
        Map<String, Object> reqBody = Map.of("skus", skus);
        Map<String, Object> resp = withTrace(
                client.post().uri(catalogUrl + "/internal/catalog/batch").body(reqBody))
                .retrieve()
                .body(Map.class);
        Object data = ((Map<?, ?>) resp).get("data");
        if (data instanceof Map<?, ?> dataMap) {
            return (List<Map<String, Object>>) dataMap.get("products");
        }
        return List.of();
    }

    public Map<String, Object> reserveInventory(String orderId, String sku, int qty) {
        Map<String, Object> reqBody = Map.of("orderId", orderId, "sku", sku, "qty", qty);
        Map<String, Object> resp = withTrace(
                client.post().uri(inventoryUrl + "/internal/inventory/reserve").body(reqBody))
                .retrieve()
                .body(Map.class);
        return (Map<String, Object>) ((Map<?, ?>) resp).get("data");
    }

    public void releaseInventory(String orderId, String sku, int qty) {
        Map<String, Object> reqBody = Map.of("orderId", orderId, "sku", sku, "qty", qty);
        withTrace(client.post().uri(inventoryUrl + "/internal/inventory/release").body(reqBody))
                .retrieve()
                .body(Map.class);
    }

    public Map<String, Object> charge(String orderId, String orderNo, Long userId, BigDecimal amount) {
        Map<String, Object> reqBody = Map.of(
                "orderId", orderId, "orderNo", orderNo, "userId", userId, "amount", amount);
        Map<String, Object> resp = withTrace(
                client.post().uri(paymentUrl + "/internal/payments/charge").body(reqBody))
                .retrieve()
                .body(Map.class);
        return (Map<String, Object>) ((Map<?, ?>) resp).get("data");
    }
}
