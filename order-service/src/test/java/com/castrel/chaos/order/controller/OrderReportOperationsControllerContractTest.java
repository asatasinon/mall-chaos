package com.castrel.chaos.order.controller;

import com.castrel.chaos.common.ApiResponse;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
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
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class OrderReportOperationsControllerContractTest {

    private static final String EXPECTED_INPUT_PROPERTY = "scenario.contract.expected";
    private static final String CHECKS_DIRECTORY_PROPERTY = "scenario.contract.checksDir";
    private static final String SOURCE_COMMIT_PROPERTY = "scenario.contract.sourceCommitSha";
    private static final String CHECK_ID = "order-service.scenario-targets";
    private static final String SERVICE = "order-service";
    private static final String CHECK_SCHEMA = "scenario-contract-check-result.v1";
    private static final String CLEANUP_SUFFIX = "/cleanup";
    private static final Map<String, String> OPERATION_ROUTE_BASES = Map.of(
            "orders-query-report", "/internal/orders/reports/order-query");
    private static final String RUN_ID = "123e4567-e89b-12d3-a456-426614174000";
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final OrderReportOperationsController controller = new OrderReportOperationsController();

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
        assertThat(postRoutes(OrderReportOperationsController.class)).containsAll(requiredRoutes);

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
    void exposesTheCataloguedReportLifecycleRoutes() {
        assertThat(postRoutes(OrderReportOperationsController.class)).contains(
                "/internal/orders/reports/order-query/prepare",
                "/internal/orders/reports/order-query/release",
                "/internal/orders/reports/order-query/cleanup");
    }

    @Test
    void acceptsFullPrepareAndReleaseContextAndMinimalCleanupContext() {
        HttpHeaders fullContext = fullContext();
        HttpHeaders cleanupContext = cleanupContext();

        ApiResponse<Map<String, Object>> prepare = controller.prepareOrderQueryReport(fullContext);
        ApiResponse<Map<String, Object>> release = controller.releaseOrderQueryReport(fullContext);
        ApiResponse<Map<String, Object>> cleanup = controller.cleanupOrderQueryReport(cleanupContext);

        assertEnvelope(prepare);
        assertThat(prepare.getData()).containsEntry("accepted", true)
                .containsEntry("operation", "orders-query-report");
        assertEnvelope(release);
        assertThat(release.getData()).containsEntry("released", true)
                .containsEntry("operation", "orders-query-report");
        assertEnvelope(cleanup);
        assertThat(cleanup.getData()).containsEntry("cleaned", true);
    }

    @Test
    void rejectsPrepareWithoutTheRequiredOperationContext() {
        assertThatThrownBy(() -> controller.prepareOrderQueryReport(new HttpHeaders()))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Invalid operation context");
    }

    private static HttpHeaders fullContext() {
        HttpHeaders headers = cleanupContext();
        headers.set("X-Operation-Run-Expires-At", Instant.now().plusSeconds(600).toString());
        headers.set("X-Operation-Run-Idempotency-Key", "phase-three-order-001");
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

    private static void assertEnvelope(ApiResponse<?> response) {
        assertThat(response.getCode()).isEqualTo(200);
        assertThat(response.getMessage()).isEqualTo("OK");
    }

    private static String requiredText(JsonNode object, String field) {
        String value = object.path(field).asText();
        assertThat(value).as("field %s", field).isNotBlank();
        return value;
    }
}
