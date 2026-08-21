package com.castrel.chaos.notification.dto;

import lombok.AllArgsConstructor;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@AllArgsConstructor
public class CustomerNotificationDTO {
    private Long id;
    private String eventType;
    private String title;
    private String body;
    private Boolean read;
    private LocalDateTime createdAt;
    private LocalDateTime readAt;
}
