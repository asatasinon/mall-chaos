package com.castrel.chaos.notification.controller;

import com.castrel.chaos.common.coordination.OperationRunContext;
import com.castrel.chaos.common.coordination.OperationRunGuard;
import com.castrel.chaos.notification.repository.CustomerNotificationRepository;
import com.castrel.chaos.notification.service.NotificationRetentionState;
import com.castrel.chaos.notification.service.NotificationService;
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
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.bind.annotation.PostMapping;

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

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.times;

@ExtendWith(MockitoExtension.class)
class NotificationOperationControllerContractTest {

    private static final String EXPECTED_INPUT_PROPERTY = "scenario.contract.expected";
    private static final String CHECKS_DIRECTORY_PROPERTY = "scenario.contract.checksDir";
    private static final String SOURCE_COMMIT_PROPERTY = "scenario.contract.sourceCommitSha";
    private static final String CHECK_ID = "notification-service.scenario-targets";
    private static final String SERVICE = "notification-service";
    private static final String CHECK_SCHEMA = "scenario-contract-check-result.v1";
    private static final String CLEANUP_SUFFIX = "/cleanup";
    private static final Map<String, String> OPERATION_ROUTE_BASES = Map.of(
            "notification-retention", "/internal/notification/retention",
            "notification-storage", "/internal/notification/storage");
    private static final String RUN_ID = "123e4567-e89b-12d3-a456-426614174000";
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Mock
    private NotificationService notificationService;

    @Mock
    private NotificationRetentionState retentionState;

    @Mock
    private OperationRunGuard runGuard;

    @Mock
    private CustomerNotificationRepository customerNotificationRepository;

    private NotificationController controller;

    @BeforeEach
    void setUp() {
        controller = new NotificationController();
        ReflectionTestUtils.setField(controller, "notificationService", notificationService);
        ReflectionTestUtils.setField(controller, "objectMapper", objectMapper);
        ReflectionTestUtils.setField(controller, "retentionState", retentionState);
        ReflectionTestUtils.setField(controller, "runGuard", runGuard);
        ReflectionTestUtils.setField(controller, "customerNotificationRepository", customerNotificationRepository);
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
        assertThat(postRoutes(NotificationController.class)).containsAll(requiredRoutes);

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
    void exposesTheCataloguedRetentionAndStorageLifecycleRoutes() {
        assertThat(postRoutes(NotificationController.class)).contains(
                "/internal/notification/retention/prepare",
                "/internal/notification/retention/release",
                "/internal/notification/retention/cleanup",
                "/internal/notification/storage/prepare",
                "/internal/notification/storage/release",
                "/internal/notification/storage/cleanup",
                "/internal/notification/storage/append");
    }

    @Test
    void forwardsParametersAndFullOrMinimalOperationContext() {
        HttpHeaders fullHeaders = fullContext();
        HttpHeaders cleanupHeaders = cleanupContext();
        OperationRunContext fullContext = OperationRunContext.fromHeaders(fullHeaders);
        OperationRunContext cleanupContext = OperationRunContext.fromHeaders(cleanupHeaders);
        Map<String, Object> retentionParameters = Map.of(
                "requestIntervalMs", 250, "retainedBytesPerNotification", 2048);
        Map<String, Object> storageParameters = Map.of(
                "requestIntervalMs", 0,
                "totalBytes", 2L * 1024 * 1024 * 1024,
                "appendBytes", 4096,
                "minFreeBytes", 1024L * 1024);
        when(retentionState.appendStorage(fullContext, runGuard)).thenReturn(4096L);
        when(retentionState.cleanupStorage(cleanupContext, runGuard)).thenReturn(4096L);
        when(customerNotificationRepository.deleteByOperationRunId(RUN_ID)).thenReturn(3L);

        var retentionPrepare = controller.prepareRetention(fullHeaders, retentionParameters);
        var retentionRelease = controller.releaseRetention(fullHeaders);
        var retentionCleanup = controller.cleanupRetention(cleanupHeaders);
        var storagePrepare = controller.prepareStorage(fullHeaders, storageParameters);
        var storageAppend = controller.appendStorage(fullHeaders);
        var storageRelease = controller.releaseStorage(fullHeaders);
        var storageCleanup = controller.cleanupStorage(cleanupHeaders);

        assertEnvelope(retentionPrepare.getCode(), retentionPrepare.getMessage());
        assertThat(retentionPrepare.getData()).containsEntry("accepted", true)
                .containsEntry("operation", "notification-retention");
        assertEnvelope(retentionRelease.getCode(), retentionRelease.getMessage());
        assertThat(retentionRelease.getData()).containsEntry("released", true).containsEntry("runId", RUN_ID);
        assertEnvelope(retentionCleanup.getCode(), retentionCleanup.getMessage());
        assertThat(retentionCleanup.getData()).containsEntry("cleaned", true)
                .containsEntry("deletedNotifications", 3L);

        assertEnvelope(storagePrepare.getCode(), storagePrepare.getMessage());
        assertThat(storagePrepare.getData()).containsEntry("accepted", true)
                .containsEntry("operation", "notification-storage");
        assertEnvelope(storageAppend.getCode(), storageAppend.getMessage());
        assertThat(storageAppend.getData()).containsEntry("accepted", true)
                .containsEntry("runId", RUN_ID)
                .containsEntry("sizeBytes", 4096L);
        assertEnvelope(storageRelease.getCode(), storageRelease.getMessage());
        assertThat(storageRelease.getData()).containsEntry("released", true).containsEntry("runId", RUN_ID);
        assertEnvelope(storageCleanup.getCode(), storageCleanup.getMessage());
        assertThat(storageCleanup.getData()).containsEntry("cleaned", true).containsEntry("deletedBytes", 4096L);

        verify(retentionState).prepareRetention(fullContext, retentionParameters, runGuard);
        verify(retentionState, times(2)).release(fullContext, runGuard);
        verify(retentionState).cleanupRetention(cleanupContext, runGuard);
        verify(retentionState).prepareStorage(fullContext, storageParameters, runGuard);
        verify(retentionState).appendStorage(fullContext, runGuard);
        verify(retentionState).cleanupStorage(cleanupContext, runGuard);
        verify(customerNotificationRepository).deleteByOperationRunId(RUN_ID);
    }

    private static HttpHeaders fullContext() {
        HttpHeaders headers = cleanupContext();
        headers.set("X-Operation-Run-Expires-At", Instant.now().plusSeconds(600).toString());
        headers.set("X-Operation-Run-Idempotency-Key", "phase-three-notification-001");
        return headers;
    }

    private static HttpHeaders cleanupContext() {
        HttpHeaders headers = new HttpHeaders();
        headers.set("X-Operation-Run-Id", RUN_ID);
        headers.set("X-Operation-Run-Fencing-Token", "7");
        return headers;
    }

    private static Set<String> postRoutes(Class<?> controllerType) {
        return Arrays.stream(controllerType.getDeclaredMethods())
                .map(method -> method.getAnnotation(PostMapping.class))
                .filter(Objects::nonNull)
                .flatMap(mapping -> Arrays.stream(mapping.value()))
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
