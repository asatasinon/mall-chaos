package com.castrel.chaos.user.service;

import com.castrel.chaos.common.BizException;
import com.castrel.chaos.common.security.JwtTokenService;
import com.castrel.chaos.user.dto.UserAddressDTO;
import com.castrel.chaos.user.dto.UserDTO;
import com.castrel.chaos.user.dto.AuthResponse;
import com.castrel.chaos.user.dto.LoginRequest;
import com.castrel.chaos.user.dto.RegisterRequest;
import com.castrel.chaos.user.dto.UserAddressRequest;
import com.castrel.chaos.user.entity.User;
import com.castrel.chaos.user.entity.UserAddress;
import com.castrel.chaos.user.entity.UserCredential;
import com.castrel.chaos.user.entity.UserRole;
import com.castrel.chaos.user.entity.SessionToken;
import com.castrel.chaos.user.repository.UserAddressRepository;
import com.castrel.chaos.user.repository.UserCredentialRepository;
import com.castrel.chaos.user.repository.UserRepository;
import com.castrel.chaos.user.repository.UserRoleRepository;
import com.castrel.chaos.user.repository.SessionTokenRepository;
import jakarta.transaction.Transactional;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;

@Service
public class UserService {

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private UserAddressRepository userAddressRepository;

    @Autowired
    private UserCredentialRepository userCredentialRepository;

    @Autowired
    private UserRoleRepository userRoleRepository;

    @Autowired
    private SessionTokenRepository sessionTokenRepository;

    @Autowired
    private JwtTokenService jwtTokenService;

    private final BCryptPasswordEncoder passwordEncoder = new BCryptPasswordEncoder();
    private final SecureRandom secureRandom = new SecureRandom();
    private static final Duration SESSION_TTL = Duration.ofDays(7);

    @Transactional
    public AuthResponse register(RegisterRequest request) {
        String email = normalize(request.getEmail());
        validateCredentials(email, request.getPassword(), request.getNickname());
        if (userRepository.findByEmail(email).isPresent()) {
            throw new BizException("EMAIL_ALREADY_EXISTS", "Email is already registered");
        }

        LocalDateTime now = LocalDateTime.now();
        User user = new User();
        user.setEmail(email);
        user.setNickname(request.getNickname().trim());
        user.setLevel(1);
        user.setStatus(1);
        user.setCreatedAt(now);
        user.setUpdatedAt(now);
        user = userRepository.save(user);

        UserCredential credential = new UserCredential();
        credential.setUserId(user.getId());
        credential.setPasswordHash(passwordEncoder.encode(request.getPassword()));
        credential.setCreatedAt(now);
        credential.setUpdatedAt(now);
        userCredentialRepository.save(credential);

        UserRole role = new UserRole();
        role.setUserId(user.getId());
        role.setRole("CUSTOMER");
        userRoleRepository.save(role);
        return createSession(user, List.of("CUSTOMER"));
    }

    @Transactional
    public AuthResponse login(LoginRequest request) {
        String email = normalize(request.getEmail());
        if (request.getPassword() == null || request.getPassword().isBlank()) {
            throw new BizException("INVALID_CREDENTIALS", "Invalid email or password");
        }
        User user = userRepository.findByEmail(email)
                .orElseThrow(() -> new BizException("INVALID_CREDENTIALS", "Invalid email or password"));
        UserCredential credential = userCredentialRepository.findById(user.getId())
                .orElseThrow(() -> new BizException("INVALID_CREDENTIALS", "Invalid email or password"));
        if (!Integer.valueOf(1).equals(user.getStatus())
                || credential.getRevokedAt() != null
                || !passwordEncoder.matches(request.getPassword(), credential.getPasswordHash())) {
            throw new BizException("INVALID_CREDENTIALS", "Invalid email or password");
        }
        List<String> roles = userRoleRepository.findByUserId(user.getId()).stream()
                .map(UserRole::getRole)
                .toList();
        return createSession(user, roles.isEmpty() ? List.of("CUSTOMER") : roles);
    }

    @Transactional
    public AuthResponse refresh(String sessionToken) {
        SessionToken current = findActiveSession(sessionToken);
        current.setRevokedAt(LocalDateTime.now());
        sessionTokenRepository.save(current);
        User user = userRepository.findById(current.getUserId())
                .orElseThrow(() -> new BizException("USER_NOT_FOUND", "User not found: " + current.getUserId()));
        List<String> roles = userRoleRepository.findByUserId(user.getId()).stream()
                .map(UserRole::getRole)
                .toList();
        return createSession(user, roles);
    }

    @Transactional
    public void logout(String sessionToken) {
        SessionToken session = findActiveSession(sessionToken);
        session.setRevokedAt(LocalDateTime.now());
        sessionTokenRepository.save(session);
    }

    private AuthResponse createSession(User user, List<String> roles) {
        String tokenId = UUID.randomUUID().toString();
        String rawToken = tokenId + "." + Long.toUnsignedString(secureRandom.nextLong());
        LocalDateTime expiresAt = LocalDateTime.now().plus(SESSION_TTL);
        SessionToken session = new SessionToken();
        session.setUserId(user.getId());
        session.setTokenId(tokenId);
        session.setTokenHash(hashToken(rawToken));
        session.setExpiresAt(expiresAt);
        session.setCreatedAt(LocalDateTime.now());
        sessionTokenRepository.save(session);
        return new AuthResponse(
            user.getId(), jwtTokenService.issueAccessToken(user.getId(), roles), rawToken, expiresAt, roles);
    }

    private SessionToken findActiveSession(String rawToken) {
        if (rawToken == null || rawToken.isBlank()) {
            throw new BizException("INVALID_SESSION", "Invalid session");
        }
        int separator = rawToken.indexOf('.');
        if (separator <= 0) {
            throw new BizException("INVALID_SESSION", "Invalid session");
        }
        String tokenId = rawToken.substring(0, separator);
        SessionToken session = sessionTokenRepository.findByTokenId(tokenId)
            .orElseThrow(() -> new BizException("INVALID_SESSION", "Invalid session"));
        if (!hashToken(rawToken).equals(session.getTokenHash())) {
            throw new BizException("INVALID_SESSION", "Invalid session");
        }
        if (session.getRevokedAt() != null || !session.getExpiresAt().isAfter(LocalDateTime.now())) {
            throw new BizException("INVALID_SESSION", "Invalid session");
        }
        return session;
    }

    private String hashToken(String rawToken) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(rawToken.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception exception) {
            throw new IllegalStateException("Unable to hash session token", exception);
        }
    }

    private void validateCredentials(String email, String password, String nickname) {
        if (email == null || !email.contains("@") || password == null || password.length() < 8
                || nickname == null || nickname.isBlank()) {
            throw new BizException("INVALID_REGISTRATION", "Email, nickname and an 8-character password are required");
        }
    }

    private String normalize(String email) {
        return email == null ? null : email.trim().toLowerCase();
    }

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

    @Transactional
    public List<UserAddressDTO> listAddresses(Long userId) {
        requireUser(userId);
        return userAddressRepository.findByUserIdOrderByIdAsc(userId).stream().map(this::toDTO).toList();
    }

    @Transactional
    public UserAddressDTO addAddress(Long userId, UserAddressRequest request) {
        requireUser(userId);
        validateAddress(request);
        UserAddress address = new UserAddress();
        address.setUserId(userId);
        copyAddress(address, request);
        address.setIsDefault(Boolean.TRUE.equals(request.getIsDefault()) ? 1 : 0);
        if (address.getIsDefault() == 1 || userAddressRepository.findByUserIdOrderByIdAsc(userId).isEmpty()) {
            clearDefault(userId);
            address.setIsDefault(1);
        }
        return toDTO(userAddressRepository.save(address));
    }

    @Transactional
    public UserAddressDTO updateAddress(Long userId, Long addressId, UserAddressRequest request) {
        requireUser(userId);
        validateAddress(request);
        UserAddress address = ownedAddress(userId, addressId);
        copyAddress(address, request);
        if (Boolean.TRUE.equals(request.getIsDefault())) {
            clearDefault(userId);
            address.setIsDefault(1);
        }
        return toDTO(userAddressRepository.save(address));
    }

    @Transactional
    public void deleteAddress(Long userId, Long addressId) {
        UserAddress address = ownedAddress(userId, addressId);
        boolean wasDefault = address.getIsDefault() == 1;
        userAddressRepository.delete(address);
        if (wasDefault) {
            userAddressRepository.findByUserIdOrderByIdAsc(userId).stream().findFirst()
                    .ifPresent(fallback -> {
                        fallback.setIsDefault(1);
                        userAddressRepository.save(fallback);
                    });
        }
    }

    private User requireUser(Long userId) {
        return userRepository.findById(userId)
                .orElseThrow(() -> new BizException("USER_NOT_FOUND", "User not found: " + userId));
    }

    private UserAddress ownedAddress(Long userId, Long addressId) {
        UserAddress address = userAddressRepository.findById(addressId)
                .orElseThrow(() -> new BizException("ADDRESS_NOT_FOUND", "Address not found: " + addressId));
        if (!userId.equals(address.getUserId())) {
            throw new BizException("ADDRESS_NOT_FOUND", "Address not found: " + addressId);
        }
        return address;
    }

    private void clearDefault(Long userId) {
        userAddressRepository.findByUserIdOrderByIdAsc(userId).forEach(address -> {
            address.setIsDefault(0);
            userAddressRepository.save(address);
        });
    }

    private void copyAddress(UserAddress address, UserAddressRequest request) {
        address.setProvince(request.getProvince().trim());
        address.setCity(request.getCity().trim());
        address.setDistrict(request.getDistrict());
        address.setDetail(request.getDetail().trim());
        address.setReceiver(request.getReceiver().trim());
        address.setPhone(request.getPhone().trim());
    }

    private void validateAddress(UserAddressRequest request) {
        if (request == null || request.getProvince() == null || request.getCity() == null
                || request.getDetail() == null || request.getReceiver() == null || request.getPhone() == null
                || request.getProvince().isBlank() || request.getCity().isBlank()
                || request.getDetail().isBlank() || request.getReceiver().isBlank() || request.getPhone().isBlank()) {
            throw new BizException("INVALID_ADDRESS", "Address fields are required");
        }
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
        dto.setId(a.getId());
        dto.setIsDefault(a.getIsDefault() == 1);
        dto.setProvince(a.getProvince());
        dto.setCity(a.getCity());
        dto.setDistrict(a.getDistrict());
        dto.setDetail(a.getDetail());
        dto.setReceiver(a.getReceiver());
        dto.setPhone(a.getPhone());
        return dto;
    }
}
