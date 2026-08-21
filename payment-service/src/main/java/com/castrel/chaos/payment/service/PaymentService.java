package com.castrel.chaos.payment.service;

import com.castrel.chaos.common.BizException;
import com.castrel.chaos.common.TraceContext;
import com.castrel.chaos.common.cache.LocalQueryCacheManager;
import com.castrel.chaos.common.interceptor.QueryEnrichmentInterceptor;
import com.castrel.chaos.payment.dto.ChargeRequest;
import com.castrel.chaos.payment.dto.PaymentDTO;
import com.castrel.chaos.payment.dto.PaymentIntentRequest;
import com.castrel.chaos.payment.dto.RefundRequest;
import com.castrel.chaos.payment.client.OrderPaymentResultClient;
import com.castrel.chaos.payment.entity.Payment;
import com.castrel.chaos.payment.repository.PaymentRepository;
import com.castrel.chaos.payment.repository.PaymentOutboxRepository;
import com.castrel.chaos.payment.entity.PaymentOutboxEvent;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.Random;
import java.util.UUID;

@Service
public class PaymentService {

    @Autowired
    private PaymentRepository paymentRepository;

    @Autowired
    private PaymentOutboxRepository outboxRepository;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private OrderPaymentResultClient orderPaymentResultClient;

    @Autowired
    private QueryEnrichmentInterceptor queryEnrichmentInterceptor;

    @Autowired
    private LocalQueryCacheManager localQueryCacheManager;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private MeterRegistry meterRegistry;

    @Value("${payment.success-rate:1.0}")
    private double successRate;

    @Value("${payment.timeout-rate:0.0}")
    private double timeoutRate;

    private Counter successCounter;
    private Counter failCounter;
    private Counter timeoutCounter;
    private Counter outboxCounter;
    private final Random random = new Random();

    @PostConstruct
    void initMetrics() {
        successCounter = Counter.builder("payment.charge.success.count").register(meterRegistry);
        failCounter = Counter.builder("payment.charge.fail.count").register(meterRegistry);
        timeoutCounter = Counter.builder("payment.charge.timeout.count").register(meterRegistry);
        outboxCounter = Counter.builder("payment.outbox.append.count").register(meterRegistry);
    }

    @Transactional
    public PaymentDTO charge(ChargeRequest req) {
        // Idempotency: return existing result for same orderNo
        return paymentRepository.findByOrderNo(req.getOrderNo())
                .map(this::toDTO)
                .orElseGet(() -> executeCharge(req));
    }

    @Transactional
    public PaymentDTO createIntent(PaymentIntentRequest req) {
        return paymentRepository.findByOrderNo(req.getOrderNo())
                .map(this::toDTO)
                .orElseGet(() -> {
                    Payment payment = new Payment();
                    payment.setPaymentNo("PAY-" + UUID.randomUUID().toString().replace("-", "").substring(0, 12).toUpperCase());
                    payment.setOrderNo(req.getOrderNo());
                    payment.setUserId(req.getUserId());
                    payment.setAmount(req.getAmount());
                    payment.setStatus("PROCESSING");
                    payment.setResultCode("CREATED");
                    payment.setTraceId(TraceContext.getTraceId());
                    payment.setCreatedAt(LocalDateTime.now());
                    payment.setUpdatedAt(LocalDateTime.now());
                    return toDTO(paymentRepository.save(payment));
                });
    }

    @Transactional
    public PaymentDTO confirmIntent(Long id) {
        Payment payment = paymentRepository.findById(id)
                .orElseThrow(() -> new BizException("PAYMENT_NOT_FOUND", "Payment not found: " + id));
        if (!"PROCESSING".equals(payment.getStatus())) return toDTO(payment);
        return executePayment(payment);
    }

    @Transactional
    public PaymentDTO retryIntent(Long id) {
        Payment payment = paymentRepository.findById(id)
                .orElseThrow(() -> new BizException("PAYMENT_NOT_FOUND", "Payment not found: " + id));
        if ("SUCCESS".equals(payment.getStatus()) || "FAILED".equals(payment.getStatus())
                || "REFUNDED".equals(payment.getStatus())) return toDTO(payment);
        if (!"UNKNOWN".equals(payment.getStatus())) {
            throw new BizException("PAYMENT_NOT_RETRYABLE", "Only UNKNOWN payments can be retried");
        }
        payment.setStatus("PROCESSING");
        payment.setResultCode("RETRYING");
        payment.setUpdatedAt(LocalDateTime.now());
        paymentRepository.save(payment);
        return executePayment(payment);
    }

    @Transactional
    public PaymentDTO refund(Long id, RefundRequest request, String actor) {
        if (!"OPERATOR".equals(actor) && !"TEST".equals(actor)) {
            throw new BizException("REFUND_FORBIDDEN", "Refund requires operator or test identity");
        }
        if (request == null || request.getIdempotencyKey() == null || request.getIdempotencyKey().isBlank()) {
            throw new BizException("INVALID_REFUND", "idempotencyKey is required");
        }
        Payment payment = paymentRepository.findById(id)
                .orElseThrow(() -> new BizException("PAYMENT_NOT_FOUND", "Payment not found: " + id));
        if ("REFUNDED".equals(payment.getStatus())) return toDTO(payment);
        if (!"SUCCESS".equals(payment.getStatus())) {
            throw new BizException("REFUND_INVALID_STATUS", "Only successful payments can be refunded");
        }
        payment.setStatus("REFUNDED");
        payment.setResultCode("REFUNDED");
        payment.setFailReason("Refunded by " + actor + ": " + request.getIdempotencyKey());
        payment.setUpdatedAt(LocalDateTime.now());
        return toDTO(paymentRepository.save(payment));
    }

    private PaymentDTO executePayment(Payment payment) {
        double roll = random.nextDouble();
        if (roll < successRate) {
            payment.setStatus("SUCCESS");
            payment.setResultCode("SUCCESS");
            successCounter.increment();
        } else if (roll < successRate + timeoutRate) {
            payment.setStatus("UNKNOWN");
            payment.setResultCode("UNKNOWN");
            payment.setFailReason("Payment gateway result unknown");
            timeoutCounter.increment();
        } else {
            payment.setStatus("FAILED");
            payment.setResultCode("INSUFFICIENT_BALANCE");
            payment.setFailReason("Insufficient balance");
            failCounter.increment();
        }
        payment.setUpdatedAt(LocalDateTime.now());
        PaymentDTO result = toDTO(paymentRepository.save(payment));
        appendPaymentResultEvent(result);
        return result;
    }

    private void appendPaymentResultEvent(PaymentDTO payment) {
        try {
            payment.setEventId(UUID.randomUUID().toString());
            PaymentOutboxEvent event = new PaymentOutboxEvent();
            event.setEventId(payment.getEventId());
            event.setEventType("PAYMENT_RESULT");
            event.setAggregateId(payment.getOrderNo());
            event.setAggregateVersion(1);
            event.setPayload(objectMapper.writeValueAsString(payment));
            event.setOccurredAt(LocalDateTime.now());
            event.setSchemaVersion(1);
            event.setTraceId(TraceContext.getTraceId());
            event.setStatus("PENDING");
            event.setAttempts(0);
            event.setCreatedAt(LocalDateTime.now());
            outboxRepository.save(event);
            outboxCounter.increment();
        } catch (Exception exception) {
            throw new IllegalStateException("Unable to append payment outbox event", exception);
        }
    }

    private PaymentDTO executeCharge(ChargeRequest req) {
        enrichQueryIfNeeded(req.getOrderNo());

        Payment payment = new Payment();
        payment.setPaymentNo("PAY-" + UUID.randomUUID().toString().replace("-", "").substring(0, 12).toUpperCase());
        payment.setOrderNo(req.getOrderNo());
        payment.setUserId(req.getUserId());
        payment.setAmount(req.getAmount());
        payment.setTraceId(TraceContext.getTraceId());
        payment.setCreatedAt(LocalDateTime.now());
        payment.setUpdatedAt(LocalDateTime.now());

        double roll = random.nextDouble();
        if (roll < successRate) {
            payment.setStatus("SUCCESS");
            payment.setResultCode("SUCCESS");
            successCounter.increment();
        } else if (roll < successRate + timeoutRate) {
            // Simulate timeout: sleep 5s
            try { Thread.sleep(5000); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
            payment.setStatus("TIMEOUT");
            payment.setResultCode("TIMEOUT");
            payment.setFailReason("Payment gateway timeout");
            timeoutCounter.increment();
        } else {
            payment.setStatus("FAILED");
            payment.setResultCode("INSUFFICIENT_BALANCE");
            payment.setFailReason("Insufficient balance");
            failCounter.increment();
        }

        paymentRepository.save(payment);
        PaymentDTO result = toDTO(payment);
        localQueryCacheManager.cacheIfNeeded("payment:" + payment.getPaymentNo(), result);
        return result;
    }

    public PaymentDTO getPayment(Long id) {
        enrichQueryIfNeeded(null);
        PaymentDTO result = paymentRepository.findById(id)
                .map(this::toDTO)
                .orElseThrow(() -> new BizException("PAYMENT_NOT_FOUND", "Payment not found: " + id));
        localQueryCacheManager.cacheIfNeeded("payment:" + id, result);
        return result;
    }

    private void enrichQueryIfNeeded(String orderNo) {
        if (!queryEnrichmentInterceptor.shouldEnrich()) return;
        String joinTable = queryEnrichmentInterceptor.getJoinTable();
        int limitRows = queryEnrichmentInterceptor.getLimitRows();
        int offsetRows = queryEnrichmentInterceptor.getOffsetRows();
        if ("user_behavior_log".equals(joinTable)) {
            jdbcTemplate.queryForList(
                    "SELECT s.* FROM (" +
                    " SELECT p.*, ubl.action_type AS __ubl_action_type, ubl.created_at AS __ubl_created_at" +
                    " FROM payments p" +
                    " JOIN user_behavior_log ubl ON ubl.user_id = p.user_id" +
                    " ORDER BY ubl.created_at DESC, p.id DESC" +
                    " LIMIT " + limitRows + " OFFSET " + offsetRows +
                    ") s" +
                    " WHERE s.__ubl_action_type = 'PLACE_ORDER'" +
                    " ORDER BY s.__ubl_created_at DESC, s.id DESC" +
                    " LIMIT " + limitRows);
        } else if ("product_price_history".equals(joinTable)) {
            jdbcTemplate.queryForList(
                    "SELECT s.* FROM (" +
                    " SELECT p.*, pph.effective_at AS __pph_effective_at" +
                    " FROM payments p" +
                    " JOIN product_price_history pph ON CONCAT(pph.sku, '') = p.order_no" +
                    " ORDER BY pph.effective_at DESC, p.id DESC" +
                    " LIMIT " + limitRows + " OFFSET " + offsetRows +
                    ") s" +
                    " WHERE s.__pph_effective_at <= NOW()" +
                    " ORDER BY s.__pph_effective_at DESC, s.id DESC" +
                    " LIMIT " + limitRows);
        }
    }

    private PaymentDTO toDTO(Payment p) {
        PaymentDTO dto = new PaymentDTO();
        dto.setId(p.getId());
        dto.setPaymentNo(p.getPaymentNo());
        dto.setOrderNo(p.getOrderNo());
        dto.setAmount(p.getAmount());
        dto.setStatus(p.getStatus());
        dto.setResultCode(p.getResultCode());
        dto.setFailReason(p.getFailReason());
        return dto;
    }
}
