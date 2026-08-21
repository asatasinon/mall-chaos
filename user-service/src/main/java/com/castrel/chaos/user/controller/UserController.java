package com.castrel.chaos.user.controller;

import com.castrel.chaos.common.ApiResponse;
import com.castrel.chaos.user.dto.UserAddressDTO;
import com.castrel.chaos.user.dto.UserDTO;
import com.castrel.chaos.user.dto.AuthResponse;
import com.castrel.chaos.user.dto.LoginRequest;
import com.castrel.chaos.user.dto.RegisterRequest;
import com.castrel.chaos.user.dto.UserAddressRequest;
import com.castrel.chaos.user.dto.UserProfileRequest;
import com.castrel.chaos.user.service.UserService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
public class UserController {

    @Autowired
    private UserService userService;

    @PostMapping("/api/auth/register")
    public ApiResponse<AuthResponse> register(@RequestBody RegisterRequest request) {
        return ApiResponse.ok(userService.register(request));
    }

    @PostMapping("/api/auth/login")
    public ApiResponse<AuthResponse> login(@RequestBody LoginRequest request) {
        return ApiResponse.ok(userService.login(request));
    }

    @PostMapping("/api/auth/refresh")
    public ApiResponse<AuthResponse> refresh(@RequestHeader("X-Session-Token") String sessionToken) {
        return ApiResponse.ok(userService.refresh(sessionToken));
    }

    @PostMapping("/api/auth/logout")
    public ApiResponse<Void> logout(@RequestHeader("X-Session-Token") String sessionToken) {
        userService.logout(sessionToken);
        return ApiResponse.ok();
    }

    @GetMapping("/api/users/{id}")
    public ApiResponse<UserDTO> getUser(
            @RequestHeader("X-User-Id") Long authenticatedUserId, @PathVariable Long id) {
        if (!authenticatedUserId.equals(id)) {
            throw new com.castrel.chaos.common.BizException("USER_NOT_FOUND", "User not found: " + id);
        }
        return ApiResponse.ok(userService.getUser(id));
    }

    @PatchMapping("/api/users/{id}")
    public ApiResponse<UserDTO> updateProfile(
            @RequestHeader("X-User-Id") Long authenticatedUserId,
            @PathVariable Long id,
            @RequestBody UserProfileRequest request) {
        if (!authenticatedUserId.equals(id)) {
            throw new com.castrel.chaos.common.BizException("USER_NOT_FOUND", "User not found: " + id);
        }
        return ApiResponse.ok(userService.updateProfile(id, request));
    }

    @GetMapping("/internal/users/{id}")
    public ApiResponse<UserDTO> getUserInternal(@PathVariable Long id) {
        return ApiResponse.ok(userService.getUser(id));
    }

    @GetMapping("/internal/users/{id}/address")
    public ApiResponse<UserAddressDTO> getAddress(@PathVariable Long id) {
        return ApiResponse.ok(userService.getDefaultAddress(id));
    }

    @GetMapping("/api/addresses")
    public ApiResponse<List<UserAddressDTO>> listAddresses(@RequestHeader("X-User-Id") Long userId) {
        return ApiResponse.ok(userService.listAddresses(userId));
    }

    @PostMapping("/api/addresses")
    public ApiResponse<UserAddressDTO> addAddress(
            @RequestHeader("X-User-Id") Long userId, @RequestBody UserAddressRequest request) {
        return ApiResponse.ok(userService.addAddress(userId, request));
    }

    @PutMapping("/api/addresses/{id}")
    public ApiResponse<UserAddressDTO> updateAddress(
            @RequestHeader("X-User-Id") Long userId,
            @PathVariable Long id,
            @RequestBody UserAddressRequest request) {
        return ApiResponse.ok(userService.updateAddress(userId, id, request));
    }

    @DeleteMapping("/api/addresses/{id}")
    public ApiResponse<Void> deleteAddress(
            @RequestHeader("X-User-Id") Long userId, @PathVariable Long id) {
        userService.deleteAddress(userId, id);
        return ApiResponse.ok();
    }
}
