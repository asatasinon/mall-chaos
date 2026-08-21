package com.castrel.chaos.order.service;

import com.castrel.chaos.common.BizException;
import com.castrel.chaos.common.TraceContext;
import com.castrel.chaos.common.cache.LocalQueryCacheManager;
import com.castrel.chaos.common.interceptor.QueryEnrichmentInterceptor;
import com.castrel.chaos.order.client.DownstreamClients;
import com.castrel.chaos.order.dto.CreateOrderRequest;
import com.castrel.chaos.order.dto.CheckoutCommand;
import com.castrel.chaos.order.dto.CheckoutFreeze;
import com.castrel.chaos.order.dto.CheckoutItem;
import com.castrel.chaos.order.dto.PaymentResultRequest;
import com.castrel.chaos.order.dto.OrderDTO;
import com.castrel.chaos.order.entity.Order;
import com.castrel.chaos.order.entity.OrderItem;
import com.castrel.chaos.order.repository.OrderItemRepository;
import com.castrel.chaos.order.repository.OrderRepository;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
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
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
public class OrderService {

    private static final Logger log = LoggerFactory.getLogger(OrderService.class);
    private static final String IDEMPOTENT_PREFIX = "idempotent:order:";

    @Autowired
    private OrderRepository orderRepository;

    @Autowired
    private OrderItemRepository orderItemRepository;

    @Autowired
    private DownstreamClients clients;

    @Autowired
    private StringRedisTemplate redis;

    @Autowired
    private QueryEnrichmentInterceptor queryEnrichmentInterceptor;

    @Autowired
    private LocalQueryCacheManager localQueryCacheManager;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private MeterRegistry meterRegistry;

    private Counter successCounter;
    private Counter failCounter;

    @Transactional
    public OrderDTO checkout(Long customerId, CheckoutCommand command) {
        if (customerId == null || command == null || command.getIdempotencyKey() == null
                || command.getIdempotencyKey().isBlank() || command.getCartId() == null
                || command.getCartVersion() == null || command.getAddressId() == null) {
            throw new BizException("INVALID_CHECKOUT", "cart, version, address and idempotencyKey are required");
        }
        return orderRepository.findByUserIdAndIdempotencyKey(customerId, command.getIdempotencyKey())
                .map(this::toDTO)
                .orElseGet(() -> createPendingCheckout(customerId, command));
    }

    private OrderDTO createPendingCheckout(Long customerId, CheckoutCommand command) {
        CheckoutFreeze freeze = clients.freezeCart(customerId, command);
        List<String> skus = freeze.getItems().stream().map(CheckoutItem::getSku).toList();
        List<Map<String, Object>> products = clients.batchCatalog(skus);
        Map<String, Map<String, Object>> bySku = products.stream()
                .collect(java.util.stream.Collectors.toMap(
                        product -> String.valueOf(product.get("sku")), product -> product));
        BigDecimal subtotal = BigDecimal.ZERO;
        String orderId = UUID.randomUUID().toString();
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
            CheckoutItem riskItem = freeze.getItems().get(0);
            Map<String, Object> risk = clients.preCheckRisk(customerId, command.getIdempotencyKey(),
                    subtotal, riskItem.getSku(), riskItem.getQuantity());
            if (risk != null && Boolean.FALSE.equals(risk.get("passed"))) {
                throw new BizException("RISK_REJECTED", String.valueOf(risk.getOrDefault("reason", "Risk rejected")));
            }
            for (CheckoutItem item : freeze.getItems()) {
                String reservationId = command.getIdempotencyKey() + ":" + item.getSku();
                clients.reserveInventory(orderId, item.getSku(), item.getQuantity(), reservationId, reservationId);
            }
            Order order = new Order();
            order.setOrderNo(command.getIdempotencyKey());
            order.setIdempotencyKey(command.getIdempotencyKey());
            order.setUserId(customerId);
            order.setStatus("PENDING_PAYMENT");
            order.setSubtotal(subtotal);
            order.setDiscountAmount(BigDecimal.ZERO);
            order.setTotalAmount(subtotal);
            order.setAmount(subtotal);
            order.setAddressId(command.getAddressId());
            order.setTraceId(TraceContext.getTraceId());
            order.setCreatedAt(LocalDateTime.now());
            order.setUpdatedAt(LocalDateTime.now());
            order = orderRepository.save(order);
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
            try {
                clients.releaseCartFreeze(command.getIdempotencyKey(), freeze.getFreezeToken());
            } catch (Exception ignored) {
                log.warn("Failed to release cart freeze {}", command.getIdempotencyKey());
            }
            throw exception;
        }
    }

    @PostConstruct
    void initMetrics() {
        successCounter = Counter.builder("order.create.success.count").register(meterRegistry);
        failCounter = Counter.builder("order.create.fail.count").register(meterRegistry);
    }

    @Transactional
    public OrderDTO createOrder(CreateOrderRequest req) {
        // Idempotency check
        String idempotentKey = IDEMPOTENT_PREFIX + req.getOrderNo();
        Boolean acquired = redis.opsForValue().setIfAbsent(idempotentKey, "1", Duration.ofSeconds(300));
        if (!Boolean.TRUE.equals(acquired)) {
            // Already processing or processed — return existing
            return orderRepository.findByOrderNo(req.getOrderNo())
                    .map(this::toDTO)
                    .orElseThrow(() -> new BizException("PROCESSING", "Order is being processed"));
        }

        try {
            enrichQueryIfNeeded(req.getUserId());

            // 1. Validate user
            Map<String, Object> userResp = null;
            try {
                userResp = clients.getUser(req.getUserId());
            } catch (Exception e) {
                failCounter.increment();
                throw new BizException("USER_SERVICE_ERROR", "Failed to fetch user: " + e.getMessage());
            }
            Object userData = ((Map<?, ?>) userResp).get("data");
            if (userData instanceof Map<?, ?> user) {
                Object statusObj = user.get("status");
                Integer status = statusObj != null ? ((Number) statusObj).intValue() : 0;
                if (status != 1) {
                    failCounter.increment();
                    throw new BizException("USER_BANNED", "User is banned: " + req.getUserId());
                }
            }

            // 2. Validate product
            List<Map<String, Object>> products = null;
            try {
                products = clients.batchCatalog(List.of(req.getSku()));
            } catch (Exception e) {
                failCounter.increment();
                throw new BizException("CATALOG_SERVICE_ERROR", "Failed to fetch catalog: " + e.getMessage());
            }
            BigDecimal price = BigDecimal.ZERO;
            if (products != null && !products.isEmpty()) {
                Map<String, Object> product = products.get(0);
                Integer pStatus = ((Number) product.getOrDefault("status", -1)).intValue();
                if (pStatus != 1) {
                    failCounter.increment();
                    throw new BizException("PRODUCT_UNAVAILABLE", "Product not available: " + req.getSku());
                }
                price = new BigDecimal(product.get("price").toString());
            }
            BigDecimal amount = price.multiply(BigDecimal.valueOf(req.getQty()));

            // 3. Reserve inventory
            String tempOrderId = UUID.randomUUID().toString();
            try {
                clients.reserveInventory(tempOrderId, req.getSku(), req.getQty());
            } catch (Exception e) {
                failCounter.increment();
                throw new BizException("INVENTORY_ERROR", "Inventory reservation failed: " + e.getMessage());
            }

            // 4. Create order (PENDING)
            Order order = new Order();
            order.setOrderNo(req.getOrderNo());
            order.setUserId(req.getUserId());
            order.setSku(req.getSku());
            order.setQty(req.getQty());
            order.setAmount(amount);
            order.setStatus("PENDING");
            order.setTraceId(TraceContext.getTraceId());
            order.setCreatedAt(LocalDateTime.now());
            order.setUpdatedAt(LocalDateTime.now());
            order = orderRepository.save(order);

            // 5. Charge payment
            Map<String, Object> paymentResult;
            try {
                paymentResult = clients.charge(order.getId().toString(), req.getOrderNo(), req.getUserId(), amount);
            } catch (Exception e) {
                // Payment call failed → release inventory + mark FAILED
                try { clients.releaseInventory(tempOrderId, req.getSku(), req.getQty()); } catch (Exception ignored) {}
                order.setStatus("FAILED");
                order.setFailReason("Payment service error: " + e.getMessage());
                order.setUpdatedAt(LocalDateTime.now());
                orderRepository.save(order);
                failCounter.increment();
                return toDTO(order);
            }

            String paymentStatus = (String) paymentResult.getOrDefault("status", "FAILED");
            String paymentNo = (String) paymentResult.get("paymentNo");

            if ("SUCCESS".equals(paymentStatus)) {
                order.setStatus("PAID");
                order.setPaymentId(paymentNo);
                successCounter.increment();
            } else {
                // Release inventory on payment failure
                try { clients.releaseInventory(tempOrderId, req.getSku(), req.getQty()); } catch (Exception ignored) {}
                order.setStatus("FAILED");
                order.setFailReason("Payment failed: " + paymentResult.getOrDefault("resultCode", "UNKNOWN"));
                order.setPaymentId(paymentNo);
                failCounter.increment();
            }
            order.setUpdatedAt(LocalDateTime.now());
            orderRepository.save(order);
            OrderDTO result = toDTO(order);
            localQueryCacheManager.cacheIfNeeded("order:" + order.getOrderNo(), result);
            return result;

        } finally {
            // Remove idempotency lock on terminal state so caller can see result
        }
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
        try {
            clients.releaseInventory(order.getId().toString(), order.getSku(), order.getQty());
        } catch (Exception e) {
            log.warn("Failed to release inventory during cancel: {}", e.getMessage());
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
        Order order = orderRepository.findByOrderNo(request.getOrderNo())
                .orElseThrow(() -> new BizException("ORDER_NOT_FOUND", "Order not found: " + request.getOrderNo()));
        if ("PAID".equals(order.getStatus()) || "PAYMENT_FAILED".equals(order.getStatus())) {
            return toDTO(order);
        }
        String status = "SUCCESS".equals(request.getStatus()) ? "PAID" : "PAYMENT_FAILED";
        String reason = "SUCCESS".equals(request.getStatus()) ? null : request.getResultCode();
        if (orderRepository.applyPaymentResult(order.getOrderNo(), order.getVersion(), status,
                request.getPaymentNo(), reason) == 0) {
            throw new BizException("ORDER_STATE_CONFLICT", "Payment result lost order state race");
        }
        order.setStatus(status);
        order.setPaymentId(request.getPaymentNo());
        order.setFailReason(reason);
        order.setVersion(order.getVersion() + 1);
        return toDTO(order);
    }

    private OrderDTO cancelOrder(Order order) {
        if (!"PENDING".equals(order.getStatus()) && !"PENDING_PAYMENT".equals(order.getStatus())) {
            throw new BizException("INVALID_STATUS", "Can only cancel PENDING orders");
        }
        try {
            clients.releaseInventory(order.getId().toString(), order.getSku(), order.getQty());
        } catch (Exception e) {
            log.warn("Failed to release inventory during cancel: {}", e.getMessage());
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
                    " JOIN product_price_history pph ON CONCAT(pph.sku, '') = o.sku" +
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
        dto.setSku(o.getSku());
        dto.setQty(o.getQty());
        dto.setAmount(o.getAmount());
        dto.setStatus(o.getStatus());
        dto.setPaymentId(o.getPaymentId());
        dto.setFailReason(o.getFailReason());
        return dto;
    }
}
