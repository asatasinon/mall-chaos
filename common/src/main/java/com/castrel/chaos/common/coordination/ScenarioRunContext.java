package com.castrel.chaos.common.coordination;

import org.springframework.http.HttpHeaders;

import java.time.Instant;
import java.util.UUID;

public record ScenarioRunContext(
        String runId,
        Instant expiresAt,
        long fencingToken,
        String idempotencyKey) {

    public static ScenarioRunContext fromHeaders(HttpHeaders headers) {
        return new ScenarioRunContext(
                headers.getFirst("X-Fault-Run-Id"),
                parseInstant(headers.getFirst("X-Fault-Run-Expires-At")),
                parseLong(headers.getFirst("X-Fault-Run-Fencing-Token")),
                headers.getFirst("X-Fault-Run-Idempotency-Key"));
    }

    public void validate(Instant now) {
        if (runId == null || !isUuid(runId)
                || expiresAt == null
                || fencingToken < 1
                || idempotencyKey == null
                || !idempotencyKey.matches("[A-Za-z0-9][A-Za-z0-9._:-]{7,127}")) {
            throw new IllegalArgumentException("Invalid scenario run context");
        }
        if (!expiresAt.isAfter(now)) {
            throw new IllegalArgumentException("Scenario run context is expired");
        }
    }

    public void validateForRelease() {
        if (runId == null || !isUuid(runId)
                || expiresAt == null
                || fencingToken < 1
                || idempotencyKey == null
                || !idempotencyKey.matches("[A-Za-z0-9][A-Za-z0-9._:-]{7,127}")) {
            throw new IllegalArgumentException("Invalid scenario run context");
        }
    }

    private static Instant parseInstant(String value) {
        try {
            return value == null ? null : Instant.parse(value);
        } catch (Exception ignored) {
            return null;
        }
    }

    private static long parseLong(String value) {
        try {
            return value == null ? -1 : Long.parseLong(value);
        } catch (NumberFormatException ignored) {
            return -1;
        }
    }

    private static boolean isUuid(String value) {
        try {
            UUID.fromString(value);
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }
}
