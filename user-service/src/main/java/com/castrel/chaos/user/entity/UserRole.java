package com.castrel.chaos.user.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
import lombok.Data;

import java.io.Serializable;

@Data
@Entity
@Table(name = "user_roles")
@IdClass(UserRole.Key.class)
public class UserRole {

    @Id
    @Column(name = "user_id")
    private Long userId;

    @Id
    private String role;

    public record Key(Long userId, String role) implements Serializable {
    }
}