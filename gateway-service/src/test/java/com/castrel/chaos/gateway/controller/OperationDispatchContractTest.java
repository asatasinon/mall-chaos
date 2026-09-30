package com.castrel.chaos.gateway.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashSet;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

class OperationDispatchContractTest {

    private static final String EXPECTED_INPUT_PROPERTY = "scenario.contract.expected";
    private static final String CHECKS_DIRECTORY_PROPERTY = "scenario.contract.checksDir";

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void matchesGatewayRegistryToCatalogDerivedContractWhenInputIsProvided() throws IOException {
        String expectedInputPath = System.getProperty(EXPECTED_INPUT_PROPERTY);
        String checksDirectory = System.getProperty(CHECKS_DIRECTORY_PROPERTY);
        Assumptions.assumeTrue(expectedInputPath != null && !expectedInputPath.isBlank()
                        && checksDirectory != null && !checksDirectory.isBlank(),
                "The root Scenario Contract gate provides expected input and checks directory");

        JsonNode root = objectMapper.readTree(Path.of(expectedInputPath).toFile());
        assertThat(root.path("schemaVersion").asText()).isEqualTo("scenario-contract-gateway.v1");
        String catalogRevision = requiredText(root, "catalogRevision");
        assertThat(catalogRevision).matches("[a-f0-9]{64}");

        JsonNode operations = root.path("operations");
        assertThat(operations.isArray()).isTrue();
        assertThat(operations.size()).isEqualTo(10);

        Set<String> expectedOperations = new HashSet<>();
        for (JsonNode operation : operations) {
            String operationName = requiredText(operation, "operation");
            String service = requiredText(operation, "service");
            String preparePolicy = requiredText(operation, "targetPrepare");
            String releasePolicy = requiredText(operation, "targetRelease");
            String cleanupPolicy = requiredText(operation, "cleanup");

            assertThat(expectedOperations.add(operationName)).isTrue();
            assertThat(preparePolicy).isEqualTo("REQUIRED");
            assertThat(releasePolicy).isIn("REQUIRED", "FORBIDDEN", "NOT_APPLICABLE");
            assertThat(cleanupPolicy).isIn("NONE", "OPTIONAL_PER_RUN", "OPERATOR_CONFIRMED");

            OperationTargetRegistry.Target target = OperationTargetRegistry.find(operationName);
            assertThat(target)
                    .as("Gateway registry entry for %s", operationName)
                    .isNotNull();
            assertThat(target.service()).isEqualTo(service);
            assertInternalPath(target.preparePath());
            assertInternalPath(target.releasePath());
            assertInternalPath(target.cleanupPath());
        }
        assertThat(expectedOperations).containsExactlyInAnyOrderElementsOf(
                OperationTargetRegistry.entries().keySet());

        String sourceCommitSha = System.getProperty("scenario.contract.sourceCommitSha");
        assertThat(sourceCommitSha).matches("(?i)([a-f0-9]{40}|[a-f0-9]{64})");
        Path checksPath = Path.of(checksDirectory);
        Files.createDirectories(checksPath);
        ObjectNode result = objectMapper.createObjectNode();
        result.put("schemaVersion", "scenario-contract-check-result.v1");
        result.put("checkId", "gateway-service.operation-dispatch");
        result.put("status", "PASSED");
        result.put("catalogRevision", catalogRevision);
        result.put("operationCount", expectedOperations.size());
        result.put("sourceCommitSha", sourceCommitSha);
        objectMapper.writeValue(checksPath.resolve("gateway-operation-dispatch.json").toFile(), result);
    }

    private static String requiredText(JsonNode object, String field) {
        String value = object.path(field).asText();
        assertThat(value).as("field %s", field).isNotBlank();
        return value;
    }

    private static void assertInternalPath(String path) {
        assertThat(path).startsWith("/internal/");
        assertThat(path).doesNotContain("://", "?", "#", "..");
    }
}
