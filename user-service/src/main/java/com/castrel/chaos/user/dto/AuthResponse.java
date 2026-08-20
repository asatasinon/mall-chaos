package com.castrel.chaos.user.dto;

import lombok.AllArgsConstructor;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.List;

@Data
@AllArgsConstructor
public class AuthResponse {
    private Long userId;
    private String sessionToken;
    private LocalDateTime expiresAt;
    private List<String> roles;
}