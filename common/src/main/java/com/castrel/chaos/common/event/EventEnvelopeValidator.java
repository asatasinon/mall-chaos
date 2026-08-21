package com.castrel.chaos.common.event;

import com.castrel.chaos.common.BizException;

public final class EventEnvelopeValidator {
    private EventEnvelopeValidator() {
    }

    public static void validate(EventEnvelope<?> envelope) {
        if (envelope == null
                || blank(envelope.getEventId())
                || blank(envelope.getEventType())
                || blank(envelope.getAggregateId())
                || envelope.getAggregateVersion() < 1
                || envelope.getOccurredAt() == null
                || envelope.getSchemaVersion() < 1
                || (blank(envelope.getTraceparent()) && blank(envelope.getTraceId()))) {
            throw new BizException("INVALID_EVENT_ENVELOPE", "Event envelope is missing required fields");
        }
    }

    private static boolean blank(String value) {
        return value == null || value.isBlank();
    }
}
