package com.castrel.chaos.inventory.config;

import com.castrel.chaos.common.ApiResponse;
import com.castrel.chaos.common.BizException;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(BizException.class)
    public ApiResponse<Void> handleBizException(BizException ex) {
        int code = switch (ex.getErrorCode()) {
            case "SKU_NOT_FOUND" -> 404;
            case "VERSION_CONFLICT" -> 409;
            case "LOCK_FAILED" -> 409;
            default -> 400;
        };
        return ApiResponse.error(code, ex.getMessage());
    }

    @ExceptionHandler(Exception.class)
    @ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)
    public ApiResponse<Void> handleException(Exception ex) {
        return ApiResponse.error(500, ex.getMessage());
    }
}
