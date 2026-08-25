package com.castrel.chaos.inventory.service;

import com.castrel.chaos.inventory.config.DemoInventoryBaselineProperties;
import com.castrel.chaos.inventory.entity.Inventory;
import com.castrel.chaos.inventory.repository.InventoryRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class InventoryServiceContractTest {

    @Mock
    private InventoryRepository inventoryRepository;

    @Mock
    private JdbcTemplate jdbcTemplate;

    @InjectMocks
    private InventoryService inventoryService;

    private DemoInventoryBaselineProperties properties;

    @BeforeEach
    void setUp() {
        properties = new DemoInventoryBaselineProperties();
        properties.setSkus(List.of("SKU-001"));
        properties.setTargetAvailableQty(100);
        ReflectionTestUtils.setField(inventoryService, "demoInventoryBaselineProperties", properties);
    }

    @Test
    void replenishesAvailableQuantityWithoutChangingReservedQuantity() {
        stubJdbcUpdates(1);
        Inventory inventory = inventory("SKU-001", 40, 12, 7);
        when(inventoryRepository.findBySku("SKU-001")).thenReturn(Optional.of(inventory));
        when(inventoryRepository.replenishToTarget("SKU-001", 100, 7)).thenReturn(1);

        var result = inventoryService.replenishDemoInventory();

        assertThat(result.skuCount()).isEqualTo(1);
        assertThat(result.addedQuantity()).isEqualTo(60);
        assertThat(result.skippedCount()).isZero();
        assertThat(result.failedCount()).isZero();
        assertThat(inventory.getReservedQty()).isEqualTo(12);
        verify(inventoryRepository).replenishToTarget("SKU-001", 100, 7);
    }

    @Test
    void skipsDuplicateWindowWithoutReadingOrWritingInventory() {
        stubJdbcUpdates(0);

        var result = inventoryService.replenishDemoInventory();

        assertThat(result.addedQuantity()).isZero();
        assertThat(result.skippedCount()).isEqualTo(1);
        verify(inventoryRepository, never()).findBySku(anyString());
        verify(inventoryRepository, never()).replenishToTarget(anyString(), anyInt(), anyInt());
    }

    @Test
    void reportsUnknownConfiguredSkuAsFailure() {
        stubJdbcUpdates(1);
        when(inventoryRepository.findBySku("SKU-001")).thenReturn(Optional.empty());

        var result = inventoryService.replenishDemoInventory();

        assertThat(result.addedQuantity()).isZero();
        assertThat(result.failedCount()).isEqualTo(1);
        verify(inventoryRepository, never()).replenishToTarget(anyString(), anyInt(), anyInt());
    }

    private Inventory inventory(String sku, int available, int reserved, int version) {
        Inventory inventory = new Inventory();
        inventory.setSku(sku);
        inventory.setAvailableQty(available);
        inventory.setReservedQty(reserved);
        inventory.setVersion(version);
        return inventory;
    }

    private void stubJdbcUpdates(int batchInsertResult) {
        doAnswer(invocation -> {
            String sql = invocation.getArgument(0, String.class);
            return sql.contains("INSERT IGNORE") ? batchInsertResult : 1;
        }).when(jdbcTemplate).update(anyString(), any(Object[].class));
    }
}
