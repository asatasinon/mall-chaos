package com.castrel.chaos.notification.dto;

import lombok.AllArgsConstructor;
import lombok.Data;

@Data
@AllArgsConstructor
public class NotificationPreferenceDTO {
    private Boolean email;
    private Boolean inApp;
}