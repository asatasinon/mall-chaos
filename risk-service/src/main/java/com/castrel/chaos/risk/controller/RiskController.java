package com.castrel.chaos.risk.controller;

import com.castrel.chaos.common.ApiResponse;
import com.castrel.chaos.risk.dto.PostPayCheckRequest;
import com.castrel.chaos.risk.dto.PreCheckRequest;
import com.castrel.chaos.risk.dto.RiskResultDTO;
import com.castrel.chaos.risk.service.RiskService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

@RestController
public class RiskController {

    @Autowired
    private RiskService riskService;

    @PostMapping("/internal/risk/pre-check")
    public ApiResponse<RiskResultDTO> preCheck(@RequestBody PreCheckRequest req) {
        return ApiResponse.ok(riskService.preCheck(req));
    }

    @PostMapping("/internal/risk/post-pay-check")
    public ApiResponse<RiskResultDTO> postPayCheck(@RequestBody PostPayCheckRequest req) {
        return ApiResponse.ok(riskService.postPayCheck(req));
    }
}
