package com.castrel.chaos.catalog.config;

import com.castrel.chaos.common.ApiResponse;
import com.castrel.chaos.common.BizException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.web.servlet.NoHandlerFoundException;
import org.springframework.web.servlet.resource.NoResourceFoundException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(BizException.class)
    public ApiResponse<Void> handleBizException(BizException ex) {
        int code = "PRODUCT_NOT_FOUND".equals(ex.getErrorCode()) ? 404 : 400;
        log.warn("BizException [{}]: {}", ex.getErrorCode(), ex.getMessage());
        return ApiResponse.error(code, ex.getMessage());
    }

    @ExceptionHandler({NoResourceFoundException.class, NoHandlerFoundException.class})
    @ResponseStatus(HttpStatus.NOT_FOUND)
    public ApiResponse<Void> handleNotFound(Exception ex) {
        if (ex instanceof NoResourceFoundException noResource) {
            log.info("Route not found: {} {}", noResource.getHttpMethod(), noResource.getResourcePath());
        } else if (ex instanceof NoHandlerFoundException noHandler) {
            log.info("Route not found: {} {}", noHandler.getHttpMethod(), noHandler.getRequestURL());
        } else {
            log.info("Route not found: {}", ex.getMessage());
        }
        return ApiResponse.error(404, "Resource not found");
    }

    @ExceptionHandler(Exception.class)
    @ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)
    public ApiResponse<Void> handleException(Exception ex) {
        log.error("Unhandled exception: {}", ex.getMessage(), ex);
        return ApiResponse.error(500, ex.getMessage());
    }
}
