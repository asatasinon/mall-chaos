package com.castrel.chaos.gateway.controller;

import com.castrel.chaos.common.ApiResponse;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
public class ChaosEventsController {

    private final JdbcTemplate jdbcTemplate;

    public ChaosEventsController(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @GetMapping("/internal/chaos/events")
    public Mono<ApiResponse<List<Map<String, Object>>>> events(
            @RequestParam(defaultValue = "20") int limit,
            @RequestParam(required = false) String chaosType,
            @RequestParam(required = false) String targetService,
            @RequestParam(required = false) String action,
            @RequestParam(required = false) String traceId
    ) {
        return Mono.fromCallable(() -> ApiResponse.ok(queryEvents(limit, chaosType, targetService, action, traceId)))
                .subscribeOn(Schedulers.boundedElastic());
    }

    private List<Map<String, Object>> queryEvents(
            int limit,
            String chaosType,
            String targetService,
            String action,
            String traceId
    ) {
        int safeLimit = Math.min(Math.max(limit, 1), 500);
        StringBuilder sql = new StringBuilder("""
                SELECT id, chaos_type, target_service, action, params, duration_sec, trace_id, triggered_at
                FROM chaos_event_log
                """);
        List<Object> args = new ArrayList<>();
        List<String> clauses = new ArrayList<>();

        if (StringUtils.hasText(chaosType)) {
            clauses.add("chaos_type = ?");
            args.add(chaosType.trim().toUpperCase());
        }
        if (StringUtils.hasText(targetService)) {
            clauses.add("target_service = ?");
            args.add(targetService.trim());
        }
        if (StringUtils.hasText(action)) {
            clauses.add("action = ?");
            args.add(action.trim().toUpperCase());
        }
        if (StringUtils.hasText(traceId)) {
            clauses.add("trace_id = ?");
            args.add(traceId.trim());
        }

        if (!clauses.isEmpty()) {
            sql.append(" WHERE ").append(String.join(" AND ", clauses));
        }
        sql.append(" ORDER BY id DESC LIMIT ?");
        args.add(safeLimit);

        List<Map<String, Object>> rows = jdbcTemplate.queryForList(sql.toString(), args.toArray());
        List<Map<String, Object>> data = new ArrayList<>(rows.size());
        for (Map<String, Object> row : rows) {
            Map<String, Object> event = new LinkedHashMap<>();
            event.put("id", row.get("id"));
            event.put("chaosType", row.get("chaos_type"));
            event.put("targetService", row.get("target_service"));
            event.put("action", row.get("action"));
            event.put("params", row.get("params"));
            event.put("durationSec", row.get("duration_sec"));
            event.put("traceId", row.get("trace_id"));
            event.put("triggeredAt", formatTimestamp(row.get("triggered_at")));
            data.add(event);
        }
        return data;
    }

    private String formatTimestamp(Object value) {
        if (value instanceof Timestamp ts) {
            return ts.toInstant().toString();
        }
        if (value instanceof Instant instant) {
            return instant.toString();
        }
        return value == null ? null : value.toString();
    }
}
