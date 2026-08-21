package com.castrel.chaos.common.security;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.web.client.RestTemplateCustomizer;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import org.springframework.web.client.RestTemplate;

@Component
@ConditionalOnClass(RestTemplate.class)
public class DownstreamPrincipalRestTemplateCustomizer implements RestTemplateCustomizer {

    @Override
    public void customize(RestTemplate restTemplate) {
        restTemplate.getInterceptors().add((request, body, execution) -> {
            ServletRequestAttributes attributes =
                    (ServletRequestAttributes) RequestContextHolder.getRequestAttributes();
            if (attributes != null) {
                HttpServletRequest currentRequest = attributes.getRequest();
                String principal = currentRequest.getHeader("X-Downstream-Principal");
                if (principal != null && !principal.isBlank()) {
                    request.getHeaders().set("X-Downstream-Principal", principal);
                }
            }
            return execution.execute(request, body);
        });
    }
}