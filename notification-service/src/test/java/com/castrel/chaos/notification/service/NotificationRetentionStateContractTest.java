package com.castrel.chaos.notification.service;

import com.castrel.chaos.common.BizException;
import com.castrel.chaos.common.coordination.OperationRunContext;
import com.castrel.chaos.common.coordination.OperationRunGuard;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class NotificationRetentionStateContractTest {

    private static final long MIN_FREE_BYTES = 1024L * 1024;
    private static final long MAX_FREE_BYTES = 1024L * 1024 * 1024;
    private static final long TOTAL_BYTES = 2L * 1024 * 1024 * 1024;

    @Mock
    private NotificationStorageGrowthWriter storageWriter;

    @Mock
    private OperationRunGuard runGuard;

    @BeforeEach
    void setUp() {
        lenient().when(runGuard.acceptStart(any())).thenReturn(true);
        lenient().when(runGuard.isAccepted(any())).thenReturn(true);
        lenient().when(storageWriter.append(anyString(), anyLong(), anyLong(), anyLong())).thenReturn(4096L);
    }

    @Test
    void acceptsTheCataloguedMinimumReserveAtBothInclusiveBounds() {
        assertAcceptedReserve(MIN_FREE_BYTES);
        assertAcceptedReserve(MAX_FREE_BYTES);
    }

    @Test
    void rejectsReserveValuesOutsideTheCataloguedRangeAndFractionalBytes() {
        for (Number invalidValue : List.of(MIN_FREE_BYTES - 1, MAX_FREE_BYTES + 1, MIN_FREE_BYTES + 0.5)) {
            NotificationRetentionState state = new NotificationRetentionState(storageWriter);
            OperationRunContext context = context();
            Map<String, Object> parameters = storageParameters(invalidValue);

            assertThatThrownBy(() -> state.prepareStorage(context, parameters, runGuard))
                    .isInstanceOf(BizException.class)
                    .extracting("errorCode")
                    .isEqualTo("INVALID_NOTIFICATION_PARAMETER");
            verify(storageWriter, never()).prepare(context.runId());
        }
    }

    @Test
    void storageCleanupAcceptsOnlyRunIdAndFencingToken() {
        NotificationRetentionState state = new NotificationRetentionState(storageWriter);
        OperationRunContext activeContext = context();
        state.prepareStorage(activeContext, storageParameters(MIN_FREE_BYTES), runGuard);
        OperationRunContext cleanupContext = new OperationRunContext(
                activeContext.runId(), null, activeContext.fencingToken(), null);
        when(storageWriter.delete(activeContext.runId())).thenReturn(4096L);

        long deletedBytes = state.cleanupStorage(cleanupContext, runGuard);

        assertThat(deletedBytes).isEqualTo(4096L);
        verify(runGuard).release(cleanupContext);
        verify(storageWriter).delete(activeContext.runId());
    }

    @Test
    void retentionCleanupAcceptsOnlyRunIdAndFencingToken() {
        NotificationRetentionState state = new NotificationRetentionState(storageWriter);
        OperationRunContext activeContext = context();
        state.prepareRetention(activeContext, Map.of(), runGuard);
        OperationRunContext cleanupContext = new OperationRunContext(
                activeContext.runId(), null, activeContext.fencingToken(), null);

        state.cleanupRetention(cleanupContext, runGuard);

        assertThat(state.shouldRetain()).isFalse();
        verify(runGuard).release(cleanupContext);
    }

    private void assertAcceptedReserve(long minFreeBytes) {
        NotificationRetentionState state = new NotificationRetentionState(storageWriter);
        OperationRunContext context = context();

        state.prepareStorage(context, storageParameters(minFreeBytes), runGuard);
        long appendedBytes = state.appendStorage(context, runGuard);

        assertThat(appendedBytes).isEqualTo(4096L);
        verify(storageWriter).append(context.runId(), 4096L, TOTAL_BYTES, minFreeBytes);
    }

    private static Map<String, Object> storageParameters(Number minFreeBytes) {
        return Map.of(
                "requestIntervalMs", 0,
                "totalBytes", TOTAL_BYTES,
                "appendBytes", 4096L,
                "minFreeBytes", minFreeBytes);
    }

    private static OperationRunContext context() {
        return new OperationRunContext(
                UUID.randomUUID().toString(),
                Instant.now().plusSeconds(600),
                7,
                "phase-three-storage-001");
    }
}
