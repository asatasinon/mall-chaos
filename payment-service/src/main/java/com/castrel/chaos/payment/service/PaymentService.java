package com.castrel.chaos.payment.service;

import com.castrel.chaos.common.BizException;
import com.castrel.chaos.common.TraceContext;
import com.castrel.chaos.common.cache.LocalQueryCacheManager;
import com.castrel.chaos.payment.dto.PaymentDTO;
import com.castrel.chaos.payment.dto.PaymentIntentRequest;
import com.castrel.chaos.payment.dto.RefundRequest;
import com.castrel.chaos.payment.client.OrderPaymentResultClient;
import com.castrel.chaos.payment.client.OrderClient;
import com.castrel.chaos.payment.client.PspClient;
import com.castrel.chaos.payment.entity.Payment;
import com.castrel.chaos.payment.repository.PaymentRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.JsonNode;
import com.castrel.chaos.common.event.EventEnvelope;
import com.castrel.chaos.common.event.EventEnvelopeCodec;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.UUID;

@Service
public class PaymentService {

    @Autowired
    private PaymentRepository paymentRepository;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private OrderPaymentResultClient orderPaymentResultClient;

    @Autowired
    private OrderClient orderClient;

    @Autowired
    private LocalQueryCacheManager localQueryCacheManager;

    @Autowired
    private MeterRegistry meterRegistry;

    @Autowired
    private PspClient pspClient;

    private Counter successCounter;
    private Counter failCounter;
    private Counter timeoutCounter;
    private Counter attemptCounter;

    @PostConstruct
    void initMetrics() {
        successCounter = Counter.builder("payment.charge.success.count").register(meterRegistry);
        failCounter = Counter.builder("payment.charge.fail.count").register(meterRegistry);
        timeoutCounter = Counter.builder("payment.charge.timeout.count").register(meterRegistry);
        attemptCounter = Counter.builder("payment_attempt_total").register(meterRegistry);
    }

    @Transactional
    public PaymentDTO createIntent(PaymentIntentRequest req) {
        if (req.getOrderId() == null || req.getUserId() == null
                || req.getIdempotencyKey() == null || req.getIdempotencyKey().isBlank()) {
            throw new BizException("INVALID_PAYMENT_INTENT", "orderId and idempotencyKey are required");
        }
        OrderClient.OrderData order = orderClient.getOrder(req.getOrderId());
        if (!req.getUserId().equals(order.userId())) {
            throw new BizException("PAYMENT_FORBIDDEN", "Payment does not belong to customer");
        }
        return paymentRepository.findByOrderIdAndIdempotencyKey(req.getOrderId(), req.getIdempotencyKey())
                .map(this::toDTO)
                .orElseGet(() -> {
                    Payment payment = new Payment();
                    payment.setPaymentNo("PAY-" + UUID.randomUUID().toString().replace("-", "").substring(0, 12).toUpperCase());
                    payment.setOrderId(req.getOrderId());
                    payment.setCustomerId(req.getUserId());
                    payment.setIdempotencyKey(req.getIdempotencyKey());
                    payment.setAmount(order.totalAmount());
                    payment.setStatus("CREATED");
                    payment.setResultCode("CREATED");
                    payment.setTraceId(TraceContext.getTraceId());
                    payment.setCreatedAt(LocalDateTime.now());
                    payment.setUpdatedAt(LocalDateTime.now());
                    return toDTO(paymentRepository.save(payment));
                });
    }

    @Transactional
    public PaymentDTO confirmIntent(Long id) {
        return confirmIntent(id, null, false);
    }

    @Transactional
    public PaymentDTO confirmIntent(Long id, Long customerId, boolean forceCustomerSuccess) {
        Payment payment = paymentRepository.findById(id)
                .orElseThrow(() -> new BizException("PAYMENT_NOT_FOUND", "Payment not found: " + id));
        assertCustomer(payment, customerId);
        if (!"CREATED".equals(payment.getStatus()) && !"PROCESSING".equals(payment.getStatus())) {
            return toDTO(payment);
        }
        return executePayment(payment, orderClient.getOrder(payment.getOrderId()).orderNo());
    }

    @Transactional
    public PaymentDTO retryIntent(Long id) {
        return retryIntent(id, null);
    }

    @Transactional
    public PaymentDTO retryIntent(Long id, Long customerId) {
        Payment payment = paymentRepository.findById(id)
                .orElseThrow(() -> new BizException("PAYMENT_NOT_FOUND", "Payment not found: " + id));
        assertCustomer(payment, customerId);
        if ("SUCCESS".equals(payment.getStatus()) || "FAILED".equals(payment.getStatus())
                || "REFUNDED".equals(payment.getStatus())) return toDTO(payment);
        if (!"UNKNOWN".equals(payment.getStatus())) {
            throw new BizException("PAYMENT_NOT_RETRYABLE", "Only UNKNOWN payments can be retried");
        }
        payment.setStatus("PROCESSING");
        payment.setResultCode("RETRYING");
        payment.setUpdatedAt(LocalDateTime.now());
        paymentRepository.save(payment);
        return executePayment(payment, orderClient.getOrder(payment.getOrderId()).orderNo());
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
        payment.setUpdatedAt(LocalDateTime.now());
        return toDTO(paymentRepository.save(payment));
    }

    private PaymentDTO executePayment(Payment payment, String orderNo) {
        attemptCounter.increment();
        try {
            PspClient.Authorization authorization = pspClient.authorize(
                    payment.getPaymentNo(), payment.getOrderId(), payment.getAmount(), currentRunId());
            if ("AUTHORIZED".equals(authorization.status())) {
                payment.setStatus("SUCCESS");
                payment.setResultCode("SUCCESS");
                successCounter.increment();
            } else {
                payment.setStatus("FAILED");
                payment.setResultCode(authorization.code());
                failCounter.increment();
            }
        } catch (PspClient.PspTimeoutException | PspClient.PspUnavailableException exception) {
            payment.setStatus("UNKNOWN");
            payment.setResultCode("PROVIDER_UNAVAILABLE");
            timeoutCounter.increment();
        }
        payment.setUpdatedAt(LocalDateTime.now());
        PaymentDTO result = toDTO(paymentRepository.save(payment));
        result.setOrderNo(orderNo);
        deliverPaymentResult(result, orderNo);
        return result;
    }

    private String currentRunId() {
        org.springframework.web.context.request.ServletRequestAttributes attributes =
                (org.springframework.web.context.request.ServletRequestAttributes)
                        org.springframework.web.context.request.RequestContextHolder.getRequestAttributes();
        return attributes == null ? null : attributes.getRequest().getHeader("X-Fault-Run-Id");
    }

    private void deliverPaymentResult(PaymentDTO payment, String orderNo) {
        payment.setEventId(UUID.randomUUID().toString());
        EventEnvelope<JsonNode> envelope = EventEnvelopeCodec.create(objectMapper,
                payment.getEventId(), "PAYMENT_RESULT", orderNo, 1, payment,
                TraceContext.getTraceId(), null);
        orderPaymentResultClient.publish(envelope);
    }

    public PaymentDTO getPayment(Long id) {
        PaymentDTO result = paymentRepository.findById(id)
                .map(this::toDTO)
                .orElseThrow(() -> new BizException("PAYMENT_NOT_FOUND", "Payment not found: " + id));
        localQueryCacheManager.cacheIfNeeded("payment:" + id, result);
        return result;
    }

    private PaymentDTO toDTO(Payment p) {
        PaymentDTO dto = new PaymentDTO();
        dto.setId(p.getId());
        dto.setPaymentNo(p.getPaymentNo());
        dto.setOrderId(p.getOrderId());
        dto.setCustomerId(p.getCustomerId());
        dto.setAmount(p.getAmount());
        dto.setStatus(p.getStatus());
        dto.setResultCode(p.getResultCode());
        dto.setFailReason("FAILED".equals(p.getStatus()) ? p.getResultCode() : null);
        return dto;
    }

    private void assertCustomer(Payment payment, Long customerId) {
        if (customerId != null && !customerId.equals(payment.getCustomerId())) {
            throw new BizException("PAYMENT_FORBIDDEN", "Payment does not belong to customer");
        }
    }
}
