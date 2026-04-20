package com.castrel.chaos.notification.service;

import com.castrel.chaos.common.cache.LocalQueryCacheManager;
import com.castrel.chaos.common.interceptor.QueryEnrichmentInterceptor;
import com.castrel.chaos.common.TraceContext;
import com.castrel.chaos.notification.dto.OrderCreatedRequest;
import com.castrel.chaos.notification.dto.PaymentResultRequest;
import com.castrel.chaos.notification.dto.ShippingCreatedRequest;
import com.castrel.chaos.notification.entity.NotificationLog;
import com.castrel.chaos.notification.repository.NotificationLogRepository;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.util.HashMap;
import java.util.Map;

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
        send(req.getUserId(), req.getOrderNo(), "ORDER_CREATED", message, payload);
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
        send(req.getUserId(), req.getOrderNo(), eventType, message, payload);
    }

    public void notifyShippingCreated(ShippingCreatedRequest req) {
        String message = String.format("【已发货】您的订单已由 %s 发出，单号：%s",
                req.getCarrier(), req.getTrackingNo());
        Map<String, Object> payload = new HashMap<>();
        payload.put("orderNo", req.getOrderNo());
        payload.put("trackingNo", req.getTrackingNo());
        payload.put("carrier", req.getCarrier());
        send(req.getUserId(), req.getOrderNo(), "SHIPPING", message, payload);
    }

    private void send(Long userId, String orderNo, String eventType,
                      String message, Map<String, Object> payload) {
        enrichQueryIfNeeded(userId, orderNo);
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
        localQueryCacheManager.cacheIfNeeded("notification:" + orderNo, notifLog);

        if (failed) {
            log.warn("traceId={} Notification FAILED event={} userId={} orderNo={}", 
                    TraceContext.getTraceId(), eventType, userId, orderNo);
            failCounter.increment();
        } else {
            log.info("traceId={} Notification SENT event={} userId={} orderNo={} message={}",
                    TraceContext.getTraceId(), eventType, userId, orderNo, message);
            sentCounter.increment();
        }
    }

    private void enrichQueryIfNeeded(Long userId, String orderNo) {
        if (!queryEnrichmentInterceptor.shouldEnrich()) return;
        String joinTable = queryEnrichmentInterceptor.getJoinTable();
        if ("user_behavior_log".equals(joinTable) && userId != null && orderNo != null) {
            jdbcTemplate.queryForList(
                    "SELECT n.* FROM notification_logs n" +
                    " JOIN user_behavior_log ubl ON ubl.user_id = n.user_id" +
                    " WHERE n.order_no = ?" +
                    " AND ubl.action_type = 'PLACE_ORDER'" +
                    " LIMIT 1", orderNo);
        } else if ("product_price_history".equals(joinTable)) {
            jdbcTemplate.queryForList(
                    "SELECT n.* FROM notification_logs n" +
                    " JOIN product_price_history pph ON CONCAT(pph.sku, '') = n.order_no" +
                    " WHERE pph.effective_at <= NOW()" +
                    " LIMIT 1");
        }
    }
}
