package com.castrel.chaos.common.coordination;

import java.util.Map;

/** Fixed ownership names used by target services when registering run cleanup. */
public final class ScenarioRunResources {
    private ScenarioRunResources() {
    }

    public static final Map<String, String> OWNERS = Map.of(
            "INVENTORY_TABLE_EXCLUSIVE", "inventory-lock-connection",
            "PSP_PROVIDER_OUTCOME", "psp-provider-state",
            "NOTIFICATION_STORAGE_APPEND", "notification-run-storage",
            "NOTIFICATION_HEAP_PRESSURE", "notification-retained-objects"
    );
}
