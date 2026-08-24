package com.castrel.chaos.payment.repository;

import com.castrel.chaos.payment.entity.PaymentOutboxEvent;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDateTime;
import java.util.List;

public interface PaymentOutboxRepository extends JpaRepository<PaymentOutboxEvent, Long> {
        @Query("""
                        select event from PaymentOutboxEvent event
                        where (event.status in ('PENDING', 'FAILED')
                            or (event.status = 'PROCESSING' and event.nextAttemptAt <= :now))
                            and coalesce(event.attempts, 0) < 10
                            and (event.nextAttemptAt is null or event.nextAttemptAt <= :now)
                        order by event.id
                        """)
        List<PaymentOutboxEvent> findReady(@Param("now") LocalDateTime now, Pageable pageable);

        @Modifying
        @Query("""
                        update PaymentOutboxEvent event
                             set event.status = 'PROCESSING',
                                     event.attempts = coalesce(event.attempts, 0) + 1
                         where event.id = :id
                             and (event.status in ('PENDING', 'FAILED')
                                  or (event.status = 'PROCESSING' and event.nextAttemptAt <= :now))
                             and coalesce(event.attempts, 0) < 10
                             and (event.nextAttemptAt is null or event.nextAttemptAt <= :now)
                        """)
        int claim(@Param("id") Long id, @Param("now") LocalDateTime now);
}
