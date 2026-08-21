package com.castrel.chaos.fulfillment.repository;

import com.castrel.chaos.fulfillment.entity.FulfillmentOutboxEvent;
import org.springframework.data.jpa.repository.JpaRepository;

public interface FulfillmentOutboxRepository extends JpaRepository<FulfillmentOutboxEvent, Long> {
}
