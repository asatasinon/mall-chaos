package com.castrel.chaos.user.controller;

import com.castrel.chaos.common.ApiResponse;
import com.castrel.chaos.user.dto.UserAddressDTO;
import com.castrel.chaos.user.dto.UserDTO;
import com.castrel.chaos.user.service.UserService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

@RestController
public class UserController {

    @Autowired
    private UserService userService;

    @GetMapping("/api/users/{id}")
    public ApiResponse<UserDTO> getUser(@PathVariable Long id) {
        return ApiResponse.ok(userService.getUser(id));
    }

    @GetMapping("/internal/users/{id}")
    public ApiResponse<UserDTO> getUserInternal(@PathVariable Long id) {
        return ApiResponse.ok(userService.getUser(id));
    }

    @GetMapping("/internal/users/{id}/address")
    public ApiResponse<UserAddressDTO> getAddress(@PathVariable Long id) {
        return ApiResponse.ok(userService.getDefaultAddress(id));
    }
}
