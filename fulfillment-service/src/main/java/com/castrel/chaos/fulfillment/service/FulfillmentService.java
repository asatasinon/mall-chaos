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
import com.castrel.chaos.fulfillment.repository.ShipmentTimelineRepository;
import com.castrel.chaos.fulfillment.repository.FulfillmentOutboxRepository;
import com.castrel.chaos.fulfillment.entity.FulfillmentOutboxEvent;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.castrel.chaos.fulfillment.entity.ShipmentTimelineEvent;
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
    private ShipmentTimelineRepository timelineRepository;

    @Autowired
    private FulfillmentOutboxRepository outboxRepository;

    @Autowired
    private ObjectMapper objectMapper;

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
    private Counter transitionCounter;
    private Counter transitionTotalCounter;

    @PostConstruct
    void initMetrics() {
        createCounter = Counter.builder("fulfillment.create.count").register(meterRegistry);
        cancelCounter = Counter.builder("fulfillment.cancel.count").register(meterRegistry);
        transitionCounter = Counter.builder("fulfillment.transition.count").register(meterRegistry);
        transitionTotalCounter = Counter.builder("fulfillment_transition_total").register(meterRegistry);
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
                    f.setCustomerId(req.getUserId());
                    f.setOrderNo(req.getOrderNo());
                    f.setStatus("CREATED");
                    f.setTrackingNo("TRACK-" + UUID.randomUUID().toString().replace("-", "").substring(0, 8).toUpperCase());
                    f.setCarrier("MockExpress");
                    f.setTraceId(TraceContext.getTraceId());
                    fulfillmentRepository.save(f);
                    appendTimeline(f.getId(), "CREATED", "Shipment created");
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
            appendTimeline(f.getId(), status, "Shipment status: " + status);
            appendShipmentEvent(f);
            transitionCounter.increment();
            transitionTotalCounter.increment();
        });
    }

    @Transactional
    public FulfillmentDTO confirmDelivery(Long customerId, Long orderId) {
        Fulfillment fulfillment = fulfillmentRepository.findByOrderId(orderId)
                .orElseThrow(() -> new BizException("FULFILLMENT_NOT_FOUND", "Fulfillment not found"));
        if (!customerId.equals(fulfillment.getCustomerId())) {
            throw new BizException("FULFILLMENT_NOT_FOUND", "Fulfillment not found");
        }
        if ("DELIVERED".equals(fulfillment.getStatus()) || "COMPLETED".equals(fulfillment.getStatus())) {
            return toDTO(fulfillment);
        }
        if (!"SHIPPED".equals(fulfillment.getStatus())) {
            throw new BizException("FULFILLMENT_INVALID_STATUS", "Only shipped fulfillment can be confirmed");
        }
        fulfillment.setStatus("COMPLETED");
        fulfillment.setDeliveredAt(LocalDateTime.now());
        fulfillmentRepository.save(fulfillment);
        appendTimeline(fulfillment.getId(), "COMPLETED", "Customer confirmed delivery");
        appendShipmentEvent(fulfillment);
        return toDTO(fulfillment);
    }

    private void appendShipmentEvent(Fulfillment fulfillment) {
        try {
            FulfillmentOutboxEvent event = new FulfillmentOutboxEvent();
            event.setEventId(UUID.randomUUID().toString());
            event.setEventType("SHIPMENT_UPDATED");
            event.setAggregateId(fulfillment.getOrderNo());
            event.setAggregateVersion(1);
            event.setPayload(objectMapper.writeValueAsString(toDTO(fulfillment)));
            event.setOccurredAt(LocalDateTime.now());
            event.setSchemaVersion(1);
            event.setTraceId(TraceContext.getTraceId());
            event.setStatus("PENDING");
            event.setAttempts(0);
            event.setCreatedAt(LocalDateTime.now());
            outboxRepository.save(event);
        } catch (Exception exception) {
            throw new IllegalStateException("Unable to append shipment outbox event", exception);
        }
    }

    private void appendTimeline(Long shipmentId, String status, String message) {
        if (timelineRepository.existsByShipmentIdAndStatus(shipmentId, status)) return;
        ShipmentTimelineEvent event = new ShipmentTimelineEvent();
        event.setShipmentId(shipmentId);
        event.setStatus(status);
        event.setMessage(message);
        event.setOccurredAt(LocalDateTime.now());
        timelineRepository.save(event);
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
        int limitRows = queryEnrichmentInterceptor.getLimitRows();
        int offsetRows = queryEnrichmentInterceptor.getOffsetRows();
        if ("user_behavior_log".equals(joinTable)) {
            jdbcTemplate.queryForList(
                    "SELECT s.* FROM (" +
                    " SELECT f.*, ubl.action_type AS __ubl_action_type, ubl.created_at AS __ubl_created_at" +
                    " FROM fulfillments f" +
                    " JOIN user_behavior_log ubl ON TRUE" +
                    " ORDER BY ubl.created_at DESC, f.id DESC" +
                    " LIMIT " + limitRows + " OFFSET " + offsetRows +
                    ") s" +
                    " WHERE s.__ubl_action_type = 'PLACE_ORDER'" +
                    " ORDER BY s.__ubl_created_at DESC, s.id DESC" +
                    " LIMIT " + limitRows);
        } else if ("product_price_history".equals(joinTable)) {
            jdbcTemplate.queryForList(
                    "SELECT s.* FROM (" +
                    " SELECT f.*, pph.effective_at AS __pph_effective_at" +
                    " FROM fulfillments f" +
                    " JOIN product_price_history pph ON CONCAT(pph.sku, '') = f.order_no" +
                    " ORDER BY pph.effective_at DESC, f.id DESC" +
                    " LIMIT " + limitRows + " OFFSET " + offsetRows +
                    ") s" +
                    " WHERE s.__pph_effective_at <= NOW()" +
                    " ORDER BY s.__pph_effective_at DESC, s.id DESC" +
                    " LIMIT " + limitRows);
        }
    }

    private FulfillmentDTO toDTO(Fulfillment f) {
        FulfillmentDTO dto = new FulfillmentDTO();
        dto.setId(f.getId());
        dto.setOrderId(f.getOrderId());
        dto.setUserId(f.getCustomerId());
        dto.setOrderNo(f.getOrderNo());
        dto.setStatus(f.getStatus());
        dto.setTrackingNo(f.getTrackingNo());
        dto.setCarrier(f.getCarrier());
        dto.setShippedAt(f.getShippedAt());
        dto.setDeliveredAt(f.getDeliveredAt());
        dto.setCreatedAt(f.getCreatedAt());
        dto.setTimeline(timelineRepository.findByShipmentIdOrderByOccurredAtAsc(f.getId()).stream()
            .map(event -> new FulfillmentDTO.TimelineDTO(event.getStatus(), event.getMessage(), event.getOccurredAt()))
            .toList());
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
