package com.castrel.chaos.payment.client;

import com.castrel.chaos.common.TraceContext;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.client.RestTemplateBuilder;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;

import java.math.BigDecimal;
import java.time.Duration;
import java.util.Map;

@Component
public class PspClient {
    private final RestTemplate client;
    private final String pspUrl;
    private final String serviceKey;

    public PspClient(
            RestTemplateBuilder builder,
            @Value("${services.psp-url:http://localhost:8092}") String pspUrl,
            @Value("${CASTREL_INTERNAL_SERVICE_KEY:}") String serviceKey,
            @Value("${payment.psp-timeout-ms:30000}") int timeoutMs) {
        this.client = builder
                .setConnectTimeout(Duration.ofMillis(timeoutMs))
                .setReadTimeout(Duration.ofMillis(timeoutMs))
                .build();
        this.pspUrl = pspUrl;
        this.serviceKey = serviceKey;
    }

    public Authorization authorize(String paymentNo, Long orderId, BigDecimal amount, String runId) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        if (serviceKey != null && !serviceKey.isBlank()) headers.set("X-Internal-Service-Key", serviceKey);
        String traceId = TraceContext.getTraceId();
        if (traceId != null) headers.set(TraceContext.TRACE_ID_HEADER, traceId);
        if (runId != null && !runId.isBlank()) {
            headers.set("X-Operation-Run-Id", runId);
            org.springframework.web.context.request.ServletRequestAttributes attributes =
                    (org.springframework.web.context.request.ServletRequestAttributes)
                            org.springframework.web.context.request.RequestContextHolder.getRequestAttributes();
            if (attributes != null) {
                copyHeader(attributes, headers, "X-Operation-Run-Expires-At");
                copyHeader(attributes, headers, "X-Operation-Run-Fencing-Token");
                copyHeader(attributes, headers, "X-Operation-Run-Idempotency-Key");
            }
        }
        try {
            Map<?, ?> response = client.exchange(
                    pspUrl + "/api/psp/authorize", HttpMethod.POST,
                    new HttpEntity<>(Map.of("paymentNo", paymentNo, "orderId", orderId, "amount", amount), headers),
                    Map.class).getBody();
            Object data = response == null ? null : response.get("data");
            if (!(data instanceof Map<?, ?> result)) throw new PspUnavailableException("Provider response was invalid");
            String status = String.valueOf(result.get("status"));
            Object code = result.get("code");
            return new Authorization(status, String.valueOf(code == null ? status : code));
        } catch (ResourceAccessException exception) {
            throw new PspTimeoutException("Provider request timed out or was unreachable", exception);
        } catch (RestClientException exception) {
            throw new PspUnavailableException("Provider request failed", exception);
        }
    }

    private void copyHeader(org.springframework.web.context.request.ServletRequestAttributes attributes,
                            HttpHeaders headers, String name) {
        String value = attributes.getRequest().getHeader(name);
        if (value != null && !value.isBlank()) headers.set(name, value);
    }

    public record Authorization(String status, String code) {
    }

    public static class PspTimeoutException extends RuntimeException {
        public PspTimeoutException(String message, Throwable cause) { super(message, cause); }
    }

    public static class PspUnavailableException extends RuntimeException {
        public PspUnavailableException(String message) { super(message); }
        public PspUnavailableException(String message, Throwable cause) { super(message, cause); }
    }
}
