package com.castrel.chaos.user.dto;

import lombok.Data;

@Data
public class UserAddressDTO {
    private String province;
    private String city;
    private String district;
    private String detail;
    private String receiver;
    private String phone;
}
