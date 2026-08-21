package com.castrel.chaos.cart.service;

import com.castrel.chaos.cart.dto.CartDTO;
import com.castrel.chaos.cart.dto.CartItemDTO;
import com.castrel.chaos.cart.dto.CartItemRequest;
import com.castrel.chaos.cart.dto.CheckoutFreezeDTO;
import com.castrel.chaos.cart.dto.CheckoutFreezeRequest;
import com.castrel.chaos.cart.entity.Cart;
import com.castrel.chaos.cart.entity.CartItem;
import com.castrel.chaos.cart.repository.CartItemRepository;
import com.castrel.chaos.cart.repository.CartRepository;
import com.castrel.chaos.common.BizException;
import jakarta.transaction.Transactional;
import org.springframework.stereotype.Service;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;

import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;
import java.time.Duration;

@Service
public class CartService {
    private static final String ACTIVE = "ACTIVE";

    private final CartRepository cartRepository;
    private final CartItemRepository itemRepository;
        private final StringRedisTemplate redisTemplate;
        private static final Duration FREEZE_TTL = Duration.ofMinutes(10);
        private static final DefaultRedisScript<Long> RELEASE_SCRIPT = new DefaultRedisScript<>(
            "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", Long.class);

    public CartService(CartRepository cartRepository, CartItemRepository itemRepository,
                       StringRedisTemplate redisTemplate) {
        this.cartRepository = cartRepository;
        this.itemRepository = itemRepository;
        this.redisTemplate = redisTemplate;
    }

    @Transactional
    public CartDTO getCart(Long customerId) {
        return toDto(getOrCreate(customerId));
    }

    @Transactional
    public CartDTO addItem(Long customerId, CartItemRequest request) {
        validateItem(request);
        Cart cart = getOrCreate(customerId);
        CartItem item = itemRepository.findByCartIdAndSku(cart.getId(), request.getSku().trim())
                .orElseGet(() -> newItem(cart, request.getSku().trim()));
        item.setQuantity(item.getQuantity() + request.getQuantity());
        item.setUpdatedAt(LocalDateTime.now());
        itemRepository.save(item);
        touch(cart);
        return toDto(cartRepository.save(cart));
    }

    @Transactional
    public CartDTO updateItem(Long customerId, Long itemId, CartItemRequest request) {
        validateItem(request);
        Cart cart = getOrCreate(customerId);
        CartItem item = ownedItem(cart, itemId);
        item.setQuantity(request.getQuantity());
        item.setUpdatedAt(LocalDateTime.now());
        itemRepository.save(item);
        touch(cart);
        return toDto(cartRepository.save(cart));
    }

    @Transactional
    public CartDTO removeItem(Long customerId, Long itemId) {
        Cart cart = getOrCreate(customerId);
        CartItem item = ownedItem(cart, itemId);
        itemRepository.delete(item);
        touch(cart);
        return toDto(cartRepository.save(cart));
    }

    @Transactional
    public CartDTO clear(Long customerId) {
        Cart cart = getOrCreate(customerId);
        itemRepository.deleteByCartId(cart.getId());
        touch(cart);
        return toDto(cartRepository.save(cart));
    }

    @Transactional
    public CheckoutFreezeDTO freeze(Long customerId, CheckoutFreezeRequest request) {
        if (request == null || request.getCheckoutId() == null || request.getCheckoutId().isBlank()
                || request.getCartId() == null || request.getCartVersion() == null) {
            throw new BizException("INVALID_CHECKOUT_FREEZE", "checkoutId, cartId and cartVersion are required");
        }
        Cart cart = cartRepository.findById(request.getCartId())
                .orElseThrow(() -> new BizException("CART_NOT_FOUND", "Cart not found"));
        if (!customerId.equals(cart.getCustomerId()) || !ACTIVE.equals(cart.getStatus())
                || !request.getCartVersion().equals(cart.getVersion())) {
            throw new BizException("CART_VERSION_CONFLICT", "Cart ownership or version mismatch");
        }
        String key = freezeKey(request.getCheckoutId());
        String token = UUID.randomUUID().toString();
        String value = customerId + ":" + cart.getId() + ":" + cart.getVersion() + ":" + token;
        Boolean acquired = redisTemplate.opsForValue().setIfAbsent(key, value, FREEZE_TTL);
        if (!Boolean.TRUE.equals(acquired)) {
            String existing = redisTemplate.opsForValue().get(key);
            if (existing == null || !existing.startsWith(customerId + ":" + cart.getId() + ":" + cart.getVersion() + ":")) {
                throw new BizException("CHECKOUT_ALREADY_FROZEN", "Checkout is already frozen");
            }
            token = existing.substring(existing.lastIndexOf(':') + 1);
        }
        List<CartItemDTO> items = itemRepository.findByCartIdOrderByIdAsc(cart.getId()).stream()
                .map(item -> new CartItemDTO(item.getId(), item.getSku(), item.getQuantity())).toList();
        return new CheckoutFreezeDTO(request.getCheckoutId(), token, cart.getId(), cart.getVersion(), items);
    }

    public void releaseFreeze(Long customerId, String checkoutId, String token) {
        String value = verifyFreeze(customerId, checkoutId, token);
        redisTemplate.execute(RELEASE_SCRIPT, List.of(freezeKey(checkoutId)), value);
    }

    @Transactional
    public void consumeFreeze(Long customerId, String checkoutId, String token) {
        String value = verifyFreeze(customerId, checkoutId, token);
        String[] parts = value.split(":", 4);
        Cart cart = cartRepository.findById(Long.valueOf(parts[1]))
                .orElseThrow(() -> new BizException("CART_NOT_FOUND", "Cart not found"));
        if (cart.getVersion().equals(Integer.valueOf(parts[2]))) {
            itemRepository.deleteByCartId(cart.getId());
            touch(cart);
            cartRepository.save(cart);
        }
        redisTemplate.execute(RELEASE_SCRIPT, List.of(freezeKey(checkoutId)), value);
    }

    private String verifyFreeze(Long customerId, String checkoutId, String token) {
        String value = redisTemplate.opsForValue().get(freezeKey(checkoutId));
        String expectedSuffix = ":" + token;
        if (value == null || !value.startsWith(customerId + ":") || !value.endsWith(expectedSuffix)) {
            throw new BizException("INVALID_CHECKOUT_FREEZE", "Invalid or expired checkout freeze");
        }
        return value;
    }

    private String freezeKey(String checkoutId) {
        return "cart:checkout-freeze:" + checkoutId;
    }

    private Cart getOrCreate(Long customerId) {
        return cartRepository.findByCustomerIdAndStatus(customerId, ACTIVE).orElseGet(() -> {
            Cart cart = new Cart();
            cart.setCustomerId(customerId);
            cart.setVersion(0);
            cart.setStatus(ACTIVE);
            cart.setCreatedAt(LocalDateTime.now());
            cart.setUpdatedAt(LocalDateTime.now());
            return cartRepository.save(cart);
        });
    }

    private CartItem newItem(Cart cart, String sku) {
        CartItem item = new CartItem();
        item.setCartId(cart.getId());
        item.setSku(sku);
        item.setQuantity(0);
        item.setCreatedAt(LocalDateTime.now());
        return item;
    }

    private CartItem ownedItem(Cart cart, Long itemId) {
        CartItem item = itemRepository.findById(itemId)
                .orElseThrow(() -> new BizException("CART_ITEM_NOT_FOUND", "Cart item not found"));
        if (!cart.getId().equals(item.getCartId())) {
            throw new BizException("CART_ITEM_NOT_FOUND", "Cart item not found");
        }
        return item;
    }

    private void validateItem(CartItemRequest request) {
        if (request == null || request.getSku() == null || request.getSku().isBlank()
                || request.getQuantity() == null || request.getQuantity() <= 0) {
            throw new BizException("INVALID_CART_ITEM", "sku and positive quantity are required");
        }
    }

    private void touch(Cart cart) {
        cart.setUpdatedAt(LocalDateTime.now());
    }

    private CartDTO toDto(Cart cart) {
        List<CartItemDTO> items = itemRepository.findByCartIdOrderByIdAsc(cart.getId()).stream()
                .map(item -> new CartItemDTO(item.getId(), item.getSku(), item.getQuantity()))
                .toList();
        return new CartDTO(cart.getId(), cart.getCustomerId(), cart.getVersion(), items);
    }
}
