package com.castrel.chaos.fulfillment.controller;

import com.castrel.chaos.common.ApiResponse;
import com.castrel.chaos.common.cache.CacheStats;
import com.castrel.chaos.common.cache.LocalQueryCacheManager;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/internal/cache/local")
public class CacheManagementController {

    private final LocalQueryCacheManager cacheManager;

    public CacheManagementController(LocalQueryCacheManager cacheManager) {
        this.cacheManager = cacheManager;
    }

    @PostMapping("/evict-all")
    public ApiResponse<CacheStats> evictAll() {
        CacheStats stats = cacheManager.evictAll();
        return ApiResponse.ok(stats);
    }

    @GetMapping("/stats")
    public ApiResponse<CacheStats> stats() {
        return ApiResponse.ok(cacheManager.getStats());
    }
}
