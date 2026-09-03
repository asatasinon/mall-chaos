package com.castrel.chaos.order.repository;

import com.castrel.chaos.order.entity.Order;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;

public interface OrderRepository extends JpaRepository<Order, Long> {

    Optional<Order> findByOrderNo(String orderNo);

    Optional<Order> findByUserIdAndIdempotencyKey(Long userId, String idempotencyKey);

    List<Order> findAllByUserIdOrderByCreatedAtDesc(Long userId);

    Page<Order> findByUserIdOrderByCreatedAtDesc(Long userId, Pageable pageable);

    @Modifying(clearAutomatically = true)
    @Query("update Order o set o.status = 'CANCELLED', o.updatedAt = CURRENT_TIMESTAMP, o.version = o.version + 1 "
            + "where o.id = :id and o.version = :version and o.status in ('PENDING', 'PENDING_PAYMENT')")
    int cancelPending(@Param("id") Long id, @Param("version") Integer version);

        @Modifying(clearAutomatically = true)
        @Query("update Order o set o.status = 'PAID', o.paymentId = :paymentId, o.updatedAt = CURRENT_TIMESTAMP, "
            + "o.version = o.version + 1 where o.id = :id and o.version = :version and o.status = 'PENDING_PAYMENT'")
        int markPaid(@Param("id") Long id, @Param("version") Integer version, @Param("paymentId") String paymentId);

            @Modifying(clearAutomatically = true)
            @Query("update Order o set o.status = :status, o.paymentId = :paymentId, o.failReason = :failReason, "
                + "o.updatedAt = CURRENT_TIMESTAMP, o.version = o.version + 1 "
                + "where o.orderNo = :orderNo and o.version = :version and o.status = 'PENDING_PAYMENT'")
            int applyPaymentResult(@Param("orderNo") String orderNo, @Param("version") Integer version,
                       @Param("status") String status, @Param("paymentId") String paymentId,
                       @Param("failReason") String failReason);

            @Modifying(clearAutomatically = true)
            @Query("update Order o set o.status = 'PAYMENT_FAILED', o.failReason = 'RESERVATION_EXPIRED', "
                + "o.updatedAt = CURRENT_TIMESTAMP, o.version = o.version + 1 "
                + "where o.id = :id and o.version = :version and o.status = 'PENDING_PAYMENT'")
            int expirePending(@Param("id") Long id, @Param("version") Integer version);
}
