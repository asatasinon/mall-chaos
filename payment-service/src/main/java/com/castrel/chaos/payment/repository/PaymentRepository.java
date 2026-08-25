package com.castrel.chaos.payment.repository;

import com.castrel.chaos.payment.entity.Payment;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface PaymentRepository extends JpaRepository<Payment, Long> {

    Optional<Payment> findByOrderIdAndIdempotencyKey(Long orderId, String idempotencyKey);

    Optional<Payment> findByPaymentNo(String paymentNo);
}
