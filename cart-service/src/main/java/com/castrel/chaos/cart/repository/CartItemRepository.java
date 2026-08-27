package com.castrel.chaos.cart.repository;

import com.castrel.chaos.cart.entity.CartItem;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface CartItemRepository extends JpaRepository<CartItem, Long> {
    List<CartItem> findByCartIdOrderByIdAsc(Long cartId);
    Optional<CartItem> findByCartIdAndSku(Long cartId, String sku);
    void deleteByCartId(Long cartId);
    void deleteByCartIdAndExerciseRunId(Long cartId, String exerciseRunId);
    long deleteByExerciseRunIdIsNotNull();
}
