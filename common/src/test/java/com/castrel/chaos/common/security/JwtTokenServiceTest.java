package com.castrel.chaos.common.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.List;

class JwtTokenServiceTest {

    private final JwtTokenService service = new JwtTokenService(
            "castrel-user-service", "castrel-gateway",
            "01234567890123456789012345678901", Duration.ofMinutes(15));

    @Test
    void issuesTokenWithTrustedPrincipalClaims() {
        String token = service.issueAccessToken(42L, List.of("CUSTOMER"));

        JwtTokenService.JwtPrincipal principal = service.verifyAccessToken(token);

        assertThat(principal.userId()).isEqualTo(42L);
        assertThat(principal.roles()).containsExactly("CUSTOMER");
        assertThat(principal.tokenId()).isNotBlank();
    }

    @Test
    void rejectsTamperedToken() {
        String token = service.issueAccessToken(42L, List.of("CUSTOMER"));
        String tampered = token.substring(0, token.length() - 1) + "x";

        assertThatThrownBy(() -> service.verifyAccessToken(tampered))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void issuesAndVerifiesGatewayDownstreamPrincipal() {
        String token = service.issueDownstreamPrincipal(42L, "run-1", List.of("CUSTOMER_API"));

        JwtTokenService.DownstreamPrincipal principal = service.verifyDownstreamPrincipal(token);

        assertThat(principal.customerId()).isEqualTo(42L);
        assertThat(principal.trafficRunId()).isEqualTo("run-1");
        assertThat(principal.allowedActions()).containsExactly("CUSTOMER_API");
    }

    @Test
    void doesNotAcceptCustomerAccessTokenAsDownstreamPrincipal() {
        String token = service.issueAccessToken(42L, List.of("CUSTOMER"));

        assertThatThrownBy(() -> service.verifyDownstreamPrincipal(token))
                .isInstanceOf(IllegalArgumentException.class);
    }
}