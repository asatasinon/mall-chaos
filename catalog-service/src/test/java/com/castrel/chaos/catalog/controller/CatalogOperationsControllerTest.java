package com.castrel.chaos.catalog.controller;

import com.castrel.chaos.catalog.service.CatalogDependencyState;
import com.castrel.chaos.catalog.service.ProductDetailCacheProvisioningService;
import com.castrel.chaos.common.BizException;
import com.castrel.chaos.common.coordination.OperationRunContext;
import com.castrel.chaos.common.coordination.OperationRunGuard;
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
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.HashSet;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class CatalogOperationsControllerTest {

        private static final String EXPECTED_INPUT_PROPERTY = "scenario.contract.expected";
        private static final String CHECKS_DIRECTORY_PROPERTY = "scenario.contract.checksDir";
        private static final String SOURCE_COMMIT_PROPERTY = "scenario.contract.sourceCommitSha";
        private static final String CHECK_ID = "catalog-service.scenario-targets";
        private static final String SERVICE = "catalog-service";
        private static final String CHECK_SCHEMA = "scenario-contract-check-result.v1";
        private static final String CLEANUP_SUFFIX = "/cleanup";
        private static final Map<String, String> OPERATION_ROUTE_BASES = Map.of(
                "products-browse-report", "/internal/catalog/reports/product-browse",
                "product-detail-cache", "/internal/catalog/product-details/cache",
                "cart-product-validation", "/internal/catalog/dependencies/cart-product-validation");

        private static final String RUN_ID = "123e4567-e89b-12d3-a456-426614174000";
        private static final String OPERATION = "product-detail-cache";
        private final ObjectMapper objectMapper = new ObjectMapper();

    @Mock
    private CatalogDependencyState dependencyState;

    @Mock
        private OperationRunGuard runGuard;

    @Mock
    private ProductDetailCacheProvisioningService provisioningService;

    private CatalogOperationsController controller;
    private HttpHeaders headers;
    private MockHttpServletRequest request;

    @BeforeEach
    void setUp() {
        controller = new CatalogOperationsController(dependencyState, runGuard, provisioningService);
        headers = new HttpHeaders();
        headers.set("X-Operation-Run-Id", RUN_ID);
        headers.set("X-Operation-Run-Expires-At", Instant.now().plusSeconds(600).toString());
        headers.set("X-Operation-Run-Fencing-Token", "7");
        headers.set("X-Operation-Run-Idempotency-Key", "phase-d-controller-001");
        request = new MockHttpServletRequest();
        request.setAttribute("castrel.allowedActions", List.of("OPERATION_CONTROL"));
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
        assertThat(postRoutes(CatalogOperationsController.class)).containsAll(requiredRoutes);

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
    void routesProductDetailCachePreparationWithParameters() {
        Map<String, Object> parameters = Map.of("durationSec", 30, "memberCount", 2);
        when(provisioningService.start(
                eq(new OperationRunContext(RUN_ID, Instant.parse(headers.getFirst("X-Operation-Run-Expires-At")), 7,
                        "phase-d-controller-001")), eq(parameters)))
                .thenReturn(Map.of("accepted", true, "layout", "HASH"));

        var response = controller.prepareProductDetailCache(headers, parameters, request);

        assertThat(response.getData()).containsEntry("accepted", true);
        verify(provisioningService).start(
                eq(new OperationRunContext(RUN_ID, Instant.parse(headers.getFirst("X-Operation-Run-Expires-At")), 7,
                        "phase-d-controller-001")), eq(parameters));
    }

    @Test
    void rejectsProductDetailPreparationWithoutControlScope() {
        request.removeAttribute("castrel.allowedActions");

        assertThatThrownBy(() -> controller.prepareProductDetailCache(headers, Map.of(), request))
                .isInstanceOf(BizException.class)
                .extracting("errorCode")
                .isEqualTo("INTERNAL_AUTH_REQUIRED");
    }

    @Test
    void routesProductDetailReleaseAndCleanup() {
        var context = new OperationRunContext(
            RUN_ID, Instant.parse(headers.getFirst("X-Operation-Run-Expires-At")), 7,
                "phase-d-controller-001");
        when(provisioningService.stop(context)).thenReturn(Map.of("released", true));
        when(provisioningService.cleanup(context)).thenReturn(Map.of("hashRemoved", true));

        var releaseResponse = controller.releaseProductDetailCache(headers, request);
        var cleanupResponse = controller.cleanupProductDetailCache(headers, request);

        assertThat(releaseResponse.getData()).containsEntry("released", true);
        assertThat(cleanupResponse.getData()).containsEntry("hashRemoved", true);
        verify(provisioningService).stop(context);
        verify(provisioningService).cleanup(context);
    }

    @Test
    void allowsProductDetailCleanupWithMinimalGatewayHeaders() {
        HttpHeaders cleanupHeaders = new HttpHeaders();
        cleanupHeaders.set("X-Operation-Run-Id", RUN_ID);
        cleanupHeaders.set("X-Operation-Run-Fencing-Token", "7");
        OperationRunContext cleanupContext = OperationRunContext.fromHeaders(cleanupHeaders);
        when(provisioningService.cleanup(cleanupContext)).thenReturn(Map.of(
                "released", true, "hashRemoved", false));

        var response = controller.cleanupProductDetailCache(cleanupHeaders, request);

        assertThat(response.getData()).containsEntry("released", true);
        verify(provisioningService).cleanup(cleanupContext);
    }

    @Test
    void exposesFixedPrepareReleaseAndCleanupRoutesForCatalogOperations() {
        assertThat(postRoutes(CatalogOperationsController.class)).contains(
                "/internal/catalog/reports/product-browse/prepare",
                "/internal/catalog/reports/product-browse/release",
                "/internal/catalog/reports/product-browse/cleanup",
                "/internal/catalog/product-details/cache/prepare",
                "/internal/catalog/product-details/cache/release",
                "/internal/catalog/product-details/cache/cleanup",
                "/internal/catalog/dependencies/cart-product-validation/prepare",
                "/internal/catalog/dependencies/cart-product-validation/release",
                "/internal/catalog/dependencies/cart-product-validation/cleanup");
    }

    @Test
    void reportAndCartOperationsUseExpectedContextAndEnvelope() {
        OperationRunContext context = OperationRunContext.fromHeaders(headers);

        var browsePrepare = controller.prepareProductBrowseReport(headers);
        var cartPrepare = controller.prepareCartProductValidation(headers);
        var browseRelease = controller.releaseProductBrowseReport(headers);
        var cartRelease = controller.releaseCartProductValidation(headers);

        assertEnvelope(browsePrepare.getCode(), browsePrepare.getMessage());
        assertThat(browsePrepare.getData())
                .containsEntry("accepted", true)
                .containsEntry("operation", "products-browse-report");
        assertEnvelope(cartPrepare.getCode(), cartPrepare.getMessage());
        assertThat(cartPrepare.getData())
                .containsEntry("accepted", true)
                .containsEntry("operation", "cart-product-validation");
        assertEnvelope(browseRelease.getCode(), browseRelease.getMessage());
        assertThat(browseRelease.getData())
                .containsEntry("released", true)
                .containsEntry("operation", "products-browse-report");
        assertEnvelope(cartRelease.getCode(), cartRelease.getMessage());
        verify(dependencyState).start(context, runGuard);
        verify(dependencyState).stop(context, runGuard);
    }

    @Test
    void catalogCleanupAcceptsGatewayMinimalRunContext() {
        HttpHeaders cleanupHeaders = new HttpHeaders();
        cleanupHeaders.set("X-Operation-Run-Id", RUN_ID);
        cleanupHeaders.set("X-Operation-Run-Fencing-Token", "7");
        OperationRunContext cleanupContext = OperationRunContext.fromHeaders(cleanupHeaders);

        var browseResponse = controller.cleanupProductBrowseReport(cleanupHeaders);
        var cartResponse = controller.cleanupCartProductValidation(cleanupHeaders);

        assertEnvelope(browseResponse.getCode(), browseResponse.getMessage());
        assertThat(browseResponse.getData()).containsEntry("cleaned", true);
        assertEnvelope(cartResponse.getCode(), cartResponse.getMessage());
        assertThat(cartResponse.getData()).containsEntry("cleaned", true);
        verify(dependencyState).stopForCleanup(cleanupContext, runGuard);
    }

    @Test
    void actualCartCleanupValidatesMinimalContextBeforeReleasingTheFence() {
        OperationRunGuard guard = mock(OperationRunGuard.class);
        var realController = new CatalogOperationsController(
                new CatalogDependencyState(), guard, provisioningService);
        HttpHeaders cleanupHeaders = new HttpHeaders();
        cleanupHeaders.set("X-Operation-Run-Id", RUN_ID);
        cleanupHeaders.set("X-Operation-Run-Fencing-Token", "7");
        OperationRunContext cleanupContext = OperationRunContext.fromHeaders(cleanupHeaders);

        var response = realController.cleanupCartProductValidation(cleanupHeaders);

        assertEnvelope(response.getCode(), response.getMessage());
        assertThat(response.getData()).containsEntry("cleaned", true);
        verify(guard).release(cleanupContext);

        HttpHeaders invalidContext = new HttpHeaders();
        invalidContext.set("X-Operation-Run-Id", RUN_ID);
        assertThatThrownBy(() -> realController.cleanupCartProductValidation(invalidContext))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Invalid operation cleanup context");
        verifyNoMoreInteractions(guard);
    }

    @Test
    void prepareRejectsMissingOperationContextBeforeReturningAccepted() {
        HttpHeaders missingContext = new HttpHeaders();
        missingContext.set("X-Operation-Run-Id", RUN_ID);
        missingContext.set("X-Operation-Run-Fencing-Token", "7");

        assertThatThrownBy(() -> controller.prepareProductBrowseReport(missingContext))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Invalid operation context");
    }

    private static Set<String> postRoutes(Class<?> controllerType) {
        RequestMapping controllerMapping = controllerType.getAnnotation(RequestMapping.class);
        String prefix = controllerMapping == null || controllerMapping.value().length == 0
                ? "" : controllerMapping.value()[0];
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