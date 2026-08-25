package com.castrel.chaos.common.event;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.time.LocalDateTime;
import java.time.ZoneOffset;

public final class EventEnvelopeCodec {
    private EventEnvelopeCodec() {
    }

    public static EventEnvelope<JsonNode> create(
            ObjectMapper mapper,
            String eventId,
            String eventType,
            String aggregateId,
            long aggregateVersion,
            Object payload,
            String traceId,
            String trafficRunId) {
        EventEnvelope<JsonNode> envelope = new EventEnvelope<>();
        envelope.setEventId(eventId);
        envelope.setEventType(eventType);
        envelope.setAggregateId(aggregateId);
        envelope.setAggregateVersion(aggregateVersion);
        envelope.setOccurredAt(java.time.Instant.now());
        envelope.setSchemaVersion(1);
        envelope.setTraceId(traceId);
        envelope.setTrafficRunId(trafficRunId);
        envelope.setPayload(mapper.valueToTree(payload));
        EventEnvelopeValidator.validate(envelope);
        return envelope;
    }

    public static EventEnvelope<JsonNode> decode(
            ObjectMapper mapper,
            String eventId,
            String eventType,
            String aggregateId,
            Integer aggregateVersion,
            String payload,
            LocalDateTime occurredAt,
            Integer schemaVersion,
            String traceId,
            String trafficRunId) throws Exception {
        EventEnvelope<JsonNode> envelope = new EventEnvelope<>();
        envelope.setEventId(eventId);
        envelope.setEventType(eventType);
        envelope.setAggregateId(aggregateId);
        envelope.setAggregateVersion(aggregateVersion == null ? 0 : aggregateVersion);
        envelope.setOccurredAt(occurredAt == null ? null : occurredAt.toInstant(ZoneOffset.UTC));
        envelope.setSchemaVersion(schemaVersion == null ? 0 : schemaVersion);
        envelope.setTraceId(traceId);
        envelope.setTrafficRunId(trafficRunId);
        envelope.setPayload(mapper.readTree(payload));
        EventEnvelopeValidator.validate(envelope);
        return envelope;
    }
}