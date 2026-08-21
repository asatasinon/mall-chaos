package com.castrel.chaos.common.observability;

import java.util.regex.Pattern;

public final class SensitiveDataSanitizer {
    private static final Pattern EMAIL = Pattern.compile("[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}");
    private static final Pattern TOKEN = Pattern.compile("(?i)(bearer\\s+|token[=:]\\s*)[^\\s,;]+", Pattern.MULTILINE);
    private static final Pattern PASSWORD = Pattern.compile("(?i)(password|passwd|secret|apiKey)[=:]\\s*[^\\s,;]+");

    private SensitiveDataSanitizer() {
    }

    public static String message(String value) {
        if (value == null) return null;
        String sanitized = EMAIL.matcher(value).replaceAll("[REDACTED_EMAIL]");
        sanitized = TOKEN.matcher(sanitized).replaceAll("[REDACTED_TOKEN]");
        return PASSWORD.matcher(sanitized).replaceAll("$1=[REDACTED]");
    }
}
