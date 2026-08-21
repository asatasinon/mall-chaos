package com.castrel.chaos.common.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import org.springframework.beans.factory.annotation.Value;

@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 20)
@ConditionalOnClass(OncePerRequestFilter.class)
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
public class DownstreamPrincipalFilter extends OncePerRequestFilter {

    private final JwtTokenService jwtTokenService;
    private final String internalServiceKey;

    public DownstreamPrincipalFilter(
            JwtTokenService jwtTokenService,
            @Value("${CASTREL_INTERNAL_SERVICE_KEY:}") String internalServiceKey) {
        this.jwtTokenService = jwtTokenService;
        this.internalServiceKey = internalServiceKey;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {
        if (!request.getRequestURI().startsWith("/internal/")) {
            filterChain.doFilter(request, response);
            return;
        }

        String principal = request.getHeader("X-Downstream-Principal");
        if (!internalServiceKey.isBlank() && internalServiceKey.equals(request.getHeader("X-Internal-Service-Key"))) {
            filterChain.doFilter(request, response);
            return;
        }
        if (principal == null || principal.isBlank()) {
            response.sendError(HttpServletResponse.SC_UNAUTHORIZED, "Gateway principal required");
            return;
        }

        try {
            JwtTokenService.DownstreamPrincipal verified =
                    jwtTokenService.verifyDownstreamPrincipal(principal);
            request.setAttribute("castrel.customerId", verified.customerId());
            request.setAttribute("castrel.trafficRunId", verified.trafficRunId());
            request.setAttribute("castrel.allowedActions", verified.allowedActions());
            filterChain.doFilter(request, response);
        } catch (IllegalArgumentException exception) {
            response.sendError(HttpServletResponse.SC_UNAUTHORIZED, "Invalid Gateway principal");
        }
    }
}