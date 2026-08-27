package com.castrel.chaos.cart.client;

import com.castrel.chaos.common.BizException;
import com.castrel.chaos.common.TraceContext;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.client.RestTemplateBuilder;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;

import java.util.Map;

@Component
public class CatalogProductClient {
    private final RestTemplate client;
    private final String catalogUrl;
    private final String serviceKey;

    public CatalogProductClient(
            RestTemplateBuilder builder,
            @Value("${services.catalog-url:http://localhost:8082}") String catalogUrl,
            @Value("${CASTREL_INTERNAL_SERVICE_KEY:}") String serviceKey) {
        this.client = builder.build();
        this.catalogUrl = catalogUrl;
        this.serviceKey = serviceKey;
    }

    public void requireListed(String sku) {
        HttpHeaders headers = new HttpHeaders();
        headers.setAccept(java.util.List.of(MediaType.APPLICATION_JSON));
        if (serviceKey != null && !serviceKey.isBlank()) headers.set("X-Internal-Service-Key", serviceKey);
        String traceId = TraceContext.getTraceId();
        if (traceId != null) headers.set(TraceContext.TRACE_ID_HEADER, traceId);
        try {
            Map<?, ?> response = client.exchange(
                    catalogUrl + "/internal/catalog/products/" + java.net.URLEncoder.encode(sku, java.nio.charset.StandardCharsets.UTF_8),
                    HttpMethod.GET,
                    new HttpEntity<>(headers),
                    Map.class).getBody();
            Object data = response == null ? null : response.get("data");
            if (!(data instanceof Map<?, ?> product) || !Integer.valueOf(1).equals(asInteger(product.get("status")))) {
                throw new BizException("PRODUCT_UNAVAILABLE", "Product is not listed: " + sku);
            }
        } catch (BizException exception) {
            throw exception;
        } catch (RestClientException exception) {
            throw new BizException("CATALOG_UNAVAILABLE", "Catalog product validation failed", exception);
        }
    }

    private Integer asInteger(Object value) {
        return value instanceof Number number ? number.intValue() : null;
    }
}
