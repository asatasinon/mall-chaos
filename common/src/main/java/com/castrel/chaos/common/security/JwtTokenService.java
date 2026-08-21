package com.castrel.chaos.common.security;

import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jose.crypto.MACVerifier;
import com.nimbusds.jwt.JWTParser;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.UUID;
import java.util.Map;

@Component
public class JwtTokenService {

    private final String issuer;
    private final String audience;
    private final byte[] secret;
    private final Duration accessTokenTtl;

    public JwtTokenService(
            @Value("${castrel.security.jwt.issuer:castrel-user-service}") String issuer,
            @Value("${castrel.security.jwt.audience:castrel-gateway}") String audience,
            @Value("${CASTREL_JWT_SECRET:change-me-in-development-only-32-bytes}") String secret,
            @Value("${castrel.security.jwt.access-ttl:PT15M}") Duration accessTokenTtl) {
        if (secret.getBytes(StandardCharsets.UTF_8).length < 32) {
            throw new IllegalArgumentException("CASTREL_JWT_SECRET must be at least 32 bytes");
        }
        this.issuer = issuer;
        this.audience = audience;
        this.secret = secret.getBytes(StandardCharsets.UTF_8);
        this.accessTokenTtl = accessTokenTtl;
    }

    public String issueAccessToken(Long userId, List<String> roles) {
        Instant issuedAt = Instant.now();
        JWTClaimsSet claims = new JWTClaimsSet.Builder()
                .issuer(issuer)
                .audience(audience)
                .subject(userId.toString())
                .claim("roles", roles)
                .issueTime(Date.from(issuedAt))
                .expirationTime(Date.from(issuedAt.plus(accessTokenTtl)))
                .jwtID(UUID.randomUUID().toString())
                .build();
        SignedJWT jwt = new SignedJWT(new JWSHeader(JWSAlgorithm.HS256), claims);
        try {
            jwt.sign(new MACSigner(secret));
            return jwt.serialize();
        } catch (JOSEException exception) {
            throw new IllegalStateException("Unable to sign access token", exception);
        }
    }

    public String issueDownstreamPrincipal(Long customerId, String trafficRunId, List<String> allowedActions) {
        Instant issuedAt = Instant.now();
        JWTClaimsSet claims = new JWTClaimsSet.Builder()
                .issuer(issuer)
                .audience("castrel-business-services")
                .subject(customerId.toString())
                .claim("actor", "GATEWAY")
                .claim("customerId", customerId)
                .claim("trafficRunId", trafficRunId)
                .claim("allowedActions", allowedActions)
                .issueTime(Date.from(issuedAt))
                .expirationTime(Date.from(issuedAt.plus(Duration.ofMinutes(2))))
                .jwtID(UUID.randomUUID().toString())
                .build();
        SignedJWT jwt = new SignedJWT(new JWSHeader(JWSAlgorithm.HS256), claims);
        try {
            jwt.sign(new MACSigner(secret));
            return jwt.serialize();
        } catch (JOSEException exception) {
            throw new IllegalStateException("Unable to sign downstream principal", exception);
        }
    }

    public JwtPrincipal verifyAccessToken(String token) {
        try {
            SignedJWT jwt = (SignedJWT) JWTParser.parse(token);
            if (!jwt.verify(new MACVerifier(secret))) {
                throw new IllegalArgumentException("Invalid JWT signature");
            }
            JWTClaimsSet claims = jwt.getJWTClaimsSet();
            Instant now = Instant.now();
            if (!issuer.equals(claims.getIssuer())
                    || claims.getAudience() == null
                    || !claims.getAudience().contains(audience)
                    || claims.getSubject() == null
                    || claims.getJWTID() == null
                    || claims.getExpirationTime() == null
                    || !claims.getExpirationTime().toInstant().isAfter(now)) {
                throw new IllegalArgumentException("Invalid JWT claims");
            }
            Object rolesClaim = claims.getClaim("roles");
            List<String> roles = rolesClaim instanceof List<?> values
                    ? values.stream().map(String::valueOf).toList()
                    : List.of();
            return new JwtPrincipal(Long.valueOf(claims.getSubject()), roles, claims.getJWTID());
        } catch (Exception exception) {
            throw new IllegalArgumentException("Invalid access token", exception);
        }
    }

    public DownstreamPrincipal verifyDownstreamPrincipal(String token) {
        try {
            SignedJWT jwt = (SignedJWT) JWTParser.parse(token);
            if (!jwt.verify(new MACVerifier(secret))) {
                throw new IllegalArgumentException("Invalid downstream signature");
            }
            JWTClaimsSet claims = jwt.getJWTClaimsSet();
            Instant now = Instant.now();
            if (!issuer.equals(claims.getIssuer())
                    || !claims.getAudience().contains("castrel-business-services")
                    || !"GATEWAY".equals(claims.getStringClaim("actor"))
                    || claims.getExpirationTime() == null
                    || !claims.getExpirationTime().toInstant().isAfter(now)) {
                throw new IllegalArgumentException("Invalid downstream claims");
            }
            Object actionsClaim = claims.getClaim("allowedActions");
            List<String> actions = actionsClaim instanceof List<?> values
                    ? values.stream().map(String::valueOf).toList()
                    : List.of();
            return new DownstreamPrincipal(
                    claims.getLongClaim("customerId"), claims.getStringClaim("trafficRunId"), actions,
                    claims.getJWTID());
        } catch (Exception exception) {
            throw new IllegalArgumentException("Invalid downstream principal", exception);
        }
    }

    public RunnerPrincipal verifyRunnerCredential(String token) {
        try {
            SignedJWT jwt = (SignedJWT) JWTParser.parse(token);
            if (!jwt.verify(new MACVerifier(secret))) {
                throw new IllegalArgumentException("Invalid runner signature");
            }
            JWTClaimsSet claims = jwt.getJWTClaimsSet();
            Instant now = Instant.now();
            if (!issuer.equals(claims.getIssuer())
                    || !claims.getAudience().contains("castrel-gateway-service")
                    || !"TRAFFIC_RUNNER".equals(claims.getStringClaim("actor"))
                    || claims.getJWTID() == null
                    || claims.getExpirationTime() == null
                    || !claims.getExpirationTime().toInstant().isAfter(now)
                    || claims.getLongClaim("customerId") == null) {
                throw new IllegalArgumentException("Invalid runner claims");
            }
            Object scopesClaim = claims.getClaim("scope");
            List<String> scopes = scopesClaim instanceof List<?> values
                    ? values.stream().map(String::valueOf).toList()
                    : scopesClaim instanceof String scope ? List.of(scope.split(" ")) : List.of();
            return new RunnerPrincipal(claims.getLongClaim("customerId"), scopes, claims.getJWTID());
        } catch (Exception exception) {
            throw new IllegalArgumentException("Invalid runner credential", exception);
        }
    }

    public record JwtPrincipal(Long userId, List<String> roles, String tokenId) {
    }

    public record DownstreamPrincipal(Long customerId, String trafficRunId, List<String> allowedActions,
                                      String tokenId) {
    }

    public record RunnerPrincipal(Long customerId, List<String> scopes, String tokenId) {
    }
}