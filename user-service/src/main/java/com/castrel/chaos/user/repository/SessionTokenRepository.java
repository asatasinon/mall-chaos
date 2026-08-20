package com.castrel.chaos.user.repository;

import com.castrel.chaos.user.entity.SessionToken;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface SessionTokenRepository extends JpaRepository<SessionToken, Long> {
    Optional<SessionToken> findByTokenId(String tokenId);
}