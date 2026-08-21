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

    public List<Map<String, Object>> batchCatalog(List<String> skus) {
        Map<String, Object> reqBody = Map.of("skus", skus);
        Map<String, Object> resp = exchange(catalogUrl + "/internal/catalog/batch", HttpMethod.POST, reqBody, Map.class);
        Object data = ((Map<?, ?>) resp).get("data");
        if (data instanceof Map<?, ?> dataMap) {
            return (List<Map<String, Object>>) dataMap.get("products");
        }
        return List.of();
    }

    public Map<String, Object> reserveInventory(String orderId, String sku, int qty) {
        Map<String, Object> reqBody = Map.of("orderId", orderId, "sku", sku, "qty", qty);
    Map<String, Object> resp = exchange(inventoryUrl + "/internal/inventory/reserve", HttpMethod.POST, reqBody, Map.class);
        return (Map<String, Object>) ((Map<?, ?>) resp).get("data");
    }

    public void releaseInventory(String orderId, String sku, int qty) {
        Map<String, Object> reqBody = Map.of("orderId", orderId, "sku", sku, "qty", qty);
    exchange(inventoryUrl + "/internal/inventory/release", HttpMethod.POST, reqBody, Map.class);
    }

    public Map<String, Object> charge(String orderId, String orderNo, Long userId, BigDecimal amount) {
        Map<String, Object> reqBody = Map.of(
                "orderId", orderId, "orderNo", orderNo, "userId", userId, "amount", amount);
    Map<String, Object> resp = exchange(paymentUrl + "/internal/payments/charge", HttpMethod.POST, reqBody, Map.class);
        return (Map<String, Object>) ((Map<?, ?>) resp).get("data");
    }
}
