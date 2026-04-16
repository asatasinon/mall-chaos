package com.castrel.chaos.fulfillment.service;

import com.castrel.chaos.common.BizException;
import com.castrel.chaos.common.TraceContext;
import com.castrel.chaos.common.chaos.SlowSqlChaosService;
import com.castrel.chaos.fulfillment.dto.CancelFulfillmentRequest;
import com.castrel.chaos.fulfillment.dto.CreateFulfillmentRequest;
import com.castrel.chaos.fulfillment.dto.FulfillmentDTO;
import com.castrel.chaos.fulfillment.entity.Fulfillment;
import com.castrel.chaos.fulfillment.repository.FulfillmentRepository;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.UUID;

@Service
public class FulfillmentService {

    @Autowired
    private FulfillmentRepository fulfillmentRepository;

    @Autowired
    private SlowSqlChaosService slowSqlChaosService;

    @Autowired
    private MeterRegistry meterRegistry;

    private Counter createCounter;
    private Counter cancelCounter;

    @PostConstruct
    void initMetrics() {
        createCounter = Counter.builder("fulfillment.create.count").register(meterRegistry);
        cancelCounter = Counter.builder("fulfillment.cancel.count").register(meterRegistry);
    }

    @Transactional
    public FulfillmentDTO create(CreateFulfillmentRequest req) {
        slowSqlChaosService.injectIfNeeded();
        // Idempotency: return existing if already created
        return fulfillmentRepository.findByOrderId(req.getOrderId())
                .map(this::toDTO)
                .orElseGet(() -> {
                    Fulfillment f = new Fulfillment();
                    f.setOrderId(req.getOrderId());
                    f.setOrderNo(req.getOrderNo());
                    f.setStatus("CREATED");
                    f.setTrackingNo("TRACK-" + UUID.randomUUID().toString().replace("-", "").substring(0, 8).toUpperCase());
                    f.setCarrier("MockExpress");
                    f.setTraceId(TraceContext.getTraceId());
                    fulfillmentRepository.save(f);
                    createCounter.increment();
                    advanceStatusAsync(f.getOrderId());
                    return toDTO(f);
                });
    }

    @Async
    public void advanceStatusAsync(Long orderId) {
        sleep(5_000);
        updateStatus(orderId, "PICKING", null, null);

        sleep(10_000);
        updateStatus(orderId, "SHIPPED", LocalDateTime.now(), null);

        sleep(30_000);
        updateStatus(orderId, "DELIVERED", null, LocalDateTime.now());
    }

    @Transactional
    public void updateStatus(Long orderId, String status,
                             LocalDateTime shippedAt, LocalDateTime deliveredAt) {
        fulfillmentRepository.findByOrderId(orderId).ifPresent(f -> {
            f.setStatus(status);
            if (shippedAt != null) f.setShippedAt(shippedAt);
            if (deliveredAt != null) f.setDeliveredAt(deliveredAt);
            fulfillmentRepository.save(f);
        });
    }

    @Transactional
    public FulfillmentDTO cancel(CancelFulfillmentRequest req) {
        slowSqlChaosService.injectIfNeeded();
        Fulfillment f = fulfillmentRepository.findByOrderId(req.getOrderId())
                .orElseThrow(() -> new BizException("FULFILLMENT_NOT_FOUND",
                        "Fulfillment not found for orderId: " + req.getOrderId()));

        if (!"CREATED".equals(f.getStatus()) && !"PICKING".equals(f.getStatus())) {
            throw new BizException("FULFILLMENT_CANNOT_CANCEL",
                    "Cannot cancel fulfillment in status: " + f.getStatus());
        }

        f.setStatus("CANCELLED");
        f.setCancelReason(req.getReason());
        fulfillmentRepository.save(f);
        cancelCounter.increment();
        return toDTO(f);
    }

    public FulfillmentDTO getByOrderId(Long orderId) {
        slowSqlChaosService.injectIfNeeded();
        return fulfillmentRepository.findByOrderId(orderId)
                .map(this::toDTO)
                .orElseThrow(() -> new BizException("FULFILLMENT_NOT_FOUND",
                        "Fulfillment not found for orderId: " + orderId));
    }

    private FulfillmentDTO toDTO(Fulfillment f) {
        FulfillmentDTO dto = new FulfillmentDTO();
        dto.setId(f.getId());
        dto.setOrderId(f.getOrderId());
        dto.setOrderNo(f.getOrderNo());
        dto.setStatus(f.getStatus());
        dto.setTrackingNo(f.getTrackingNo());
        dto.setCarrier(f.getCarrier());
        dto.setShippedAt(f.getShippedAt());
        dto.setDeliveredAt(f.getDeliveredAt());
        dto.setCreatedAt(f.getCreatedAt());
        return dto;
    }

    private void sleep(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
