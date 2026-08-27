package com.castrel.chaos.notification.repository;

import com.castrel.chaos.notification.entity.CustomerNotification;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CustomerNotificationRepository extends JpaRepository<CustomerNotification, Long> {
    Page<CustomerNotification> findByCustomerIdOrderByCreatedAtDesc(Long customerId, Pageable pageable);

    boolean existsByCustomerIdAndEventId(Long customerId, String eventId);

    long deleteByExerciseRunId(String exerciseRunId);
}
