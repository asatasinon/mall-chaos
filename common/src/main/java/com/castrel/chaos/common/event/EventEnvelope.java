package com.castrel.chaos.common.event;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class EventEnvelope<T> {
    private String eventId;
    private String eventType;
    private String aggregateId;
    private long aggregateVersion;
    private Instant occurredAt;
    private int schemaVersion;
    private String traceparent;
    private String traceId;
    private String trafficRunId;
    private T payload;
}
