package com.castrel.chaos.cart.service;

import com.castrel.chaos.cart.client.CatalogProductClient;
import com.castrel.chaos.cart.dto.CartItemRequest;
import com.castrel.chaos.cart.entity.Cart;
import com.castrel.chaos.cart.entity.CartItem;
import com.castrel.chaos.cart.repository.CartItemRepository;
import com.castrel.chaos.cart.repository.CartRepository;
import com.castrel.chaos.common.BizException;
import com.castrel.chaos.common.coordination.ScenarioRunGuard;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.HttpHeaders;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class CartServiceExerciseContextTest {

    @Mock
    private CartRepository cartRepository;

    @Mock
    private CartItemRepository itemRepository;

    @Mock
    private StringRedisTemplate redisTemplate;

    @Mock
    private CatalogProductClient catalogProductClient;

    @Mock
    private ScenarioRunGuard scenarioRunGuard;

    private CartService cartService;

    @BeforeEach
    void setUp() {
        cartService = new CartService(
                cartRepository,
                itemRepository,
                redisTemplate,
                new SimpleMeterRegistry(),
                catalogProductClient,
                scenarioRunGuard);
    }

    @Test
    void nonCartScenarioUsesNormalCartPath() {
        Cart cart = activeCart(7L, 1L);
        CartItem item = cartItem(13L, cart.getId(), "sku-1", 1);
        when(cartRepository.findByCustomerIdAndStatus(7L, "ACTIVE")).thenReturn(Optional.of(cart));
        when(itemRepository.findByCartIdAndSku(cart.getId(), "sku-1")).thenReturn(Optional.of(item));
        when(itemRepository.findByCartIdOrderByIdAsc(cart.getId())).thenReturn(List.of(item));
        when(cartRepository.save(cart)).thenReturn(cart);

        assertThatCode(() -> cartService.addItem(7L, itemRequest(), "PSP_PROVIDER_OUTCOME", new HttpHeaders()))
                .doesNotThrowAnyException();

        verify(catalogProductClient).requireListed("sku-1");
        verify(itemRepository).save(item);
        verifyNoInteractions(scenarioRunGuard, redisTemplate);
    }

    @Test
    void cartLargeValueScenarioStillRequiresSam() {
        assertThatThrownBy(() -> cartService.addItem(7L, itemRequest(), "CART_REDIS_LARGE_VALUE", new HttpHeaders()))
                .isInstanceOf(BizException.class)
                .hasMessage("Only Sam's active exercise cart may use this path");

        verifyNoInteractions(cartRepository, itemRepository, redisTemplate, catalogProductClient, scenarioRunGuard);
    }

    private Cart activeCart(Long customerId, Long cartId) {
        Cart cart = new Cart();
        cart.setId(cartId);
        cart.setCustomerId(customerId);
        cart.setVersion(0);
        cart.setStatus("ACTIVE");
        return cart;
    }

    private CartItem cartItem(Long itemId, Long cartId, String sku, int quantity) {
        CartItem item = new CartItem();
        item.setId(itemId);
        item.setCartId(cartId);
        item.setSku(sku);
        item.setQuantity(quantity);
        return item;
    }

    private CartItemRequest itemRequest() {
        CartItemRequest request = new CartItemRequest();
        request.setSku("sku-1");
        request.setQuantity(1);
        return request;
    }
}