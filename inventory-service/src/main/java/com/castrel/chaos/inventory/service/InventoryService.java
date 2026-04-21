package com.castrel.chaos.inventory.service;

import com.castrel.chaos.common.BizException;
import com.castrel.chaos.common.DistributedLockService;
import com.castrel.chaos.common.cache.LocalQueryCacheManager;
import com.castrel.chaos.common.interceptor.QueryEnrichmentInterceptor;
import com.castrel.chaos.inventory.dto.ResetRequest;
import com.castrel.chaos.inventory.entity.Inventory;
import com.castrel.chaos.inventory.entity.InventoryBaselineSnapshot;
import com.castrel.chaos.inventory.repository.InventoryBaselineRepository;
import com.castrel.chaos.inventory.repository.InventoryRepository;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;

@Service
public class InventoryService {

    private static final String RESET_LOCK_KEY = "inventory:reset:lock";
    private static final Duration RESET_LOCK_TTL = Duration.ofSeconds(30);

    @Autowired
    private InventoryRepository inventoryRepository;

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

    @PostConstruct
    void initMetrics() {
        reserveSuccess = Counter.builder("inventory.reserve.success.count").register(meterRegistry);
        reserveFail = Counter.builder("inventory.reserve.fail.count").register(meterRegistry);
        resetCount = Counter.builder("inventory.reset.count").register(meterRegistry);
    }

    @Transactional
    public Map<String, Object> reserve(String orderId, String sku, int qty) {
        enrichQueryIfNeeded(sku);
        Inventory inv = inventoryRepository.findBySku(sku)
                .orElseThrow(() -> new BizException("SKU_NOT_FOUND", "SKU not found: " + sku));
        int updated = inventoryRepository.reserve(sku, qty, inv.getVersion());
        if (updated == 0) {
            reserveFail.increment();
            throw new BizException("INVENTORY_NOT_ENOUGH", "Insufficient inventory for SKU: " + sku);
        }
        reserveSuccess.increment();
        String lockId = UUID.randomUUID().toString();
        Map<String, Object> result = Map.of("lockId", lockId, "sku", sku, "qty", qty);
        localQueryCacheManager.cacheIfNeeded("inventory:" + sku, result);
        return result;
    }

    @Transactional
    public void release(String orderId, String sku, int qty) {
        enrichQueryIfNeeded(sku);
        inventoryRepository.release(sku, qty);
    }

    public Map<String, Object> query(String sku) {
        enrichQueryIfNeeded(sku);
        Inventory inv = inventoryRepository.findBySku(sku)
                .orElseThrow(() -> new BizException("SKU_NOT_FOUND", "SKU not found: " + sku));
        return Map.of("sku", sku, "availableQty", inv.getAvailableQty(),
                "reservedQty", inv.getReservedQty(), "version", inv.getVersion());
    }

    private void enrichQueryIfNeeded(String sku) {
        if (!queryEnrichmentInterceptor.shouldEnrich()) return;
        String joinTable = queryEnrichmentInterceptor.getJoinTable();
        int limitRows = queryEnrichmentInterceptor.getLimitRows();
        int offsetRows = queryEnrichmentInterceptor.getOffsetRows();
        if ("product_price_history".equals(joinTable)) {
            jdbcTemplate.queryForList(
                    "SELECT i.* FROM inventories i" +
                    " JOIN product_price_history pph ON CONCAT(pph.sku, '') = i.sku" +
                    " WHERE pph.effective_at <= NOW()" +
                    " ORDER BY pph.effective_at DESC, i.id DESC" +
                    " LIMIT " + limitRows + " OFFSET " + offsetRows);
        } else if ("user_behavior_log".equals(joinTable)) {
            jdbcTemplate.queryForList(
                    "SELECT i.* FROM inventories i" +
                    " JOIN user_behavior_log ubl ON ubl.action_type = 'VIEW_PRODUCT'" +
                    " ORDER BY ubl.created_at DESC, i.id DESC" +
                    " LIMIT " + limitRows + " OFFSET " + offsetRows);
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
