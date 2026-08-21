package com.castrel.chaos.fulfillment.repository;

import com.castrel.chaos.fulfillment.entity.FulfillmentOutboxEvent;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDateTime;
import java.util.List;

public interface FulfillmentOutboxRepository extends JpaRepository<FulfillmentOutboxEvent, Long> {
    @Query("""
	    select event from FulfillmentOutboxEvent event
	    where event.status in ('PENDING', 'FAILED')
	      and coalesce(event.attempts, 0) < 10
	      and (event.nextAttemptAt is null or event.nextAttemptAt <= :now)
	    order by event.id
	    """)
    List<FulfillmentOutboxEvent> findReady(@Param("now") LocalDateTime now, Pageable pageable);

    @Modifying
    @Query("""
	    update FulfillmentOutboxEvent event
	       set event.status = 'PROCESSING',
		   event.attempts = coalesce(event.attempts, 0) + 1
	     where event.id = :id
	       and event.status in ('PENDING', 'FAILED')
	       and coalesce(event.attempts, 0) < 10
	       and (event.nextAttemptAt is null or event.nextAttemptAt <= :now)
	    """)
    int claim(@Param("id") Long id, @Param("now") LocalDateTime now);
}
