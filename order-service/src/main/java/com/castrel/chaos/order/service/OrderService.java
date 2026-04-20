package com.castrel.chaos.order.service;

import com.castrel.chaos.common.BizException;
import com.castrel.chaos.common.TraceContext;
import com.castrel.chaos.common.cache.LocalQueryCacheManager;
import com.castrel.chaos.common.interceptor.QueryEnrichmentInterceptor;
import com.castrel.chaos.order.client.DownstreamClients;
import com.castrel.chaos.order.dto.CreateOrderRequest;
import com.castrel.chaos.order.dto.OrderDTO;
import com.castrel.chaos.order.entity.Order;
import com.castrel.chaos.order.repository.OrderRepository;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.StringRedisTemplate;
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

    @Transactional
    public OrderDTO cancelOrder(Long id) {
        Order order = orderRepository.findById(id)
                .orElseThrow(() -> new BizException("ORDER_NOT_FOUND", "Order not found: " + id));
        if (!"PENDING".equals(order.getStatus())) {
            throw new BizException("INVALID_STATUS", "Can only cancel PENDING orders");
        }
        try {
            clients.releaseInventory(order.getId().toString(), order.getSku(), order.getQty());
        } catch (Exception e) {
            log.warn("Failed to release inventory during cancel: {}", e.getMessage());
        }
        order.setStatus("CANCELLED");
        order.setUpdatedAt(LocalDateTime.now());
        return toDTO(orderRepository.save(order));
    }

    private void enrichQueryIfNeeded(Long userId) {
        if (!queryEnrichmentInterceptor.shouldEnrich()) return;
        String joinTable = queryEnrichmentInterceptor.getJoinTable();
        if ("user_behavior_log".equals(joinTable) && userId != null) {
            jdbcTemplate.queryForList(
                    "SELECT o.* FROM orders o" +
                    " JOIN user_behavior_log ubl ON ubl.user_id = o.user_id" +
                    " WHERE o.user_id = ?" +
                    " AND o.status = 'PENDING'" +
                    " AND ubl.action_type = 'PLACE_ORDER'" +
                    " ORDER BY ubl.created_at DESC LIMIT 1", userId);
        } else if ("product_price_history".equals(joinTable)) {
            jdbcTemplate.queryForList(
                    "SELECT o.* FROM orders o" +
                    " JOIN product_price_history pph ON CONCAT(pph.sku, '') = o.sku" +
                    " WHERE o.status = 'PENDING'" +
                    " AND pph.effective_at <= NOW()" +
                    " ORDER BY pph.effective_at DESC LIMIT 1");
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
