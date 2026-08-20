package com.castrel.chaos.user.repository;

import com.castrel.chaos.user.entity.UserCredential;
import org.springframework.data.jpa.repository.JpaRepository;

public interface UserCredentialRepository extends JpaRepository<UserCredential, Long> {
}