package com.castrel.chaos.common.coordination;

import org.springframework.http.HttpHeaders;

import java.time.Instant;
import java.util.UUID;

public record OperationRunContext(
        String runId,
        Instant expiresAt,
        long fencingToken,
        String idempotencyKey) {

    public static OperationRunContext fromHeaders(HttpHeaders headers) {
        return new OperationRunContext(
                headers.getFirst("X-Operation-Run-Id"),
                parseInstant(headers.getFirst("X-Operation-Run-Expires-At")),
                parseLong(headers.getFirst("X-Operation-Run-Fencing-Token")),
                headers.getFirst("X-Operation-Run-Idempotency-Key"));
    }

    public void validate(Instant now) {
        if (runId == null || !isUuid(runId)
                || expiresAt == null
                || fencingToken < 1
                || idempotencyKey == null
                || !idempotencyKey.matches("[A-Za-z0-9][A-Za-z0-9._:-]{7,127}")) {
            throw new IllegalArgumentException("Invalid operation context");
        }
        if (!expiresAt.isAfter(now)) {
            throw new IllegalArgumentException("Operation context is expired");
        }
    }

    public void validateForRelease() {
        if (runId == null || !isUuid(runId)
                || expiresAt == null
                || fencingToken < 1
                || idempotencyKey == null
                || !idempotencyKey.matches("[A-Za-z0-9][A-Za-z0-9._:-]{7,127}")) {
            throw new IllegalArgumentException("Invalid operation context");
        }
    }

    public void validateForCleanup() {
        if (runId == null || !isUuid(runId) || fencingToken < 1) {
            throw new IllegalArgumentException("Invalid operation cleanup context");
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