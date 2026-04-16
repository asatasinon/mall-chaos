package com.castrel.chaos.user.entity;

import jakarta.persistence.*;
import lombok.Data;

@Entity
@Table(name = "user_addresses")
@Data
public class UserAddress {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id")
    private Long userId;

    @Column(name = "is_default")
    private Integer isDefault;

    private String province;

    private String city;

    private String district;

    private String detail;

    private String receiver;

    private String phone;
}
