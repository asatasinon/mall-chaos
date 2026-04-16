package com.castrel.chaos.user.dto;

import lombok.Data;

@Data
public class UserDTO {
    private Long id;
    private String nickname;
    private Integer level;
    private Integer status;
    private String email;
}
