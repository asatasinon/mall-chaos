package com.castrel.chaos.notification.service;

import com.castrel.chaos.common.cache.LocalQueryCacheManager;
import com.castrel.chaos.common.interceptor.QueryEnrichmentInterceptor;
import com.castrel.chaos.common.TraceContext;
import com.castrel.chaos.common.observability.SensitiveDataSanitizer;
import com.castrel.chaos.notification.dto.OrderCreatedRequest;
import com.castrel.chaos.notification.dto.PaymentResultRequest;
import com.castrel.chaos.notification.dto.ShippingCreatedRequest;
import com.castrel.chaos.notification.entity.NotificationLog;
import com.castrel.chaos.notification.repository.NotificationLogRepository;
import com.castrel.chaos.notification.repository.CustomerNotificationRepository;
import com.castrel.chaos.notification.repository.NotificationInboxRepository;
import com.castrel.chaos.notification.repository.NotificationOutboxRepository;
import com.castrel.chaos.notification.repository.NotificationPreferenceRepository;
import com.castrel.chaos.notification.entity.NotificationInboxEvent;
import com.castrel.chaos.notification.entity.NotificationOutboxEvent;
import com.castrel.chaos.notification.entity.CustomerNotification;
import com.castrel.chaos.notification.entity.NotificationPreference;
import com.castrel.chaos.notification.dto.CustomerNotificationDTO;
import com.castrel.chaos.notification.dto.NotificationPreferenceDTO;
import com.castrel.chaos.notification.dto.UpdateNotificationPreferenceRequest;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.annotation.PostConstruct;
import org.springframework.transaction.annotation.Transactional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;

@Service
public class NotificationService {

    private static final Logger log = LoggerFactory.getLogger(NotificationService.class);

    @Value("${notification.fail-rate:0.02}")
    private double failRate;

    @Autowired
    private QueryEnrichmentInterceptor queryEnrichmentInterceptor;

    @Autowired
    private LocalQueryCacheManager localQueryCacheManager;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private NotificationLogRepository notificationLogRepository;

    @Autowired
    private CustomerNotificationRepository customerNotificationRepository;

    @Autowired
    private NotificationInboxRepository inboxRepository;

    @Autowired
    private NotificationOutboxRepository outboxRepository;

    @Autowired
    private NotificationPreferenceRepository preferenceRepository;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private MeterRegistry meterRegistry;

    private Counter sentCounter;
    private Counter failCounter;

    @PostConstruct
    void initMetrics() {
        sentCounter = Counter.builder("notification.sent.count")
                .tag("event_type", "all")
                .tag("channel", "MOCK")
                .register(meterRegistry);
        failCounter = Counter.builder("notification.fail.count")
                .register(meterRegistry);
    }

    public void notifyOrderCreated(OrderCreatedRequest req) {
        String message = String.format("【下单成功】您的订单 %s 已创建，金额 ¥%.2f",
                req.getOrderNo(), req.getAmount());
        Map<String, Object> payload = new HashMap<>();
        payload.put("orderNo", req.getOrderNo());
        payload.put("amount", req.getAmount());
        payload.put("sku", req.getSku());
        send(req.getEventId(), req.getUserId(), req.getOrderNo(), "ORDER_CREATED", message, payload);
    }

    public void notifyPaymentResult(PaymentResultRequest req) {
        String message = req.isSuccess()
                ? String.format("【支付成功】订单 %s 支付 ¥%.2f 成功", req.getOrderNo(), req.getAmount())
                : String.format("【支付失败】订单 %s 支付失败，请重试", req.getOrderNo());
        String eventType = req.isSuccess() ? "PAYMENT_SUCCESS" : "PAYMENT_FAILED";
        Map<String, Object> payload = new HashMap<>();
        payload.put("orderNo", req.getOrderNo());
        payload.put("success", req.isSuccess());
        payload.put("amount", req.getAmount());
        send(req.getEventId(), req.getUserId(), req.getOrderNo(), eventType, message, payload);
    }

    public void notifyShippingCreated(ShippingCreatedRequest req) {
        String message = String.format("【已发货】您的订单已由 %s 发出，单号：%s",
                req.getCarrier(), req.getTrackingNo());
        Map<String, Object> payload = new HashMap<>();
        payload.put("orderNo", req.getOrderNo());
        payload.put("trackingNo", req.getTrackingNo());
        payload.put("carrier", req.getCarrier());
        send(req.getEventId(), req.getUserId(), req.getOrderNo(), "SHIPPING", message, payload);
    }

    @Transactional
    private void send(String incomingEventId, Long userId, String orderNo, String eventType,
                      String message, Map<String, Object> payload) {
        String eventId = incomingEventId == null || incomingEventId.isBlank()
                ? UUID.randomUUID().toString() : incomingEventId;
        if (inboxRepository.existsById(eventId)) return;
        NotificationInboxEvent inbox = new NotificationInboxEvent();
        inbox.setEventId(eventId);
        inbox.setEventType(eventType);
        inbox.setReceivedAt(LocalDateTime.now());
        inbox.setStatus("RECEIVED");
        inboxRepository.save(inbox);
        enrichQueryIfNeeded(userId, orderNo);
        NotificationPreference preference = preferenceRepository.findById(userId).orElseGet(() -> {
            NotificationPreference created = new NotificationPreference();
            created.setCustomerId(userId);
            created.setEmail(true);
            created.setInApp(true);
            return preferenceRepository.save(created);
        });
        if (!Boolean.TRUE.equals(preference.getInApp())) {
            inbox.setStatus("PROCESSED");
            inbox.setProcessedAt(LocalDateTime.now());
            inboxRepository.save(inbox);
            return;
        }
        boolean failed = Math.random() < failRate;
        String status = failed ? "FAILED" : "SENT";

        NotificationLog notifLog = new NotificationLog();
        notifLog.setUserId(userId);
        notifLog.setOrderNo(orderNo);
        notifLog.setEventType(eventType);
        notifLog.setChannel("MOCK");
        notifLog.setStatus(status);
        notifLog.setPayload(payload);
        notifLog.setTraceId(TraceContext.getTraceId());
        notificationLogRepository.save(notifLog);
        CustomerNotification notification = new CustomerNotification();
        notification.setCustomerId(userId);
        notification.setEventId(eventId);
        notification.setEventType(eventType);
        notification.setTitle(eventType);
        notification.setBody(message);
        notification.setRead(false);
        notification.setCreatedAt(LocalDateTime.now());
        customerNotificationRepository.save(notification);
        try {
            NotificationOutboxEvent outbox = new NotificationOutboxEvent();
            outbox.setEventId(UUID.randomUUID().toString());
            outbox.setEventType("CUSTOMER_NOTIFICATION_CREATED");
            outbox.setAggregateId(eventId);
            outbox.setAggregateVersion(1);
            outbox.setPayload(objectMapper.writeValueAsString(payload));
            outbox.setOccurredAt(LocalDateTime.now());
            outbox.setSchemaVersion(1);
            outbox.setTraceId(TraceContext.getTraceId());
            outbox.setStatus("PENDING");
            outbox.setAttempts(0);
            outbox.setCreatedAt(LocalDateTime.now());
            outboxRepository.save(outbox);
        } catch (Exception exception) {
            inbox.setStatus("FAILED");
            inbox.setFailureReason(exception.getMessage());
            inboxRepository.save(inbox);
            throw new IllegalStateException("Unable to append notification outbox event", exception);
        }
        inbox.setStatus("PROCESSED");
        inbox.setProcessedAt(LocalDateTime.now());
        inboxRepository.save(inbox);
        localQueryCacheManager.cacheIfNeeded("notification:" + orderNo, notifLog);

        if (failed) {
            log.warn("traceId={} Notification FAILED event={} userId={} orderNo={}", 
                    TraceContext.getTraceId(), eventType, userId, orderNo);
            failCounter.increment();
        } else {
                log.info("traceId={} Notification SENT event={} userId={} orderNo={} messageLength={}",
                    TraceContext.getTraceId(), eventType, userId, orderNo,
                    SensitiveDataSanitizer.message(message).length());
            sentCounter.increment();
        }
    }

    public Page<CustomerNotificationDTO> listCustomerNotifications(Long customerId, Pageable pageable) {
        return customerNotificationRepository.findByCustomerIdOrderByCreatedAtDesc(customerId, pageable)
                .map(notification -> new CustomerNotificationDTO(notification.getId(), notification.getEventType(),
                        notification.getTitle(), notification.getBody(), notification.getRead(),
                        notification.getCreatedAt(), notification.getReadAt()));
    }

    @Transactional
    public CustomerNotificationDTO markRead(Long customerId, Long id) {
        CustomerNotification notification = customerNotificationRepository.findById(id)
                .filter(item -> customerId.equals(item.getCustomerId()))
                .orElseThrow(() -> new com.castrel.chaos.common.BizException("NOTIFICATION_NOT_FOUND", "Notification not found"));
        if (!Boolean.TRUE.equals(notification.getRead())) {
            notification.setRead(true);
            notification.setReadAt(LocalDateTime.now());
            customerNotificationRepository.save(notification);
        }
        return new CustomerNotificationDTO(notification.getId(), notification.getEventType(), notification.getTitle(),
                notification.getBody(), notification.getRead(), notification.getCreatedAt(), notification.getReadAt());
    }

    @Transactional
    public NotificationPreferenceDTO getPreferences(Long customerId) {
        NotificationPreference preference = preferenceRepository.findById(customerId).orElseGet(() -> {
            NotificationPreference created = new NotificationPreference();
            created.setCustomerId(customerId);
            created.setEmail(true);
            created.setInApp(true);
            return preferenceRepository.save(created);
        });
        return new NotificationPreferenceDTO(preference.getEmail(), preference.getInApp());
    }

    @Transactional
    public NotificationPreferenceDTO updatePreferences(Long customerId, UpdateNotificationPreferenceRequest request) {
        NotificationPreference preference = preferenceRepository.findById(customerId).orElseGet(() -> {
            NotificationPreference created = new NotificationPreference();
            created.setCustomerId(customerId);
            created.setEmail(true);
            created.setInApp(true);
            return created;
        });
        if (request.getEmail() != null) {
            preference.setEmail(request.getEmail());
        }
        if (request.getInApp() != null) {
            preference.setInApp(request.getInApp());
        }
        preferenceRepository.save(preference);
        return new NotificationPreferenceDTO(preference.getEmail(), preference.getInApp());
    }

    private void enrichQueryIfNeeded(Long userId, String orderNo) {
        if (!queryEnrichmentInterceptor.shouldEnrich()) return;
        String joinTable = queryEnrichmentInterceptor.getJoinTable();
        int limitRows = queryEnrichmentInterceptor.getLimitRows();
        int offsetRows = queryEnrichmentInterceptor.getOffsetRows();
        if ("user_behavior_log".equals(joinTable)) {
            jdbcTemplate.queryForList(
                    "SELECT s.* FROM (" +
                    " SELECT n.*, ubl.action_type AS __ubl_action_type, ubl.created_at AS __ubl_created_at" +
                    " FROM notification_logs n" +
                    " JOIN user_behavior_log ubl ON ubl.user_id = n.user_id" +
                    " ORDER BY ubl.created_at DESC, n.id DESC" +
                    " LIMIT " + limitRows + " OFFSET " + offsetRows +
                    ") s" +
                    " WHERE s.__ubl_action_type = 'PLACE_ORDER'" +
                    " ORDER BY s.__ubl_created_at DESC, s.id DESC" +
                    " LIMIT " + limitRows);
        } else if ("product_price_history".equals(joinTable)) {
            jdbcTemplate.queryForList(
                    "SELECT s.* FROM (" +
                    " SELECT n.*, pph.effective_at AS __pph_effective_at" +
                    " FROM notification_logs n" +
                    " JOIN product_price_history pph ON CONCAT(pph.sku, '') = n.order_no" +
                    " ORDER BY pph.effective_at DESC, n.id DESC" +
                    " LIMIT " + limitRows + " OFFSET " + offsetRows +
                    ") s" +
                    " WHERE s.__pph_effective_at <= NOW()" +
                    " ORDER BY s.__pph_effective_at DESC, s.id DESC" +
                    " LIMIT " + limitRows);
        }
    }
}
