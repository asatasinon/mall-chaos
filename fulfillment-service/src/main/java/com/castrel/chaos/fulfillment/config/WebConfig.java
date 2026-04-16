package com.castrel.chaos.fulfillment.config;

import com.castrel.chaos.common.TraceContext;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.MDC;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.util.UUID;

@Component
public class WebConfig implements WebMvcConfigurer {

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(new HandlerInterceptor() {
            @Override
            public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
                String tid = request.getHeader(TraceContext.TRACE_ID_HEADER);
                if (tid == null || tid.isBlank()) {
                    tid = UUID.randomUUID().toString().replace("-", "");
                }
                TraceContext.setTraceId(tid);
                MDC.put("traceId", tid);
                response.setHeader(TraceContext.TRACE_ID_HEADER, tid);
                return true;
            }

            @Override
            public void afterCompletion(HttpServletRequest request, HttpServletResponse response,
                                        Object handler, Exception ex) {
                TraceContext.clear();
                MDC.remove("traceId");
            }
        });
    }
}
