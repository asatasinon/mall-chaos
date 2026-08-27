package com.castrel.chaos.risk.service;

import com.castrel.chaos.common.TraceContext;
import com.castrel.chaos.common.cache.LocalQueryCacheManager;
import com.castrel.chaos.risk.dto.PostPayCheckRequest;
import com.castrel.chaos.risk.dto.PreCheckRequest;
import com.castrel.chaos.risk.dto.RiskResultDTO;
import com.castrel.chaos.risk.entity.RiskEvent;
import com.castrel.chaos.risk.entity.RiskRule;
import com.castrel.chaos.risk.repository.RiskEventRepository;
import com.castrel.chaos.risk.repository.RiskRuleRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.JsonNode;
import com.castrel.chaos.common.event.EventEnvelope;
import com.castrel.chaos.common.event.EventEnvelopeCodec;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.client.RestTemplateBuilder;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.springframework.web.client.RestTemplate;

@Service
public class RiskService {

    private static final BigDecimal AMOUNT_LIMIT = new BigDecimal("5000");
    private static final BigDecimal POST_PAY_HIGH_AMOUNT = new BigDecimal("2000");
    private static final int FREQ_LIMIT_DEFAULT = 10;
    private static final String BLACKLIST_KEY = "risk:blacklist";

    @Autowired
    private RiskRuleRepository riskRuleRepository;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private RiskEventRepository riskEventRepository;

    @Autowired
    private LocalQueryCacheManager localQueryCacheManager;

    @Autowired
    private StringRedisTemplate redisTemplate;

    @Autowired
    private MeterRegistry meterRegistry;

    private final RestTemplate client;

    @Value("${services.fulfillment-url:http://localhost:8089}")
    private String fulfillmentUrl;

    @Value("${services.order-url:http://localhost:8084}")
    private String orderUrl;

    @Value("${CASTREL_INTERNAL_SERVICE_KEY:}")
    private String serviceKey;

    public RiskService(RestTemplateBuilder builder) {
        this.client = builder.build();
    }

    private Counter passCounter;
    private Counter rejectCounter;
    private Counter freezeCounter;

    @Value("${risk.post-pay-review-rate:0.0}")
    private double postPayReviewRate;

    @PostConstruct
    void initMetrics() {
        passCounter = Counter.builder("risk.pre_check.pass.count").register(meterRegistry);
        rejectCounter = Counter.builder("risk.pre_check.reject.count").register(meterRegistry);
        freezeCounter = Counter.builder("risk.post_pay.freeze.count").register(meterRegistry);
    }

    public RiskResultDTO preCheck(PreCheckRequest req) {
        // Blacklist check
        if (Boolean.TRUE.equals(redisTemplate.opsForSet().isMember(BLACKLIST_KEY, String.valueOf(req.getUserId())))) {
            saveEvent(req.getUserId(), req.getOrderNo(), "PRE_CHECK_REJECT", "BLACKLIST");
            rejectCounter.increment();
            RiskResultDTO dto = new RiskResultDTO();
            dto.setPass(false);
            dto.setReason("BLACKLIST");
            return dto;
        }

        // Frequency check
        String freqKey = "risk:freq:" + req.getUserId();
        Long count = redisTemplate.opsForValue().increment(freqKey);
        if (count == 1) {
            redisTemplate.expire(freqKey, 60, TimeUnit.SECONDS);
        }
        int freqLimit = getFreqLimit();
        if (count != null && count > freqLimit) {
            saveEvent(req.getUserId(), req.getOrderNo(), "PRE_CHECK_REJECT", "FREQ_LIMIT_EXCEEDED");
            rejectCounter.increment();
            RiskResultDTO dto = new RiskResultDTO();
            dto.setPass(false);
            dto.setReason("FREQ_LIMIT_EXCEEDED");
            return dto;
        }

        // Amount check
        if (req.getAmount() != null && req.getAmount().compareTo(AMOUNT_LIMIT) > 0) {
            saveEvent(req.getUserId(), req.getOrderNo(), "PRE_CHECK_REJECT", "AMOUNT_LIMIT_EXCEEDED");
            rejectCounter.increment();
            RiskResultDTO dto = new RiskResultDTO();
            dto.setPass(false);
            dto.setReason("AMOUNT_LIMIT_EXCEEDED");
            return dto;
        }

        saveEvent(req.getUserId(), req.getOrderNo(), "PRE_CHECK_PASS", null);
        passCounter.increment();
        RiskResultDTO dto = new RiskResultDTO();
        dto.setPass(true);
        dto.setRiskLevel("LOW");
        localQueryCacheManager.cacheIfNeeded("risk:" + req.getUserId(), dto);
        return dto;
    }

    public RiskResultDTO postPayCheck(PostPayCheckRequest req) {
        if (req.getAmount() != null
            && req.getAmount().compareTo(POST_PAY_HIGH_AMOUNT) > 0
            && postPayReviewRate > 0
            && Math.random() < postPayReviewRate) {
            saveEvent(req.getUserId(), req.getOrderNo(), "POST_PAY_FREEZE", "HIGH_AMOUNT_REVIEW");
            freezeCounter.increment();
            RiskResultDTO dto = new RiskResultDTO();
            dto.setPass(false);
            dto.setAction("FREEZE");
            dto.setReason("HIGH_AMOUNT_REVIEW");
            deliverRiskResult(req, dto, "POST_PAYMENT_RISK_REJECTED");
            return dto;
        }

        RiskResultDTO dto = new RiskResultDTO();
        dto.setPass(true);
        deliverRiskResult(req, dto, "POST_PAYMENT_RISK_PASSED");
        return dto;
    }

    private void deliverRiskResult(PostPayCheckRequest request, RiskResultDTO result, String type) {
        Map<String, Object> payload = new java.util.HashMap<>();
        payload.put("orderId", request.getOrderId());
        payload.put("userId", request.getUserId());
        payload.put("orderNo", request.getOrderNo());
        payload.put("paymentId", request.getPaymentId());
        payload.put("amount", request.getAmount());
        payload.put("result", result);
        payload.put("reason", result.getReason());
        EventEnvelope<JsonNode> envelope = EventEnvelopeCodec.create(objectMapper,
                UUID.randomUUID().toString(), type, request.getOrderNo(), 1, payload,
                TraceContext.getTraceId(), null);
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        if (serviceKey != null && !serviceKey.isBlank()) {
            headers.set("X-Internal-Service-Key", serviceKey);
        }
        String target = "POST_PAYMENT_RISK_PASSED".equals(type)
                ? fulfillmentUrl + "/internal/fulfillments/events/risk-passed"
                : orderUrl + "/internal/orders/risk-rejected";
        client.postForEntity(target, new HttpEntity<>(envelope, headers), Void.class);
    }

    private int getFreqLimit() {
        List<RiskRule> rules = riskRuleRepository.findByEnabledAndRuleType(1, "FREQ_LIMIT");
        return rules.isEmpty() ? FREQ_LIMIT_DEFAULT : rules.get(0).getThreshold();
    }

    private void saveEvent(Long userId, String orderNo, String eventType, String reason) {
        RiskEvent event = new RiskEvent();
        event.setUserId(userId);
        event.setOrderNo(orderNo);
        event.setEventType(eventType);
        event.setReason(reason);
        event.setTraceId(TraceContext.getTraceId());
        riskEventRepository.save(event);
    }
}
