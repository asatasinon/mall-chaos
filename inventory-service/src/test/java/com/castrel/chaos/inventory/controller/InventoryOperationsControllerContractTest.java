package com.castrel.chaos.inventory.controller;

import com.castrel.chaos.common.coordination.OperationRunContext;
import com.castrel.chaos.common.coordination.OperationRunGuard;
import com.castrel.chaos.inventory.service.InventoryAvailabilityService;
import com.castrel.chaos.inventory.service.InventoryReservationService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpHeaders;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Arrays;
import java.util.HashSet;
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

    private static final String EXPECTED_INPUT_PROPERTY = "scenario.contract.expected";
    private static final String CHECKS_DIRECTORY_PROPERTY = "scenario.contract.checksDir";
    private static final String SOURCE_COMMIT_PROPERTY = "scenario.contract.sourceCommitSha";
    private static final String CHECK_ID = "inventory-service.scenario-targets";
    private static final String SERVICE = "inventory-service";
    private static final String CHECK_SCHEMA = "scenario-contract-check-result.v1";
    private static final String CLEANUP_SUFFIX = "/remove";
    private static final Map<String, String> OPERATION_ROUTE_BASES = Map.of(
            "inventory-availability-report", "/internal/inventory/availability",
            "inventory-reservation-summary", "/internal/inventory/reservations");
    private static final String RUN_ID = "123e4567-e89b-12d3-a456-426614174000";
    private final ObjectMapper objectMapper = new ObjectMapper();

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
    void matchesCatalogTargetOperationsToControllerRoutesAndWritesCheckResult() throws IOException {
        String expectedInputPath = System.getProperty(EXPECTED_INPUT_PROPERTY);
        String checksDirectory = System.getProperty(CHECKS_DIRECTORY_PROPERTY);
        Assumptions.assumeTrue(expectedInputPath != null && !expectedInputPath.isBlank()
                        && checksDirectory != null && !checksDirectory.isBlank(),
                "The root Scenario Contract gate provides expected input and checks directory");
        String sourceCommitSha = System.getProperty(SOURCE_COMMIT_PROPERTY);
        assertThat(sourceCommitSha).matches("(?i)([a-f0-9]{40}|[a-f0-9]{64})");

        JsonNode root = objectMapper.readTree(Path.of(expectedInputPath).toFile());
        assertThat(root.path("schemaVersion").asText()).isEqualTo("scenario-contract-gateway.v1");
        String catalogRevision = requiredText(root, "catalogRevision");
        assertThat(catalogRevision).matches("[a-f0-9]{64}");

        JsonNode operations = root.path("operations");
        assertThat(operations.isArray()).isTrue();
        Set<String> expectedOperations = new HashSet<>();
        Set<String> requiredRoutes = new HashSet<>();
        for (JsonNode operation : operations) {
            if (!SERVICE.equals(operation.path("service").asText())) continue;
            String operationName = requiredText(operation, "operation");
            String routeBase = OPERATION_ROUTE_BASES.get(operationName);
            assertThat(routeBase).as("Catalog operation %s", operationName).isNotNull();
            assertThat(expectedOperations.add(operationName)).isTrue();
            assertThat(requiredText(operation, "targetPrepare")).isEqualTo("REQUIRED");
            requiredRoutes.add(routeBase + "/prepare");

            String releasePolicy = requiredText(operation, "targetRelease");
            assertThat(releasePolicy).isIn("REQUIRED", "FORBIDDEN", "NOT_APPLICABLE");
            if ("REQUIRED".equals(releasePolicy)) requiredRoutes.add(routeBase + "/release");

            String cleanupPolicy = requiredText(operation, "cleanup");
            assertThat(cleanupPolicy).isIn("NONE", "OPTIONAL_PER_RUN", "OPERATOR_CONFIRMED");
            if (!"NONE".equals(cleanupPolicy)) requiredRoutes.add(routeBase + CLEANUP_SUFFIX);
        }
        assertThat(expectedOperations).containsExactlyInAnyOrderElementsOf(OPERATION_ROUTE_BASES.keySet());
        Set<String> actualRoutes = new HashSet<>(postRoutes(InventoryAvailabilityController.class));
        actualRoutes.addAll(postRoutes(InventoryReservationController.class));
        assertThat(actualRoutes).containsAll(requiredRoutes);

        Path checksPath = Path.of(checksDirectory);
        Files.createDirectories(checksPath);
        ObjectNode result = objectMapper.createObjectNode();
        result.put("schemaVersion", CHECK_SCHEMA);
        result.put("checkId", CHECK_ID);
        result.put("status", "PASSED");
        result.put("catalogRevision", catalogRevision);
        result.put("operationCount", expectedOperations.size());
        result.put("sourceCommitSha", sourceCommitSha);
        objectMapper.writeValue(checksPath.resolve(CHECK_ID + ".json").toFile(), result);
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

    private static String requiredText(JsonNode object, String field) {
        String value = object.path(field).asText();
        assertThat(value).as("field %s", field).isNotBlank();
        return value;
    }
}
