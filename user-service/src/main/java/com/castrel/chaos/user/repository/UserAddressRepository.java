package com.castrel.chaos.user.repository;

import com.castrel.chaos.user.entity.UserAddress;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface UserAddressRepository extends JpaRepository<UserAddress, Long> {

    Optional<UserAddress> findFirstByUserIdAndIsDefault(Long userId, Integer isDefault);
}
