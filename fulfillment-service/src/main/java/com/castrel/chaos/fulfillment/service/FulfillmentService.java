package com.castrel.chaos.fulfillment.service;

import com.castrel.chaos.common.BizException;
import com.castrel.chaos.common.TraceContext;
import com.castrel.chaos.common.cache.LocalQueryCacheManager;
import com.castrel.chaos.fulfillment.dto.CancelFulfillmentRequest;
import com.castrel.chaos.fulfillment.dto.CreateFulfillmentRequest;
import com.castrel.chaos.fulfillment.dto.FulfillmentDTO;
import com.castrel.chaos.fulfillment.entity.Fulfillment;
import com.castrel.chaos.fulfillment.repository.FulfillmentRepository;
import com.castrel.chaos.fulfillment.repository.ShipmentTimelineRepository;
import com.castrel.chaos.fulfillment.entity.ShipmentTimelineEvent;
import com.castrel.chaos.common.event.EventEnvelope;
import com.castrel.chaos.common.event.EventEnvelopeCodec;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.client.RestTemplateBuilder;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.client.RestTemplate;

import java.time.LocalDateTime;
import java.util.UUID;

@Service
public class FulfillmentService {

    @Autowired
    private FulfillmentRepository fulfillmentRepository;

    @Autowired
    private ShipmentTimelineRepository timelineRepository;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private LocalQueryCacheManager localQueryCacheManager;

    @Autowired
    private MeterRegistry meterRegistry;

    private final RestTemplate client;

    @Value("${services.notification-url:http://localhost:8090}")
    private String notificationUrl;

    @Value("${CASTREL_INTERNAL_SERVICE_KEY:}")
    private String serviceKey;

    public FulfillmentService(RestTemplateBuilder builder) {
        this.client = builder.build();
    }

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
        // Idempotency: return existing if already created
        return fulfillmentRepository.findByOrderId(req.getOrderId())
                .map(this::toDTO)
                .orElseGet(() -> {
                    Fulfillment f = new Fulfillment();
                    f.setOrderId(req.getOrderId());
                    f.setCustomerId(req.getUserId());
                    f.setOrderNo(req.getOrderNo());
                    f.setStatus("FULFILLING");
                    f.setTrackingNo("TRACK-" + UUID.randomUUID().toString().replace("-", "").substring(0, 8).toUpperCase());
                    f.setCarrier("MockExpress");
                    f.setTraceId(TraceContext.getTraceId());
                    fulfillmentRepository.save(f);
                    appendTimeline(f.getId(), "FULFILLING", "Shipment created");
                    createCounter.increment();
                    advanceStatus(f.getOrderId());
                    FulfillmentDTO result = toDTO(f);
                    localQueryCacheManager.cacheIfNeeded("fulfillment:" + f.getOrderNo(), result);
                    return result;
                });
    }

    public void advanceStatus(Long orderId) {
        updateStatus(orderId, "SHIPPED", LocalDateTime.now(), null);
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
        FulfillmentDTO dto = toDTO(fulfillment);
        EventEnvelope<JsonNode> envelope = EventEnvelopeCodec.create(objectMapper,
                UUID.randomUUID().toString(), "SHIPMENT_UPDATED", fulfillment.getOrderNo(),
                1, dto, TraceContext.getTraceId(), null);
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        if (serviceKey != null && !serviceKey.isBlank()) {
            headers.set("X-Internal-Service-Key", serviceKey);
        }
        client.postForEntity(notificationUrl + "/internal/notifications/shipping-created",
                new HttpEntity<>(envelope, headers), Void.class);
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
        Fulfillment f = fulfillmentRepository.findByOrderId(req.getOrderId())
                .orElseThrow(() -> new BizException("FULFILLMENT_NOT_FOUND",
                        "Fulfillment not found for orderId: " + req.getOrderId()));

        if (!"FULFILLING".equals(f.getStatus())) {
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
        return fulfillmentRepository.findByOrderId(orderId)
                .map(this::toDTO)
                .orElseThrow(() -> new BizException("FULFILLMENT_NOT_FOUND",
                        "Fulfillment not found for orderId: " + orderId));
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
        dto.setCreatedAt(f.getCreatedAt());
        java.util.List<ShipmentTimelineEvent> timeline = timelineRepository.findByShipmentIdOrderByOccurredAtAsc(f.getId());
        dto.setShippedAt(timeline.stream()
            .filter(event -> "SHIPPED".equals(event.getStatus()))
            .map(ShipmentTimelineEvent::getOccurredAt)
            .findFirst()
            .orElse(f.getShippedAt()));
        dto.setDeliveredAt(timeline.stream()
            .filter(event -> "DELIVERED".equals(event.getStatus()) || "COMPLETED".equals(event.getStatus()))
            .map(ShipmentTimelineEvent::getOccurredAt)
            .findFirst()
            .orElse(f.getDeliveredAt()));
        dto.setTimeline(timeline.stream()
            .map(event -> new FulfillmentDTO.TimelineDTO(event.getStatus(), event.getMessage(), event.getOccurredAt()))
            .toList());
        return dto;
    }

}
