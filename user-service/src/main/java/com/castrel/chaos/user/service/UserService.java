package com.castrel.chaos.user.service;

import com.castrel.chaos.common.BizException;
import com.castrel.chaos.user.dto.UserAddressDTO;
import com.castrel.chaos.user.dto.UserDTO;
import com.castrel.chaos.user.entity.User;
import com.castrel.chaos.user.entity.UserAddress;
import com.castrel.chaos.user.repository.UserAddressRepository;
import com.castrel.chaos.user.repository.UserRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

@Service
public class UserService {

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private UserAddressRepository userAddressRepository;

    public UserDTO getUser(Long id) {
        User user = userRepository.findById(id)
                .orElseThrow(() -> new BizException("USER_NOT_FOUND", "User not found: " + id));
        return toDTO(user);
    }

    public UserAddressDTO getDefaultAddress(Long userId) {
        // ensure user exists
        userRepository.findById(userId)
                .orElseThrow(() -> new BizException("USER_NOT_FOUND", "User not found: " + userId));
        UserAddress addr = userAddressRepository
                .findFirstByUserIdAndIsDefault(userId, 1)
                .orElseThrow(() -> new BizException("ADDRESS_NOT_FOUND",
                        "No default address for user: " + userId));
        return toDTO(addr);
    }

    private UserDTO toDTO(User u) {
        UserDTO dto = new UserDTO();
        dto.setId(u.getId());
        dto.setNickname(u.getNickname());
        dto.setLevel(u.getLevel());
        dto.setStatus(u.getStatus());
        dto.setEmail(u.getEmail());
        return dto;
    }

    private UserAddressDTO toDTO(UserAddress a) {
        UserAddressDTO dto = new UserAddressDTO();
        dto.setProvince(a.getProvince());
        dto.setCity(a.getCity());
        dto.setDistrict(a.getDistrict());
        dto.setDetail(a.getDetail());
        dto.setReceiver(a.getReceiver());
        dto.setPhone(a.getPhone());
        return dto;
    }
}
