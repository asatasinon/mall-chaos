package com.castrel.chaos.fulfillment.repository;

import com.castrel.chaos.fulfillment.entity.Fulfillment;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface FulfillmentRepository extends JpaRepository<Fulfillment, Long> {

    Optional<Fulfillment> findByOrderId(Long orderId);
}
