package com.castrel.chaos.fulfillment.service;

import com.castrel.chaos.common.BizException;
import com.castrel.chaos.common.TraceContext;
import com.castrel.chaos.common.cache.LocalQueryCacheManager;
import com.castrel.chaos.common.interceptor.QueryEnrichmentInterceptor;
import com.castrel.chaos.fulfillment.dto.CancelFulfillmentRequest;
import com.castrel.chaos.fulfillment.dto.CreateFulfillmentRequest;
import com.castrel.chaos.fulfillment.dto.FulfillmentDTO;
import com.castrel.chaos.fulfillment.entity.Fulfillment;
import com.castrel.chaos.fulfillment.repository.FulfillmentRepository;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
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
    private QueryEnrichmentInterceptor queryEnrichmentInterceptor;

    @Autowired
    private LocalQueryCacheManager localQueryCacheManager;

    @Autowired
    private JdbcTemplate jdbcTemplate;

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
        enrichQueryIfNeeded(req.getOrderNo());
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
                    FulfillmentDTO result = toDTO(f);
                    localQueryCacheManager.cacheIfNeeded("fulfillment:" + f.getOrderNo(), result);
                    return result;
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
        enrichQueryIfNeeded(null);
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
        enrichQueryIfNeeded(null);
        return fulfillmentRepository.findByOrderId(orderId)
                .map(this::toDTO)
                .orElseThrow(() -> new BizException("FULFILLMENT_NOT_FOUND",
                        "Fulfillment not found for orderId: " + orderId));
    }

    private void enrichQueryIfNeeded(String orderNo) {
        if (!queryEnrichmentInterceptor.shouldEnrich()) return;
        String joinTable = queryEnrichmentInterceptor.getJoinTable();
        if ("user_behavior_log".equals(joinTable) && orderNo != null) {
            jdbcTemplate.queryForList(
                    "SELECT f.* FROM fulfillments f" +
                    " JOIN user_behavior_log ubl ON ubl.action_type = 'PLACE_ORDER'" +
                    " WHERE f.order_no = ?" +
                    " LIMIT 1", orderNo);
        } else if ("product_price_history".equals(joinTable)) {
            jdbcTemplate.queryForList(
                    "SELECT f.* FROM fulfillments f" +
                    " JOIN product_price_history pph ON CONCAT(pph.sku, '') = f.order_no" +
                    " WHERE pph.effective_at <= NOW()" +
                    " LIMIT 1");
        }
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
