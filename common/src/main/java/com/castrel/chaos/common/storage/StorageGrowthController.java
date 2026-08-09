package com.castrel.chaos.common.storage;

import com.castrel.chaos.common.ApiResponse;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/internal/chaos/storage-growth")
@ConditionalOnProperty(name = "chaos.endpoints.enabled", havingValue = "true", matchIfMissing = true)
public class StorageGrowthController {

    private final StorageGrowthService storageGrowthService;

    public StorageGrowthController(StorageGrowthService storageGrowthService) {
        this.storageGrowthService = storageGrowthService;
    }

    @PostMapping("/enable")
    public ApiResponse<StorageGrowthStatus> enable(@RequestBody StorageGrowthRequest request) {
        return ApiResponse.ok(storageGrowthService.enable(request));
    }

    @PostMapping("/disable")
    public ApiResponse<StorageGrowthStatus> disable() {
        return ApiResponse.ok(storageGrowthService.disable());
    }

    @PostMapping("/cleanup")
    public ApiResponse<StorageGrowthStatus> cleanup(@RequestBody Map<String, String> request) {
        return ApiResponse.ok(storageGrowthService.cleanup(request.get("runId"), request.get("storageType")));
    }

    @GetMapping("/status")
    public ApiResponse<StorageGrowthStatus> status() {
        return ApiResponse.ok(storageGrowthService.status());
    }
}
