package com.castrel.chaos.order.service;

import com.castrel.chaos.common.BizException;
import com.castrel.chaos.common.TraceContext;
import com.castrel.chaos.common.cache.LocalQueryCacheManager;
import com.castrel.chaos.common.interceptor.QueryEnrichmentInterceptor;
import com.castrel.chaos.order.client.DownstreamClients;
import com.castrel.chaos.order.dto.CheckoutCommand;
import com.castrel.chaos.order.dto.CheckoutFreeze;
import com.castrel.chaos.order.dto.CheckoutItem;
import com.castrel.chaos.order.dto.PaymentResultRequest;
import com.castrel.chaos.order.dto.OrderItemDTO;
import com.castrel.chaos.order.dto.RiskRejectedRequest;
import com.castrel.chaos.order.dto.OrderDTO;
import com.castrel.chaos.order.entity.Order;
import com.castrel.chaos.order.entity.OrderItem;
import com.castrel.chaos.order.entity.OrderAddressSnapshot;
import com.castrel.chaos.order.repository.OrderItemRepository;
import com.castrel.chaos.order.repository.OrderAddressSnapshotRepository;
import com.castrel.chaos.order.repository.OrderRepository;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
public class OrderService {

    private static final Logger log = LoggerFactory.getLogger(OrderService.class);

    @Autowired
    private OrderRepository orderRepository;

    @Autowired
    private OrderItemRepository orderItemRepository;

    @Autowired
    private OrderAddressSnapshotRepository addressSnapshotRepository;

    @Autowired
    private DownstreamClients clients;

    @Autowired
    private QueryEnrichmentInterceptor queryEnrichmentInterceptor;

    @Autowired
    private LocalQueryCacheManager localQueryCacheManager;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private MeterRegistry meterRegistry;

    private Timer checkoutTimer;

    @Transactional
    public OrderDTO checkout(Long customerId, CheckoutCommand command) {
        Timer.Sample sample = Timer.start(meterRegistry);
        try {
            if (customerId == null || command == null || command.getIdempotencyKey() == null
                    || command.getIdempotencyKey().isBlank() || command.getCartId() == null
                    || command.getCartVersion() == null || command.getAddressId() == null) {
                throw new BizException("INVALID_CHECKOUT", "cart, version, address and idempotencyKey are required");
            }
            return orderRepository.findByUserIdAndIdempotencyKey(customerId, command.getIdempotencyKey())
                    .map(this::toDTO)
                    .orElseGet(() -> createPendingCheckout(customerId, command));
        } finally {
            sample.stop(checkoutTimer);
        }
    }

    private OrderDTO createPendingCheckout(Long customerId, CheckoutCommand command) {
        CheckoutFreeze freeze = clients.freezeCart(customerId, command);
        List<String> skus = freeze.getItems().stream().map(CheckoutItem::getSku).toList();
        List<Map<String, Object>> products = clients.batchCatalog(skus);
        Map<String, Map<String, Object>> bySku = products.stream()
                .collect(java.util.stream.Collectors.toMap(
                        product -> String.valueOf(product.get("sku")), product -> product));
        BigDecimal subtotal = BigDecimal.ZERO;
        String orderNo = generateOrderNo();
        String orderId = orderNo;
        List<String> reservedSkus = new java.util.ArrayList<>();
        Long reservedCouponId = null;
        try {
            for (CheckoutItem item : freeze.getItems()) {
                Map<String, Object> product = bySku.get(item.getSku());
                if (product == null || ((Number) product.getOrDefault("status", 0)).intValue() != 1) {
                    throw new BizException("PRODUCT_UNAVAILABLE", "Product not available: " + item.getSku());
                }
                item.setProductName(String.valueOf(product.get("name")));
                item.setUnitPrice(new BigDecimal(String.valueOf(product.get("price"))));
                subtotal = subtotal.add(item.getUnitPrice().multiply(BigDecimal.valueOf(item.getQuantity())));
            }
            List<Map<String, Object>> promotionItems = freeze.getItems().stream().map(item -> Map.<String, Object>of(
                    "sku", item.getSku(), "quantity", item.getQuantity())).toList();
                Map<String, Object> promotion = clients.calculatePromotion(customerId, orderNo,
                        command.getCouponId(), promotionItems);
                BigDecimal discount = promotion == null || promotion.get("discountAmount") == null
                    ? BigDecimal.ZERO : new BigDecimal(String.valueOf(promotion.get("discountAmount")));
                BigDecimal total = promotion == null || promotion.get("finalAmount") == null
                    ? subtotal : new BigDecimal(String.valueOf(promotion.get("finalAmount")));
                if (promotion != null && promotion.get("usedCouponId") != null) {
                    reservedCouponId = Long.valueOf(String.valueOf(promotion.get("usedCouponId")));
                }
                List<Map<String, Object>> riskItems = freeze.getItems().stream().map(item -> Map.<String, Object>of(
                    "sku", item.getSku(), "quantity", item.getQuantity())).toList();
            Map<String, Object> risk = clients.preCheckRisk(customerId, orderNo,
                    total, riskItems);
            if (risk != null && Boolean.FALSE.equals(risk.get("passed"))) {
                throw new BizException("RISK_REJECTED", String.valueOf(risk.getOrDefault("reason", "Risk rejected")));
            }
            for (CheckoutItem item : freeze.getItems()) {
                String reservationId = orderNo + ":" + item.getSku();
                clients.reserveInventory(orderId, item.getSku(), item.getQuantity(), reservationId, reservationId);
                reservedSkus.add(item.getSku());
            }
            Order order = new Order();
            order.setOrderNo(orderNo);
            order.setIdempotencyKey(command.getIdempotencyKey());
            order.setUserId(customerId);
            order.setStatus("PENDING_PAYMENT");
            order.setSubtotal(subtotal);
            order.setDiscountAmount(discount);
            order.setTotalAmount(total);
            order.setAddressId(command.getAddressId());
            order.setCouponId(reservedCouponId);
            order.setTraceId(TraceContext.getTraceId());
            order.setCreatedAt(LocalDateTime.now());
            order.setUpdatedAt(LocalDateTime.now());
            order = orderRepository.save(order);
            Map<String, Object> addressResponse = clients.getAddress(customerId, command.getAddressId());
            Map<String, Object> address = addressResponse == null ? Map.of() : (Map<String, Object>) addressResponse.get("data");
            if (address == null || address.isEmpty()) {
                throw new BizException("ADDRESS_NOT_FOUND", "Address not found for customer");
            }
            OrderAddressSnapshot snapshot = new OrderAddressSnapshot();
            snapshot.setOrderId(order.getId());
            snapshot.setReceiver(String.valueOf(address.get("receiver")));
            snapshot.setPhone(String.valueOf(address.get("phone")));
            snapshot.setProvince(String.valueOf(address.get("province")));
            snapshot.setCity(String.valueOf(address.get("city")));
            snapshot.setDistrict(String.valueOf(address.get("district")));
            snapshot.setDetail(String.valueOf(address.get("detail")));
            addressSnapshotRepository.save(snapshot);
            for (CheckoutItem item : freeze.getItems()) {
                OrderItem orderItem = new OrderItem();
                orderItem.setOrderId(order.getId());
                orderItem.setSku(item.getSku());
                orderItem.setProductName(item.getProductName());
                orderItem.setQuantity(item.getQuantity());
                orderItem.setUnitPrice(item.getUnitPrice());
                orderItem.setLineAmount(item.getUnitPrice().multiply(BigDecimal.valueOf(item.getQuantity())));
                orderItemRepository.save(orderItem);
            }
            clients.consumeCartFreeze(command.getIdempotencyKey(), freeze.getFreezeToken());
            return toDTO(order);
        } catch (RuntimeException exception) {
            for (String sku : reservedSkus) {
                try {
                    clients.releaseInventory(orderId, sku, orderNo + ":" + sku);
                } catch (Exception ignored) {
                    log.warn("Failed to release inventory reservation for {}", sku);
                }
            }
            if (reservedCouponId != null) {
                try {
                    clients.releaseCoupon(orderNo, reservedCouponId);
                } catch (Exception ignored) {
                    log.warn("Failed to release coupon reservation {}", reservedCouponId);
                }
            }
            try {
                clients.releaseCartFreeze(command.getIdempotencyKey(), freeze.getFreezeToken());
            } catch (Exception ignored) {
                log.warn("Failed to release cart freeze {}", command.getIdempotencyKey());
            }
            throw exception;
        }
    }

    private String generateOrderNo() {
        return "ORD-" + UUID.randomUUID().toString().replace("-", "").substring(0, 28);
    }

    @PostConstruct
    void initMetrics() {
        checkoutTimer = Timer.builder("checkout_duration").register(meterRegistry);
    }

    public OrderDTO getOrder(Long id) {
        enrichQueryIfNeeded(null);
        OrderDTO result = orderRepository.findById(id)
                .map(this::toDTO)
                .orElseThrow(() -> new BizException("ORDER_NOT_FOUND", "Order not found: " + id));
        localQueryCacheManager.cacheIfNeeded("order:" + id, result);
        return result;
    }

    public OrderDTO getCustomerOrder(Long customerId, Long id) {
        Order order = orderRepository.findById(id)
                .filter(candidate -> customerId.equals(candidate.getUserId()))
                .orElseThrow(() -> new BizException("ORDER_NOT_FOUND", "Order not found: " + id));
        return toDTO(order);
    }

    public Page<OrderDTO> listCustomerOrders(Long customerId, Pageable pageable) {
        return orderRepository.findByUserIdOrderByCreatedAtDesc(customerId, pageable).map(this::toDTO);
    }

    @Transactional
    public OrderDTO cancelOrder(Long id) {
        Order order = orderRepository.findById(id)
                .orElseThrow(() -> new BizException("ORDER_NOT_FOUND", "Order not found: " + id));
        if (!"PENDING".equals(order.getStatus()) && !"PENDING_PAYMENT".equals(order.getStatus())) {
            throw new BizException("INVALID_STATUS", "Can only cancel PENDING orders");
        }
        for (OrderItem item : orderItemRepository.findByOrderIdOrderByIdAsc(order.getId())) {
            try {
                clients.releaseInventory(order.getOrderNo(), item.getSku(), order.getOrderNo() + ":" + item.getSku());
            } catch (Exception exception) {
                log.warn("Failed to release inventory during cancel: {}", exception.getMessage());
            }
        }
        if (orderRepository.cancelPending(order.getId(), order.getVersion()) == 0) {
            throw new BizException("ORDER_STATE_CONFLICT", "Order state changed before cancellation");
        }
        order.setStatus("CANCELLED");
        order.setVersion(order.getVersion() + 1);
        return toDTO(order);
    }

    @Transactional
    public OrderDTO cancelCustomerOrder(Long customerId, Long id) {
        Order order = orderRepository.findById(id)
                .filter(candidate -> customerId.equals(candidate.getUserId()))
                .orElseThrow(() -> new BizException("ORDER_NOT_FOUND", "Order not found: " + id));
        return cancelOrder(order);
    }

    @Transactional
    public OrderDTO markPaid(Long id, String paymentId) {
        Order order = orderRepository.findById(id)
                .orElseThrow(() -> new BizException("ORDER_NOT_FOUND", "Order not found: " + id));
        if ("PAID".equals(order.getStatus())) return toDTO(order);
        if (orderRepository.markPaid(order.getId(), order.getVersion(), paymentId) == 0) {
            throw new BizException("ORDER_STATE_CONFLICT", "Order is no longer pending payment");
        }
        order.setStatus("PAID");
        order.setPaymentId(paymentId);
        order.setVersion(order.getVersion() + 1);
        return toDTO(order);
    }

    @Transactional
    public OrderDTO applyPaymentResult(PaymentResultRequest request) {
        if (request.getEventId() == null || request.getEventId().isBlank()) {
            throw new BizException("EVENT_ID_REQUIRED", "Payment eventId is required");
        }
        Order order = orderRepository.findByOrderNo(request.getOrderNo())
                .orElseThrow(() -> new BizException("ORDER_NOT_FOUND", "Order not found: " + request.getOrderNo()));
        if ("PAID".equals(order.getStatus()) || "PAYMENT_FAILED".equals(order.getStatus())) {
            return toDTO(order);
        }
        boolean success = "SUCCESS".equals(request.getStatus());
        boolean unknown = "UNKNOWN".equals(request.getStatus());
        String status = success ? "PAID" : unknown ? "PENDING_PAYMENT" : "PAYMENT_FAILED";
        String reason = success || unknown ? null : request.getResultCode();
        String paymentId = request.getPaymentId() == null
            ? request.getPaymentNo() : String.valueOf(request.getPaymentId());
        if (orderRepository.applyPaymentResult(order.getOrderNo(), order.getVersion(), status,
            paymentId, reason) == 0) {
            throw new BizException("ORDER_STATE_CONFLICT", "Payment result lost order state race");
        }
        order.setStatus(status);
        order.setPaymentId(paymentId);
        order.setFailReason(reason);
        order.setVersion(order.getVersion() + 1);
        if (success) {
            for (OrderItem item : orderItemRepository.findByOrderIdOrderByIdAsc(order.getId())) {
                String reservationId = order.getOrderNo() + ":" + item.getSku();
                clients.confirmInventory(order.getOrderNo(), item.getSku(), reservationId);
            }
            if (order.getCouponId() != null) {
                clients.confirmCoupon(order.getOrderNo(), order.getCouponId());
            }
        }
        if (success) {
            clients.postPaymentRisk(toDTO(order));
        }
        clients.notifyPaymentResult(toDTO(order), request.getEventId());
        return toDTO(order);
    }

    @Transactional
    public Map<String, Object> retryCustomerPayment(Long customerId, Long orderId) {
        Order order = orderRepository.findById(orderId)
                .filter(candidate -> customerId.equals(candidate.getUserId()))
                .orElseThrow(() -> new BizException("ORDER_NOT_FOUND", "Order not found: " + orderId));
        if (!"PENDING_PAYMENT".equals(order.getStatus()) || order.getPaymentId() == null) {
            throw new BizException("PAYMENT_NOT_RETRYABLE", "Order has no retryable payment");
        }
        for (OrderItem item : orderItemRepository.findByOrderIdOrderByIdAsc(order.getId())) {
            String retryReservation = order.getOrderNo() + ":retry:" + item.getSku() + ":" + order.getVersion();
            clients.reserveInventory(order.getOrderNo(), item.getSku(), item.getQuantity(), retryReservation, retryReservation);
        }
        final Long paymentId;
        try {
            paymentId = Long.valueOf(order.getPaymentId());
        } catch (NumberFormatException exception) {
            throw new BizException("PAYMENT_NOT_RETRYABLE", "Order payment reference is invalid");
        }
        return clients.retryPayment(paymentId);
    }

    @Transactional
    public OrderDTO expireOrder(Long orderId) {
        Order order = orderRepository.findById(orderId)
                .orElseThrow(() -> new BizException("ORDER_NOT_FOUND", "Order not found: " + orderId));
        if (!"PENDING_PAYMENT".equals(order.getStatus())) return toDTO(order);
        if (orderRepository.expirePending(order.getId(), order.getVersion()) == 0) {
            throw new BizException("ORDER_STATE_CONFLICT", "Order state changed before expiration");
        }
        for (OrderItem item : orderItemRepository.findByOrderIdOrderByIdAsc(order.getId())) {
            try {
                clients.expireInventory(order.getOrderNo() + ":" + item.getSku(), item.getSku());
            } catch (Exception exception) {
                log.warn("Failed to expire inventory reservation for {}", item.getSku());
            }
        }
        if (order.getCouponId() != null) {
            clients.releaseCoupon(order.getOrderNo(), order.getCouponId());
        }
        order.setStatus("PAYMENT_FAILED");
        order.setFailReason("RESERVATION_EXPIRED");
        order.setVersion(order.getVersion() + 1);
        return toDTO(order);
    }

    @Transactional
    public OrderDTO applyRiskRejected(RiskRejectedRequest request) {
        Order order = orderRepository.findByOrderNo(request.getOrderNo())
                .orElseThrow(() -> new BizException("ORDER_NOT_FOUND", "Order not found: " + request.getOrderNo()));
        if ("CANCELLED".equals(order.getStatus()) || "PAYMENT_FAILED".equals(order.getStatus())) {
            return toDTO(order);
        }
        for (OrderItem item : orderItemRepository.findByOrderIdOrderByIdAsc(order.getId())) {
            try {
                clients.releaseInventory(order.getOrderNo(), item.getSku(), order.getOrderNo() + ":" + item.getSku());
            } catch (Exception exception) {
                log.warn("Failed to release risk-rejected inventory for {}", item.getSku());
            }
        }
        if (order.getCouponId() != null) clients.releaseCoupon(order.getOrderNo(), order.getCouponId());
        order.setStatus("PAYMENT_FAILED");
        order.setFailReason(request.getReason());
        order.setVersion(order.getVersion() + 1);
        return toDTO(orderRepository.save(order));
    }

    private OrderDTO cancelOrder(Order order) {
        if (!"PENDING".equals(order.getStatus()) && !"PENDING_PAYMENT".equals(order.getStatus())) {
            throw new BizException("INVALID_STATUS", "Can only cancel PENDING orders");
        }
        for (OrderItem item : orderItemRepository.findByOrderIdOrderByIdAsc(order.getId())) {
            try {
                clients.releaseInventory(order.getOrderNo(), item.getSku(), order.getOrderNo() + ":" + item.getSku());
            } catch (Exception e) {
                log.warn("Failed to release inventory during cancel: {}", e.getMessage());
            }
        }
        if (order.getCouponId() != null) {
            try {
                clients.releaseCoupon(order.getOrderNo(), order.getCouponId());
            } catch (Exception e) {
                log.warn("Failed to release coupon during cancel: {}", e.getMessage());
            }
        }
        if (orderRepository.cancelPending(order.getId(), order.getVersion()) == 0) {
            throw new BizException("ORDER_STATE_CONFLICT", "Order state changed before cancellation");
        }
        order.setStatus("CANCELLED");
        order.setVersion(order.getVersion() + 1);
        return toDTO(order);
    }

    private void enrichQueryIfNeeded(Long userId) {
        if (!queryEnrichmentInterceptor.shouldEnrich()) return;
        String joinTable = queryEnrichmentInterceptor.getJoinTable();
        int limitRows = queryEnrichmentInterceptor.getLimitRows();
        int offsetRows = queryEnrichmentInterceptor.getOffsetRows();
        if ("user_behavior_log".equals(joinTable)) {
            jdbcTemplate.queryForList(
                    "SELECT s.* FROM (" +
                    " SELECT o.*, ubl.action_type AS __ubl_action_type, ubl.created_at AS __ubl_created_at" +
                    " FROM orders o" +
                    " JOIN user_behavior_log ubl ON ubl.user_id = o.user_id" +
                    " ORDER BY ubl.created_at DESC, o.id DESC" +
                    " LIMIT " + limitRows + " OFFSET " + offsetRows +
                    ") s" +
                    " WHERE s.status = 'PENDING'" +
                    " AND s.__ubl_action_type = 'PLACE_ORDER'" +
                    " ORDER BY s.__ubl_created_at DESC, s.id DESC" +
                    " LIMIT " + limitRows);
        } else if ("product_price_history".equals(joinTable)) {
            jdbcTemplate.queryForList(
                    "SELECT s.* FROM (" +
                    " SELECT o.*, pph.effective_at AS __pph_effective_at" +
                    " FROM orders o" +
                    " JOIN order_items oi ON oi.order_id = o.id" +
                    " JOIN product_price_history pph ON CONCAT(pph.sku, '') = oi.sku" +
                    " ORDER BY pph.effective_at DESC, o.id DESC" +
                    " LIMIT " + limitRows + " OFFSET " + offsetRows +
                    ") s" +
                    " WHERE s.status = 'PENDING'" +
                    " AND s.__pph_effective_at <= NOW()" +
                    " ORDER BY s.__pph_effective_at DESC, s.id DESC" +
                    " LIMIT " + limitRows);
        }
    }

    private OrderDTO toDTO(Order o) {
        OrderDTO dto = new OrderDTO();
        dto.setId(o.getId());
        dto.setOrderNo(o.getOrderNo());
        dto.setUserId(o.getUserId());
        dto.setStatus(o.getStatus());
        dto.setPaymentId(o.getPaymentId());
        dto.setFailReason(o.getFailReason());
        dto.setSubtotal(o.getSubtotal());
        dto.setDiscountAmount(o.getDiscountAmount());
        dto.setTotalAmount(o.getTotalAmount());
        dto.setAddressId(o.getAddressId());
        dto.setCouponId(o.getCouponId());
        dto.setVersion(o.getVersion());
        dto.setItems(orderItemRepository.findByOrderIdOrderByIdAsc(o.getId()).stream()
            .map(item -> new OrderItemDTO(item.getSku(), item.getProductName(), item.getQuantity(),
                item.getUnitPrice(), item.getLineAmount()))
            .toList());
        return dto;
    }
}
