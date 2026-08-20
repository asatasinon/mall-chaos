package com.castrel.chaos.user.repository;

import com.castrel.chaos.user.entity.UserRole;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface UserRoleRepository extends JpaRepository<UserRole, UserRole.Key> {
    List<UserRole> findByUserId(Long userId);
}