package com.castrel.chaos.notification.service;

import com.castrel.chaos.common.cache.LocalQueryCacheManager;
import com.castrel.chaos.common.TraceContext;
import com.castrel.chaos.common.observability.SensitiveDataSanitizer;
import com.castrel.chaos.notification.dto.PaymentResultRequest;
import com.castrel.chaos.notification.dto.ShippingCreatedRequest;
import com.castrel.chaos.notification.repository.CustomerNotificationRepository;
import com.castrel.chaos.notification.repository.NotificationPreferenceRepository;
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
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;

@Service
public class NotificationService {

    private static final Logger log = LoggerFactory.getLogger(NotificationService.class);

    @Value("${notification.fail-rate:0.0}")
    private double failRate;

    @Autowired
    private LocalQueryCacheManager localQueryCacheManager;

    @Autowired
    private CustomerNotificationRepository customerNotificationRepository;

    @Autowired
    private NotificationPreferenceRepository preferenceRepository;

    @Autowired
    private MeterRegistry meterRegistry;

    @Autowired
    private NotificationRetentionState retentionState;

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

    @Transactional
    public void notifyPaymentResult(PaymentResultRequest req) {
        BigDecimal amount = req.getAmount() != null ? req.getAmount() : req.getTotalAmount();
        String message = req.isSuccess()
            ? String.format("[Payment Successful] Payment for order %s of ¥%.2f succeeded", req.getOrderNo(), amount)
                : String.format("[Payment Failed] Payment for order %s failed. Please try again", req.getOrderNo());
        String eventType = req.isSuccess() ? "PAYMENT_SUCCESS" : "PAYMENT_FAILED";
        send(req.getEventId(), req.getUserId(), req.getOrderNo(), eventType, message);
    }

    @Transactional
    public void notifyShippingCreated(ShippingCreatedRequest req) {
        String message = String.format("[Shipped] Your order was shipped by %s. Tracking number: %s",
                req.getCarrier(), req.getTrackingNo());
        send(req.getEventId(), req.getUserId(), req.getOrderNo(), "SHIPPING", message);
    }

    private void send(String incomingEventId, Long userId, String orderNo, String eventType,
                      String message) {
        String eventId = incomingEventId == null || incomingEventId.isBlank()
                ? UUID.randomUUID().toString() : incomingEventId;
        if (customerNotificationRepository.existsByCustomerIdAndEventId(userId, eventId)) {
            return;
        }
        NotificationPreference preference = preferenceRepository.findById(userId).orElseGet(() -> {
            NotificationPreference created = new NotificationPreference();
            created.setCustomerId(userId);
            created.setEmail(true);
            created.setInApp(true);
            return preferenceRepository.save(created);
        });
        if (!Boolean.TRUE.equals(preference.getInApp())) {
            return;
        }
        boolean failed = Math.random() < failRate;
        String status = failed ? "FAILED" : "SENT";

        CustomerNotification notification = new CustomerNotification();
        notification.setCustomerId(userId);
        notification.setEventId(eventId);
        notification.setEventType(eventType);
        notification.setTitle(eventType);
        notification.setBody(message);
        notification.setRead(false);
        notification.setCreatedAt(LocalDateTime.now());
        retentionState.shouldRetain();
        customerNotificationRepository.save(notification);
        localQueryCacheManager.cacheIfNeeded("notification:" + orderNo, notification);

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

}
