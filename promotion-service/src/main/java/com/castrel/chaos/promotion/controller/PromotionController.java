package com.castrel.chaos.promotion.controller;

import com.castrel.chaos.common.ApiResponse;
import com.castrel.chaos.promotion.dto.PromotionRequest;
import com.castrel.chaos.promotion.dto.PromotionResultDTO;
import com.castrel.chaos.promotion.service.PromotionService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

@RestController
public class PromotionController {

    @Autowired
    private PromotionService promotionService;

    @PostMapping("/api/promotions/preview")
    public ApiResponse<PromotionResultDTO> preview(@RequestBody PromotionRequest req) {
        return ApiResponse.ok(promotionService.preview(req));
    }

    @PostMapping("/internal/promotions/calculate")
    public ApiResponse<PromotionResultDTO> calculate(@RequestBody PromotionRequest req) {
        return ApiResponse.ok(promotionService.calculate(req));
    }
}
