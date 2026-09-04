package com.castrel.chaos.notification.service;

import com.castrel.chaos.common.BizException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.FileStore;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.Arrays;
import java.util.UUID;
import java.util.stream.Stream;

@Component
public class NotificationStorageGrowthWriter {
    private static final String FILE_SUFFIX = ".bin";
    private static final byte[] FILL_BUFFER = createFillBuffer();

    private final Path rootDirectory;

    public NotificationStorageGrowthWriter(
            @Value("${notification.storage-growth.path:/service-data/storage-growth}") String rootDirectory) {
        this.rootDirectory = Path.of(rootDirectory).toAbsolutePath().normalize();
    }

    public synchronized void prepare(String runId) {
        fileFor(runId);
        try {
            Files.createDirectories(rootDirectory);
        } catch (IOException exception) {
            throw storageException("Failed to prepare notification storage growth directory", exception);
        }
    }

    public synchronized long append(String runId, long appendBytes, long totalBytes, long minFreeBytes) {
        Path file = fileFor(runId);
        try {
            Files.createDirectories(rootDirectory);
            long currentBytes = Files.exists(file) ? Files.size(file) : 0;
            if (currentBytes >= totalBytes) {
                throw new BizException("STORAGE_CAPACITY_GUARD", "Notification storage guard is active");
            }

            long bytesToWrite = Math.min(appendBytes, totalBytes - currentBytes);
            FileStore fileStore = Files.getFileStore(rootDirectory);
            long usableBytes = fileStore.getUsableSpace();
            if (usableBytes < bytesToWrite || usableBytes - bytesToWrite < minFreeBytes) {
                throw new BizException("STORAGE_CAPACITY_GUARD", "Notification storage guard is active");
            }

            try (FileChannel channel = FileChannel.open(file,
                    StandardOpenOption.CREATE, StandardOpenOption.WRITE, StandardOpenOption.APPEND)) {
                writeNonSparseBytes(channel, bytesToWrite);
                channel.force(true);
            }
            return Files.size(file);
        } catch (BizException exception) {
            throw exception;
        } catch (IOException exception) {
            throw storageException("Failed to append notification storage", exception);
        }
    }

    public synchronized long delete(String runId) {
        Path file = fileFor(runId);
        try {
            if (!Files.exists(file)) return 0;
            long size = Files.size(file);
            Files.delete(file);
            return size;
        } catch (IOException exception) {
            throw storageException("Failed to clean notification storage", exception);
        }
    }

    public synchronized long deleteAll() {
        if (!Files.isDirectory(rootDirectory)) return 0;
        long deletedBytes = 0;
        try (Stream<Path> files = Files.list(rootDirectory)) {
            for (Path file : files.filter(Files::isRegularFile).filter(this::isRunFile).toList()) {
                deletedBytes += Files.size(file);
                Files.deleteIfExists(file);
            }
            return deletedBytes;
        } catch (IOException exception) {
            throw storageException("Failed to clean notification storage", exception);
        }
    }

    private Path fileFor(String runId) {
        try {
            return rootDirectory.resolve(UUID.fromString(runId) + FILE_SUFFIX);
        } catch (IllegalArgumentException exception) {
            throw new BizException("INVALID_OPERATION_CONTEXT", "Invalid notification storage run ID", exception);
        }
    }

    private boolean isRunFile(Path file) {
        String name = file.getFileName().toString();
        if (!name.endsWith(FILE_SUFFIX)) return false;
        try {
            UUID.fromString(name.substring(0, name.length() - FILE_SUFFIX.length()));
            return true;
        } catch (IllegalArgumentException exception) {
            return false;
        }
    }

    private void writeNonSparseBytes(FileChannel channel, long bytesToWrite) throws IOException {
        long remaining = bytesToWrite;
        while (remaining > 0) {
            int chunkSize = (int) Math.min(remaining, FILL_BUFFER.length);
            ByteBuffer buffer = ByteBuffer.wrap(FILL_BUFFER, 0, chunkSize);
            while (buffer.hasRemaining()) {
                channel.write(buffer);
            }
            remaining -= chunkSize;
        }
    }

    private BizException storageException(String message, IOException exception) {
        return new BizException("STORAGE_APPEND_FAILED", message, exception);
    }

    private static byte[] createFillBuffer() {
        byte[] buffer = new byte[1024 * 1024];
        Arrays.fill(buffer, (byte) 0xA5);
        return buffer;
    }
}
