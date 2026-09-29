package com.castrel.chaos.gateway.controller;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class OperationTargetRegistryTest {

    @Test
    void exposesFixedInternalPathsFromAnImmutableRegistry() {
        var targets = OperationTargetRegistry.entries();

        assertThat(targets).hasSize(10);
        targets.forEach((operation, target) -> {
            assertThat(operation).isNotBlank();
            assertThat(target.service()).isNotBlank();
            assertInternalPath(target.preparePath());
            assertInternalPath(target.releasePath());
            assertInternalPath(target.cleanupPath());
        });
        assertThatThrownBy(() -> targets.put("test-operation", targets.values().iterator().next()))
                .isInstanceOf(UnsupportedOperationException.class);
    }

    private static void assertInternalPath(String path) {
        assertThat(path).startsWith("/internal/");
        assertThat(path).doesNotContain("://", "?", "#", "..");
    }
}
