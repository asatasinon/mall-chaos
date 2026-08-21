package com.castrel.chaos.notification.dto;

import lombok.Data;

@Data
public class UpdateNotificationPreferenceRequest {
    private Boolean email;
    private Boolean inApp;
}