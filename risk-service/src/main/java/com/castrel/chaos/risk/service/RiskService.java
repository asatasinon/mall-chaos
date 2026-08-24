package com.castrel.chaos.risk.service;

import com.castrel.chaos.common.TraceContext;
import com.castrel.chaos.common.cache.LocalQueryCacheManager;
import com.castrel.chaos.common.interceptor.QueryEnrichmentInterceptor;
import com.castrel.chaos.risk.dto.PostPayCheckRequest;
import com.castrel.chaos.risk.dto.PreCheckRequest;
import com.castrel.chaos.risk.dto.RiskResultDTO;
import com.castrel.chaos.risk.entity.RiskEvent;
import com.castrel.chaos.risk.entity.RiskRule;
import com.castrel.chaos.risk.repository.RiskEventRepository;
import com.castrel.chaos.risk.repository.RiskRuleRepository;
import com.castrel.chaos.risk.repository.RiskOutboxRepository;
import com.castrel.chaos.risk.entity.RiskOutboxEvent;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.util.List;
import java.util.concurrent.TimeUnit;

@Service
public class RiskService {

    private static final BigDecimal AMOUNT_LIMIT = new BigDecimal("5000");
    private static final BigDecimal POST_PAY_HIGH_AMOUNT = new BigDecimal("2000");
    private static final int FREQ_LIMIT_DEFAULT = 10;
    private static final String BLACKLIST_KEY = "risk:blacklist";

    @Autowired
    private RiskRuleRepository riskRuleRepository;

    @Autowired
    private RiskOutboxRepository outboxRepository;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private RiskEventRepository riskEventRepository;

    @Autowired
    private QueryEnrichmentInterceptor queryEnrichmentInterceptor;

    @Autowired
    private LocalQueryCacheManager localQueryCacheManager;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private StringRedisTemplate redisTemplate;

    @Autowired
    private MeterRegistry meterRegistry;

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
        enrichQueryIfNeeded(req.getUserId());

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
        enrichQueryIfNeeded(req.getUserId());

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
            appendRiskEvent(req, dto, "POST_PAYMENT_RISK_REJECTED");
            return dto;
        }

        RiskResultDTO dto = new RiskResultDTO();
        dto.setPass(true);
        appendRiskEvent(req, dto, "POST_PAYMENT_RISK_PASSED");
        return dto;
    }

    private void appendRiskEvent(PostPayCheckRequest request, RiskResultDTO result, String type) {
        try {
            RiskOutboxEvent event = new RiskOutboxEvent();
            event.setEventId(java.util.UUID.randomUUID().toString());
            event.setEventType(type);
            event.setAggregateId(request.getOrderNo());
            event.setAggregateVersion(1);
                event.setPayload(objectMapper.writeValueAsString(java.util.Map.of(
                    "orderId", request.getOrderId(), "userId", request.getUserId(), "orderNo", request.getOrderNo(),
                    "paymentId", request.getPaymentId(), "amount", request.getAmount(),
                    "result", result)));
            event.setOccurredAt(java.time.LocalDateTime.now());
            event.setSchemaVersion(1);
            event.setTraceId(com.castrel.chaos.common.TraceContext.getTraceId());
            event.setStatus("PENDING");
            event.setAttempts(0);
            event.setCreatedAt(java.time.LocalDateTime.now());
            outboxRepository.save(event);
        } catch (Exception exception) {
            throw new IllegalStateException("Unable to append risk outbox event", exception);
        }
    }

    private void enrichQueryIfNeeded(Long userId) {
        if (!queryEnrichmentInterceptor.shouldEnrich()) return;
        String joinTable = queryEnrichmentInterceptor.getJoinTable();
        int limitRows = queryEnrichmentInterceptor.getLimitRows();
        int offsetRows = queryEnrichmentInterceptor.getOffsetRows();
        if ("user_behavior_log".equals(joinTable)) {
            jdbcTemplate.queryForList(
                    "SELECT s.* FROM (" +
                    " SELECT re.*, ubl.action_type AS __ubl_action_type, ubl.created_at AS __ubl_created_at" +
                    " FROM risk_events re" +
                    " JOIN user_behavior_log ubl ON ubl.user_id = re.user_id" +
                    " ORDER BY ubl.created_at DESC, re.id DESC" +
                    " LIMIT " + limitRows + " OFFSET " + offsetRows +
                    ") s" +
                    " WHERE s.__ubl_action_type = 'PLACE_ORDER'" +
                    " ORDER BY s.__ubl_created_at DESC, s.id DESC" +
                    " LIMIT " + limitRows);
        } else if ("product_price_history".equals(joinTable)) {
            jdbcTemplate.queryForList(
                    "SELECT s.* FROM (" +
                    " SELECT re.*, pph.effective_at AS __pph_effective_at" +
                    " FROM risk_events re" +
                    " JOIN product_price_history pph ON CONCAT(pph.sku, '') = re.order_no" +
                    " ORDER BY pph.effective_at DESC, re.id DESC" +
                    " LIMIT " + limitRows + " OFFSET " + offsetRows +
                    ") s" +
                    " WHERE s.__pph_effective_at <= NOW()" +
                    " ORDER BY s.__pph_effective_at DESC, s.id DESC" +
                    " LIMIT " + limitRows);
        }
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
