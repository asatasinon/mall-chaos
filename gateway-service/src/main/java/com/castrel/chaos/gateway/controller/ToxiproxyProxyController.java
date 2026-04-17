package com.castrel.chaos.gateway.controller;

import com.castrel.chaos.common.TraceContext;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.util.UriUtils;
import reactor.core.publisher.Mono;

import java.nio.charset.StandardCharsets;

@RestController
@RequestMapping("/internal/toxiproxy")
public class ToxiproxyProxyController {

    private final WebClient toxiproxyClient;

    public ToxiproxyProxyController(
            WebClient.Builder webClientBuilder,
            @Value("${TOXIPROXY_API_URL:http://localhost:18474}") String toxiproxyApiUrl
    ) {
        this.toxiproxyClient = webClientBuilder.baseUrl(toxiproxyApiUrl).build();
    }

    @GetMapping("/proxies")
    public Mono<ResponseEntity<String>> listProxies(
            @RequestHeader(value = TraceContext.TRACE_ID_HEADER, required = false) String traceId
    ) {
        return forward(HttpMethod.GET, "/proxies", null, traceId);
    }

    @PostMapping("/proxies/{proxyName}/toxics")
    public Mono<ResponseEntity<String>> createToxic(
            @PathVariable String proxyName,
            @RequestBody String body,
            @RequestHeader(value = TraceContext.TRACE_ID_HEADER, required = false) String traceId
    ) {
        String path = "/proxies/" + encodePathSegment(proxyName) + "/toxics";
        return forward(HttpMethod.POST, path, body, traceId);
    }

    @DeleteMapping("/proxies/{proxyName}/toxics/{toxicName}")
    public Mono<ResponseEntity<String>> removeToxic(
            @PathVariable String proxyName,
            @PathVariable String toxicName,
            @RequestHeader(value = TraceContext.TRACE_ID_HEADER, required = false) String traceId
    ) {
        String path = "/proxies/" + encodePathSegment(proxyName) + "/toxics/" + encodePathSegment(toxicName);
        return forward(HttpMethod.DELETE, path, null, traceId);
    }

    private Mono<ResponseEntity<String>> forward(HttpMethod method, String path, String jsonBody, String traceId) {
        WebClient.RequestBodySpec request = toxiproxyClient.method(method).uri(path);
        if (StringUtils.hasText(traceId)) {
            request.header(TraceContext.TRACE_ID_HEADER, traceId);
        }
        if (jsonBody != null) {
            request.header("Content-Type", "application/json");
        }

        WebClient.RequestHeadersSpec<?> requestSpec = jsonBody == null ? request : request.bodyValue(jsonBody);

        return requestSpec.exchangeToMono(response ->
                response.bodyToMono(String.class)
                        .defaultIfEmpty("")
                        .map(body -> toResponse(
                                response.statusCode(),
                                response.headers().contentType().orElse(null),
                                body
                        ))
        );
    }

    private ResponseEntity<String> toResponse(HttpStatusCode statusCode, MediaType contentType, String body) {
        ResponseEntity.BodyBuilder builder = ResponseEntity.status(statusCode);
        if (contentType != null) {
            builder.contentType(contentType);
        }
        return builder.body(body);
    }

    private String encodePathSegment(String value) {
        return UriUtils.encodePathSegment(value, StandardCharsets.UTF_8);
    }
}
