package com.castrel.chaos.notification.service;

import com.castrel.chaos.common.BizException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;

class NotificationStorageGrowthWriterTest {
    @TempDir
    Path tempDirectory;

    @Test
    void appendsActualNonSparseBytesAndCleansRunFile() throws Exception {
        NotificationStorageGrowthWriter writer = new NotificationStorageGrowthWriter(tempDirectory.toString());
        String runId = UUID.randomUUID().toString();

        writer.prepare(runId);
        long size = writer.append(runId, 2048, 4096, 1);
        Path file = tempDirectory.resolve(runId + ".bin");
        byte[] content = Files.readAllBytes(file);

        assertEquals(2048, size);
        assertEquals(2048, Files.size(file));
        assertArrayEquals(new byte[] {(byte) 0xA5, (byte) 0xA5, (byte) 0xA5},
            Arrays.copyOf(content, 3));
        assertEquals(2048, writer.delete(runId));
        assertFalse(Files.exists(file));
    }

    @Test
    void stopsAtConfiguredTotalBytes() {
        NotificationStorageGrowthWriter writer = new NotificationStorageGrowthWriter(tempDirectory.toString());
        String runId = UUID.randomUUID().toString();

        writer.prepare(runId);
        assertEquals(1024, writer.append(runId, 1024, 2048, 1));
        assertEquals(2048, writer.append(runId, 1024, 2048, 1));
        BizException exception = assertThrows(BizException.class,
            () -> writer.append(runId, 1024, 2048, 1));

        assertEquals("STORAGE_CAPACITY_GUARD", exception.getErrorCode());
    }
}
