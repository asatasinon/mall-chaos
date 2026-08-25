package com.castrel.chaos.inventory.service;

import com.castrel.chaos.common.BizException;
import com.castrel.chaos.common.DistributedLockService;
import com.castrel.chaos.common.TraceContext;
import com.castrel.chaos.common.cache.LocalQueryCacheManager;
import com.castrel.chaos.common.interceptor.QueryEnrichmentInterceptor;
import com.castrel.chaos.inventory.config.DemoInventoryBaselineProperties;
import com.castrel.chaos.inventory.dto.DemoInventoryReplenishmentResult;
import com.castrel.chaos.inventory.dto.ResetRequest;
import com.castrel.chaos.inventory.entity.Inventory;
import com.castrel.chaos.inventory.entity.InventoryBaselineSnapshot;
import com.castrel.chaos.inventory.repository.InventoryBaselineRepository;
import com.castrel.chaos.inventory.repository.InventoryRepository;
import com.castrel.chaos.inventory.repository.InventoryReservationRepository;
import com.castrel.chaos.inventory.entity.InventoryReservation;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;

@Service
public class InventoryService {

    private static final String RESET_LOCK_KEY = "inventory:reset:lock";
    private static final Duration RESET_LOCK_TTL = Duration.ofSeconds(30);

    @Autowired
    private InventoryRepository inventoryRepository;

    @Autowired
    private DemoInventoryBaselineProperties demoInventoryBaselineProperties;

    @Autowired
    private InventoryReservationRepository reservationRepository;

    @Autowired
    private InventoryBaselineRepository baselineRepository;

    @Autowired
    private QueryEnrichmentInterceptor queryEnrichmentInterceptor;

    @Autowired
    private LocalQueryCacheManager localQueryCacheManager;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private DistributedLockService lockService;

    @Autowired
    private MeterRegistry meterRegistry;

    private Counter reserveSuccess;
    private Counter reserveFail;
    private Counter resetCount;
    private Counter reservationCounter;

    @PostConstruct
    void initMetrics() {
        reserveSuccess = Counter.builder("inventory.reserve.success.count").register(meterRegistry);
        reserveFail = Counter.builder("inventory.reserve.fail.count").register(meterRegistry);
        resetCount = Counter.builder("inventory.reset.count").register(meterRegistry);
        reservationCounter = Counter.builder("inventory_reservation_total").register(meterRegistry);
    }

    @Transactional
    public Map<String, Object> reserve(String orderId, String sku, int qty,
                                       String reservationId, String operationId) {
        reservationCounter.increment();
        if (qty <= 0 || reservationId == null || reservationId.isBlank()
                || operationId == null || operationId.isBlank()) {
            throw new BizException("INVALID_RESERVATION", "reservationId, operationId and positive qty are required");
        }
        InventoryReservation existing = reservationRepository.findByOperationIdAndSku(operationId, sku).orElse(null);
        if (existing != null) {
            if (!existing.getReservationId().equals(reservationId) || !existing.getOrderId().equals(orderId)) {
                throw new BizException("RESERVATION_CONFLICT", "Reservation operation already belongs to another order");
            }
            if ("RESERVED".equals(existing.getStatus()) || "CONFIRMED".equals(existing.getStatus())) {
                return Map.of("reservationId", existing.getReservationId(), "operationId", existing.getOperationId(),
                        "sku", sku, "qty", existing.getQuantity(), "status", existing.getStatus());
            }
            if ("RELEASED".equals(existing.getStatus()) || "EXPIRED".equals(existing.getStatus())) {
                throw new BizException("RESERVATION_NOT_RETRYABLE", "Reservation has already been released");
            }
        }
        enrichQueryIfNeeded(sku);
        Inventory inv = inventoryRepository.findBySku(sku)
                .orElseThrow(() -> new BizException("SKU_NOT_FOUND", "SKU not found: " + sku));
        int updated = inventoryRepository.reserve(sku, qty, inv.getVersion());
        if (updated == 0) {
            reserveFail.increment();
            throw new BizException("INVENTORY_NOT_ENOUGH", "Insufficient inventory for SKU: " + sku);
        }
        reserveSuccess.increment();
        InventoryReservation reservation = new InventoryReservation();
        reservation.setReservationId(reservationId);
        reservation.setOperationId(operationId);
        reservation.setOrderId(orderId);
        reservation.setSku(sku);
        reservation.setQuantity(qty);
        reservation.setStatus("RESERVED");
        reservation.setExpiresAt(LocalDateTime.now().plusMinutes(15));
        reservation.setCreatedAt(LocalDateTime.now());
        reservation.setUpdatedAt(LocalDateTime.now());
        reservationRepository.save(reservation);
        Map<String, Object> result = Map.of("reservationId", reservationId, "operationId", operationId,
            "sku", sku, "qty", qty, "status", "RESERVED");
        localQueryCacheManager.cacheIfNeeded("inventory:" + sku, result);
        return result;
    }

    @Transactional
    public void release(String orderId, String sku, String reservationId, String operationId) {
        if (reservationId == null || operationId == null || operationId.isBlank()) {
            throw new BizException("INVALID_RESERVATION", "reservationId and operationId are required");
        }
        InventoryReservation operation = reservationRepository.findByOperationIdAndSku(operationId, sku)
                .orElseThrow(() -> new BizException("RESERVATION_NOT_FOUND", "Reservation not found"));
        if (!operation.getReservationId().equals(reservationId)) {
            throw new BizException("RESERVATION_NOT_FOUND", "Reservation not found");
        }
        InventoryReservation reservation = reservationRepository.findByReservationIdAndSku(reservationId, sku)
                .orElseThrow(() -> new BizException("RESERVATION_NOT_FOUND", "Reservation not found"));
        if (!reservation.getOrderId().equals(orderId)) {
            throw new BizException("RESERVATION_NOT_FOUND", "Reservation not found");
        }
        if (!"RESERVED".equals(reservation.getStatus())) return;
        enrichQueryIfNeeded(sku);
        inventoryRepository.release(sku, reservation.getQuantity());
        reservation.setStatus("RELEASED");
        reservation.setUpdatedAt(LocalDateTime.now());
        reservationRepository.save(reservation);
    }

    @Transactional
    public void confirm(String orderId, String sku, String reservationId, String operationId) {
        InventoryReservation operation = reservationRepository.findByOperationIdAndSku(operationId, sku)
                .orElseThrow(() -> new BizException("RESERVATION_NOT_FOUND", "Reservation not found"));
        if (!operation.getReservationId().equals(reservationId)) {
            throw new BizException("RESERVATION_NOT_FOUND", "Reservation not found");
        }
        InventoryReservation reservation = reservationRepository.findByReservationIdAndSku(reservationId, sku)
                .orElseThrow(() -> new BizException("RESERVATION_NOT_FOUND", "Reservation not found"));
        if (!reservation.getOrderId().equals(orderId)) {
            throw new BizException("RESERVATION_NOT_FOUND", "Reservation not found");
        }
        if ("RESERVED".equals(reservation.getStatus())) {
            reservation.setStatus("CONFIRMED");
            reservation.setUpdatedAt(LocalDateTime.now());
            reservationRepository.save(reservation);
        }
    }

    @Transactional
    public void expire(String reservationId, String sku, String operationId) {
        InventoryReservation operation = reservationRepository.findByOperationIdAndSku(operationId, sku)
                .orElseThrow(() -> new BizException("RESERVATION_NOT_FOUND", "Reservation not found"));
        if (!operation.getReservationId().equals(reservationId)) {
            throw new BizException("RESERVATION_NOT_FOUND", "Reservation not found");
        }
        InventoryReservation reservation = reservationRepository.findByReservationIdAndSku(reservationId, sku)
                .orElseThrow(() -> new BizException("RESERVATION_NOT_FOUND", "Reservation not found"));
        if (!"RESERVED".equals(reservation.getStatus())) return;
        if (reservation.getExpiresAt() != null && reservation.getExpiresAt().isAfter(LocalDateTime.now())) {
            throw new BizException("RESERVATION_NOT_EXPIRED", "Reservation has not expired");
        }
        inventoryRepository.release(sku, reservation.getQuantity());
        reservation.setStatus("EXPIRED");
        reservation.setUpdatedAt(LocalDateTime.now());
        reservationRepository.save(reservation);
    }

    public Map<String, Object> query(String sku) {
        enrichQueryIfNeeded(sku);
        Inventory inv = inventoryRepository.findBySku(sku)
                .orElseThrow(() -> new BizException("SKU_NOT_FOUND", "SKU not found: " + sku));
        return Map.of("sku", sku, "availableQty", inv.getAvailableQty(),
                "reservedQty", inv.getReservedQty(), "version", inv.getVersion());
    }

    @Transactional
    public DemoInventoryReplenishmentResult replenishDemoInventory() {
        validateDemoInventoryConfiguration();
        String windowId = currentReplenishmentWindowId();
        String correlationId = TraceContext.getTraceId() == null
                ? "stock-replenish-" + windowId : TraceContext.getTraceId();
        LocalDateTime startedAt = LocalDateTime.now();
        writeReplenishmentRun(windowId, correlationId, "RUNNING", startedAt, null, 0, "started");

        int addedQuantity = 0;
        int skippedCount = 0;
        int failedCount = 0;
        try {
            if (!demoInventoryBaselineProperties.isEnabled()) {
                DemoInventoryReplenishmentResult disabled = new DemoInventoryReplenishmentResult(
                        windowId, correlationId, demoInventoryBaselineProperties.getSkus().size(),
                        0, 0, 0);
                writeReplenishmentRun(windowId, correlationId, "COMPLETED", startedAt,
                        LocalDateTime.now(), 0, "disabled");
                return disabled;
            }

            LocalDateTime now = LocalDateTime.now();
            for (String sku : demoInventoryBaselineProperties.getSkus()) {
                if (!claimReplenishmentBatch(windowId, sku, now)) {
                    skippedCount++;
                    continue;
                }
                Inventory inventory = inventoryRepository.findBySku(sku).orElse(null);
                if (inventory == null) {
                    failedCount++;
                    markReplenishmentBatch(windowId, sku, "FAILED", now);
                    continue;
                }
                int currentAvailable = inventory.getAvailableQty() == null ? 0 : inventory.getAvailableQty();
                if (currentAvailable >= demoInventoryBaselineProperties.getTargetAvailableQty()) {
                    skippedCount++;
                    markReplenishmentBatch(windowId, sku, "COMPLETED", now);
                    continue;
                }
                int missing = demoInventoryBaselineProperties.getTargetAvailableQty() - currentAvailable;
                int updated = inventoryRepository.replenishToTarget(
                        sku, demoInventoryBaselineProperties.getTargetAvailableQty(), inventory.getVersion());
                if (updated != 1) {
                    failedCount++;
                    markReplenishmentBatch(windowId, sku, "FAILED", now);
                    continue;
                }
                addedQuantity += missing;
                markReplenishmentBatch(windowId, sku, "COMPLETED", now);
            }

            DemoInventoryReplenishmentResult result = new DemoInventoryReplenishmentResult(
                    windowId, correlationId, demoInventoryBaselineProperties.getSkus().size(),
                    addedQuantity, skippedCount, failedCount);
            writeReplenishmentRun(windowId, correlationId, "COMPLETED", startedAt,
                    LocalDateTime.now(), 0, replenishmentSummary(result));
            return result;
        } catch (RuntimeException exception) {
            writeReplenishmentRun(windowId, correlationId, "FAILED", startedAt,
                    LocalDateTime.now(), 0, "failed");
            throw exception;
        }
    }

    private boolean claimReplenishmentBatch(String windowId, String sku, LocalDateTime now) {
        return jdbcTemplate.update(
                "INSERT IGNORE INTO inventory_replenishment_batches "
                        + "(window_id, sku, status, created_at, updated_at) "
                        + "VALUES (?, ?, 'RUNNING', ?, ?)",
                windowId, sku, now, now) == 1;
    }

    private void markReplenishmentBatch(String windowId, String sku, String status, LocalDateTime now) {
        jdbcTemplate.update(
                "UPDATE inventory_replenishment_batches SET status = ?, updated_at = ? "
                        + "WHERE window_id = ? AND sku = ?",
                status, now, windowId, sku);
    }

    private void validateDemoInventoryConfiguration() {
        if (demoInventoryBaselineProperties.getSkus() == null
                || demoInventoryBaselineProperties.getSkus().isEmpty()
                || demoInventoryBaselineProperties.getSkus().stream()
                    .anyMatch(sku -> sku == null || sku.isBlank())
                || demoInventoryBaselineProperties.getTargetAvailableQty() < 1) {
            throw new BizException("DEMO_INVENTORY_CONFIG_INVALID",
                    "Demo inventory baseline configuration is invalid");
        }
    }

    private String currentReplenishmentWindowId() {
        return "UTC-6H-" + Instant.now().getEpochSecond() / (6 * 60 * 60);
    }

    private void writeReplenishmentRun(
            String windowId, String correlationId, String status, LocalDateTime startedAt,
            LocalDateTime completedAt, int retryCount, String resultSummary) {
        jdbcTemplate.update(
                "INSERT INTO traffic_replenishment_runs "
                        + "(window_id, operation_type, status, started_at, completed_at, retry_count, "
                        + "result_summary, correlation_id) VALUES (?, 'DEMO_STOCK_REPLENISH', ?, ?, ?, ?, ?, ?) "
                        + "ON DUPLICATE KEY UPDATE status = VALUES(status), completed_at = VALUES(completed_at), "
                        + "retry_count = VALUES(retry_count), result_summary = VALUES(result_summary), "
                        + "correlation_id = VALUES(correlation_id)",
                windowId, status, startedAt, completedAt, retryCount, resultSummary, correlationId);
    }

    private String replenishmentSummary(DemoInventoryReplenishmentResult result) {
        return "skus=" + result.skuCount() + ",added=" + result.addedQuantity()
                + ",skipped=" + result.skippedCount() + ",failed=" + result.failedCount();
    }

    private void enrichQueryIfNeeded(String sku) {
        if (!queryEnrichmentInterceptor.shouldEnrich()) return;
        String joinTable = queryEnrichmentInterceptor.getJoinTable();
        int limitRows = queryEnrichmentInterceptor.getLimitRows();
        int offsetRows = queryEnrichmentInterceptor.getOffsetRows();
        if ("product_price_history".equals(joinTable)) {
            jdbcTemplate.queryForList(
                    "SELECT s.* FROM (" +
                    " SELECT i.*, pph.effective_at AS __pph_effective_at" +
                    " FROM inventories i" +
                    " JOIN product_price_history pph ON CONCAT(pph.sku, '') = i.sku" +
                    " ORDER BY pph.effective_at DESC, i.id DESC" +
                    " LIMIT " + limitRows + " OFFSET " + offsetRows +
                    ") s" +
                    " WHERE s.__pph_effective_at <= NOW()" +
                    " ORDER BY s.__pph_effective_at DESC, s.id DESC" +
                    " LIMIT " + limitRows);
        } else if ("user_behavior_log".equals(joinTable)) {
            jdbcTemplate.queryForList(
                    "SELECT s.* FROM (" +
                    " SELECT i.*, ubl.action_type AS __ubl_action_type, ubl.created_at AS __ubl_created_at" +
                    " FROM inventories i" +
                    " JOIN user_behavior_log ubl ON TRUE" +
                    " ORDER BY ubl.created_at DESC, i.id DESC" +
                    " LIMIT " + limitRows + " OFFSET " + offsetRows +
                    ") s" +
                    " WHERE s.__ubl_action_type = 'VIEW_PRODUCT'" +
                    " ORDER BY s.__ubl_created_at DESC, s.id DESC" +
                    " LIMIT " + limitRows);
        }
    }

    public List<Map<String, Object>> resetPlan() {
        List<Inventory> all = inventoryRepository.findAll();
        Map<String, Integer> baseline = baselineRepository.findAll().stream()
                .collect(Collectors.toMap(InventoryBaselineSnapshot::getSku,
                        InventoryBaselineSnapshot::getBaselineQty));
        return all.stream().map(inv -> {
            int base = baseline.getOrDefault(inv.getSku(), 0);
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("sku", inv.getSku());
            m.put("currentQty", inv.getAvailableQty());
            m.put("baselineQty", base);
            m.put("diff", base - inv.getAvailableQty());
            return m;
        }).collect(Collectors.toList());
    }

    @Transactional
    public Map<String, Object> reset(ResetRequest req) {
        List<InventoryBaselineSnapshot> baselines = baselineRepository.findAll();
        if (baselines.isEmpty()) {
            throw new BizException("BASELINE_EMPTY", "No baseline snapshot found");
        }
        int currentVersion = baselines.get(0).getBaselineVersion();
        if (currentVersion != req.getExpectedVersion()) {
            throw new BizException("VERSION_CONFLICT",
                    "Baseline version mismatch. expected=" + req.getExpectedVersion()
                    + " actual=" + currentVersion);
        }

        String lockToken = lockService.tryLock(RESET_LOCK_KEY, RESET_LOCK_TTL);
        if (lockToken == null) {
            throw new BizException("LOCK_FAILED", "Another reset is in progress");
        }
        try {
            Map<String, Integer> baselineMap = baselines.stream()
                    .collect(Collectors.toMap(InventoryBaselineSnapshot::getSku,
                            InventoryBaselineSnapshot::getBaselineQty));
            List<Inventory> targets = inventoryRepository.findAll();
            int resetCount = 0;
            for (Inventory inv : targets) {
                Integer baseQty = baselineMap.get(inv.getSku());
                if (baseQty != null) {
                    inv.setAvailableQty(baseQty);
                    inv.setReservedQty(0);
                    inv.setVersion(inv.getVersion() + 1);
                    inventoryRepository.save(inv);
                    resetCount++;
                }
            }
            this.resetCount.increment();
            return Map.of("resetCount", resetCount, "executedAt", Instant.now().toString());
        } finally {
            lockService.release(RESET_LOCK_KEY, lockToken);
        }
    }
}
