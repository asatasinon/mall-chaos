package com.castrel.chaos.user.repository;

import com.castrel.chaos.user.entity.User;
import org.springframework.data.jpa.repository.JpaRepository;

public interface UserRepository extends JpaRepository<User, Long> {
}
