package com.castrel.chaos.payment.service;

import com.castrel.chaos.common.BizException;
import com.castrel.chaos.common.TraceContext;
import com.castrel.chaos.common.chaos.SlowSqlChaosService;
import com.castrel.chaos.payment.dto.ChargeRequest;
import com.castrel.chaos.payment.dto.PaymentDTO;
import com.castrel.chaos.payment.entity.Payment;
import com.castrel.chaos.payment.repository.PaymentRepository;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
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
    private SlowSqlChaosService slowSqlChaosService;

    @Autowired
    private MeterRegistry meterRegistry;

    @Value("${payment.success-rate:0.90}")
    private double successRate;

    @Value("${payment.timeout-rate:0.05}")
    private double timeoutRate;

    private Counter successCounter;
    private Counter failCounter;
    private Counter timeoutCounter;
    private final Random random = new Random();

    @PostConstruct
    void initMetrics() {
        successCounter = Counter.builder("payment.charge.success.count").register(meterRegistry);
        failCounter = Counter.builder("payment.charge.fail.count").register(meterRegistry);
        timeoutCounter = Counter.builder("payment.charge.timeout.count").register(meterRegistry);
    }

    @Transactional
    public PaymentDTO charge(ChargeRequest req) {
        // Idempotency: return existing result for same orderNo
        return paymentRepository.findByOrderNo(req.getOrderNo())
                .map(this::toDTO)
                .orElseGet(() -> executeCharge(req));
    }

    private PaymentDTO executeCharge(ChargeRequest req) {
        slowSqlChaosService.injectIfNeeded();

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
        return toDTO(payment);
    }

    public PaymentDTO getPayment(Long id) {
        slowSqlChaosService.injectIfNeeded();
        return paymentRepository.findById(id)
                .map(this::toDTO)
                .orElseThrow(() -> new BizException("PAYMENT_NOT_FOUND", "Payment not found: " + id));
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
