package com.castrel.chaos.inventory.controller;

import com.castrel.chaos.common.coordination.OperationRunContext;
import com.castrel.chaos.common.coordination.OperationRunGuard;
import com.castrel.chaos.inventory.service.InventoryAvailabilityService;
import com.castrel.chaos.inventory.service.InventoryReservationService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpHeaders;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;

import java.time.Instant;
import java.util.Arrays;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;
import javax.sql.DataSource;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class InventoryOperationsControllerContractTest {

    private static final String RUN_ID = "123e4567-e89b-12d3-a456-426614174000";

    @Mock
    private InventoryAvailabilityService availabilityService;

    @Mock
    private InventoryReservationService reservationService;

    private InventoryAvailabilityController availabilityController;
    private InventoryReservationController reservationController;

    @BeforeEach
    void setUp() {
        availabilityController = new InventoryAvailabilityController(availabilityService);
        reservationController = new InventoryReservationController(reservationService);
    }

    @Test
    void exposesBothInventoryOperationLifecycleRoutes() {
        assertThat(postRoutes(InventoryAvailabilityController.class)).contains(
                "/internal/inventory/availability/prepare",
                "/internal/inventory/availability/release",
                "/internal/inventory/availability/remove");
        assertThat(postRoutes(InventoryReservationController.class)).contains(
                "/internal/inventory/reservations/prepare",
                "/internal/inventory/reservations/release",
                "/internal/inventory/reservations/remove");
    }

    @Test
    void forwardsFullLifecycleContextAndMinimalCleanupContext() {
        HttpHeaders fullHeaders = fullContext();
        HttpHeaders cleanupHeaders = cleanupContext();
        OperationRunContext fullContext = OperationRunContext.fromHeaders(fullHeaders);
        OperationRunContext cleanupContext = OperationRunContext.fromHeaders(cleanupHeaders);
        when(availabilityService.remove(cleanupContext)).thenReturn(Map.of("released", true));
        when(reservationService.remove(cleanupContext)).thenReturn(Map.of("released", true));

        var availabilityPrepare = availabilityController.prepare(fullHeaders);
        var availabilityRelease = availabilityController.release(fullHeaders);
        var availabilityCleanup = availabilityController.remove(cleanupHeaders);
        var reservationPrepare = reservationController.prepare(fullHeaders);
        var reservationRelease = reservationController.release(fullHeaders);
        var reservationCleanup = reservationController.remove(cleanupHeaders);

        assertEnvelope(availabilityPrepare.getCode(), availabilityPrepare.getMessage());
        assertThat(availabilityPrepare.getData()).containsEntry("accepted", true)
                .containsEntry("operation", "inventory-availability-report");
        assertEnvelope(availabilityRelease.getCode(), availabilityRelease.getMessage());
        assertThat(availabilityRelease.getData()).containsEntry("released", true).containsEntry("runId", RUN_ID);
        assertEnvelope(availabilityCleanup.getCode(), availabilityCleanup.getMessage());
        assertThat(availabilityCleanup.getData()).containsEntry("released", true);

        assertEnvelope(reservationPrepare.getCode(), reservationPrepare.getMessage());
        assertThat(reservationPrepare.getData()).containsEntry("accepted", true)
                .containsEntry("operation", "inventory-reservation-summary");
        assertEnvelope(reservationRelease.getCode(), reservationRelease.getMessage());
        assertThat(reservationRelease.getData()).containsEntry("released", true).containsEntry("runId", RUN_ID);
        assertEnvelope(reservationCleanup.getCode(), reservationCleanup.getMessage());
        assertThat(reservationCleanup.getData()).containsEntry("released", true);

        verify(availabilityService).prepare(fullContext);
        verify(availabilityService).release(fullContext);
        verify(availabilityService).remove(cleanupContext);
        verify(reservationService).prepare(fullContext);
        verify(reservationService).release(fullContext);
        verify(reservationService).remove(cleanupContext);
    }

    @Test
    void realCleanupHandlersAcceptMinimalContextAndRejectMissingFence() {
        OperationRunGuard guard = mock(OperationRunGuard.class);
        var realAvailability = new InventoryAvailabilityController(
                new InventoryAvailabilityService(mock(DataSource.class),
                        mock(org.springframework.jdbc.core.JdbcTemplate.class), guard));
        var realReservations = new InventoryReservationController(
                new InventoryReservationService(mock(DataSource.class), guard));
        HttpHeaders cleanupHeaders = cleanupContext();
        OperationRunContext cleanupContext = OperationRunContext.fromHeaders(cleanupHeaders);

        var availabilityCleanup = realAvailability.remove(cleanupHeaders);
        var reservationCleanup = realReservations.remove(cleanupHeaders);

        assertEnvelope(availabilityCleanup.getCode(), availabilityCleanup.getMessage());
        assertThat(availabilityCleanup.getData()).containsEntry("released", true);
        assertEnvelope(reservationCleanup.getCode(), reservationCleanup.getMessage());
        assertThat(reservationCleanup.getData()).containsEntry("released", true);
        verify(guard, times(2)).release(cleanupContext);

        HttpHeaders invalidContext = new HttpHeaders();
        invalidContext.set("X-Operation-Run-Id", RUN_ID);
        assertThatThrownBy(() -> realAvailability.remove(invalidContext))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Invalid operation cleanup context");
        assertThatThrownBy(() -> realReservations.remove(invalidContext))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Invalid operation cleanup context");
        verifyNoMoreInteractions(guard);
    }

    private static HttpHeaders fullContext() {
        HttpHeaders headers = cleanupContext();
        headers.set("X-Operation-Run-Expires-At", Instant.now().plusSeconds(600).toString());
        headers.set("X-Operation-Run-Idempotency-Key", "phase-three-inventory-001");
        return headers;
    }

    private static HttpHeaders cleanupContext() {
        HttpHeaders headers = new HttpHeaders();
        headers.set("X-Operation-Run-Id", RUN_ID);
        headers.set("X-Operation-Run-Fencing-Token", "7");
        return headers;
    }

    private static Set<String> postRoutes(Class<?> controllerType) {
        RequestMapping classMapping = controllerType.getAnnotation(RequestMapping.class);
        String prefix = classMapping == null || classMapping.value().length == 0
                ? "" : classMapping.value()[0];
        return Arrays.stream(controllerType.getDeclaredMethods())
                .map(method -> method.getAnnotation(PostMapping.class))
                .filter(Objects::nonNull)
                .flatMap(mapping -> Arrays.stream(mapping.value()))
                .map(path -> prefix + path)
                .collect(Collectors.toSet());
    }

    private static void assertEnvelope(int code, String message) {
        assertThat(code).isEqualTo(200);
        assertThat(message).isEqualTo("OK");
    }
}
