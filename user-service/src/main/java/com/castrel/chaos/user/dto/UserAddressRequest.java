package com.castrel.chaos.user.dto;

import lombok.Data;

@Data
public class UserAddressRequest {
    private String province;
    private String city;
    private String district;
    private String detail;
    private String receiver;
    private String phone;
    private Boolean isDefault;
}