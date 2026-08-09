package com.castrel.chaos.common.storage;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

import javax.sql.DataSource;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.file.FileStore;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardOpenOption;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.Comparator;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

@Service
@ConditionalOnProperty(name = "chaos.endpoints.enabled", havingValue = "true", matchIfMissing = true)
public class StorageGrowthService {

    private static final String MYSQL = "mysql";
    private static final String FILESYSTEM = "filesystem";
    private static final String TABLE_NAME = "storage_growth_records";
    private static final String RUN_ID_PATTERN = "[A-Za-z0-9._-]{1,64}";
    private static final long DEFAULT_TARGET_BYTES = 16L * 1024 * 1024;
    private static final long DEFAULT_RATE_BYTES_PER_SEC = 1024L * 1024;
    private static final int DEFAULT_DURATION_SEC = 60;
    private static final long DEFAULT_MIN_FREE_BYTES = 1024L * 1024 * 1024;
    private static final int DEFAULT_MIN_FREE_PERCENT = 10;
    private static final long MAX_TARGET_BYTES = 10L * 1024 * 1024 * 1024;
    private static final long MAX_RATE_BYTES_PER_SEC = 100L * 1024 * 1024;
    private static final int MAX_DURATION_SEC = 3600;
    private static final int MAX_PAYLOAD_BYTES = 64 * 1024;

    private final DataSource dataSource;
    private final String sourceService;
    private final Path storageRoot;
    private final ScheduledExecutorService executor = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread thread = new Thread(r, "storage-growth-writer");
        thread.setDaemon(true);
        return thread;
    });
    private final AtomicReference<RunState> currentRun = new AtomicReference<>();

    public StorageGrowthService(
            DataSource dataSource,
            @Value("${spring.application.name:unknown}") String sourceService,
            @Value("${chaos.storage-growth.root:/service-data/storage-growth}") String storageRoot
    ) {
        this.dataSource = dataSource;
        this.sourceService = sourceService;
        this.storageRoot = Paths.get(storageRoot).toAbsolutePath().normalize();
    }

    public synchronized StorageGrowthStatus enable(StorageGrowthRequest request) {
        RunState existing = currentRun.get();
        if (existing != null && existing.status.equals("RUNNING")) {
            throw new IllegalStateException("A storage growth run is already active: " + existing.runId);
        }
        StorageGrowthRequest normalized = normalize(request);
        if (MYSQL.equals(normalized.storageType())) {
            ensureTable();
        }
        RunState state = new RunState(normalized, Instant.now());
        currentRun.set(state);
        state.task = executor.scheduleWithFixedDelay(() -> writeBatch(state), 0, 100, TimeUnit.MILLISECONDS);
        return toStatus(state);
    }

    public synchronized StorageGrowthStatus disable() {
        RunState state = currentRun.get();
        if (state == null || !state.status.equals("RUNNING")) {
            return state == null ? idleStatus() : toStatus(state);
        }
        stop(state, "STOPPED", "MANUAL_DISABLE");
        return toStatus(state);
    }

    public synchronized StorageGrowthStatus cleanup(String runId, String storageType) {
        validateRunId(runId);
        String normalizedType = normalizeStorageType(storageType);
        try {
            if (MYSQL.equals(normalizedType)) {
                try (Connection connection = dataSource.getConnection();
                     PreparedStatement statement = connection.prepareStatement(
                             "DELETE FROM " + TABLE_NAME + " WHERE run_id = ? AND source_service = ?")) {
                    statement.setString(1, runId);
                    statement.setString(2, sourceService);
                    statement.executeUpdate();
                }
            } else {
                deleteRunDirectory(runId);
            }
        } catch (SQLException | IOException exception) {
            throw new IllegalStateException("Failed to cleanup storage growth run " + runId, exception);
        }
        RunState state = currentRun.get();
        if (state != null && state.runId.equals(runId) && !state.status.equals("RUNNING")) {
            currentRun.compareAndSet(state, null);
        }
        return currentRun.get() == null ? idleStatus() : toStatus(currentRun.get());
    }

    public StorageGrowthStatus status() {
        RunState state = currentRun.get();
        return state == null ? idleStatus() : toStatus(state);
    }

    private void writeBatch(RunState state) {
        if (!state.status.equals("RUNNING")) {
            return;
        }
        try {
            if (Instant.now().isAfter(state.autoStopAt)) {
                stop(state, "STOPPED", "DURATION_EXPIRED");
                return;
            }
            FreeSpace freeSpace = MYSQL.equals(state.storageType) ? queryMysqlFreeSpace() : queryFileFreeSpace();
            state.freeSpaceBytes = freeSpace.bytes;
            boolean belowPercentGuard = freeSpace.totalBytes > 0
                    && freeSpace.bytes * 100L < freeSpace.totalBytes * state.minFreePercent;
            if (freeSpace.bytes < state.minFreeBytes || belowPercentGuard) {
                stop(state, "SPACE_GUARD", "MIN_FREE_SPACE");
                return;
            }
            long remaining = state.targetBytes - state.writtenBytes;
            if (remaining <= 0) {
                stop(state, "COMPLETED", "TARGET_REACHED");
                return;
            }
            int payloadSize = (int) Math.min(Math.min(remaining, MAX_PAYLOAD_BYTES),
                    Math.max(1024, state.rateBytesPerSec / 10));
            byte[] payload = new byte[payloadSize];
            ByteBuffer.wrap(payload).putLong(System.nanoTime());
            if (MYSQL.equals(state.storageType)) {
                writeMysql(state, payload);
            } else {
                writeFile(state, payload);
            }
            state.writtenBytes += payloadSize;
            state.writtenRows++;
            if (state.writtenBytes >= state.targetBytes) {
                stop(state, "COMPLETED", "TARGET_REACHED");
            }
        } catch (Exception exception) {
            stop(state, "ERROR", exception.getClass().getSimpleName());
        }
    }

    private void writeMysql(RunState state, byte[] payload) throws SQLException {
        try (Connection connection = dataSource.getConnection();
             PreparedStatement statement = connection.prepareStatement(
                     "INSERT INTO " + TABLE_NAME + " (run_id, source_service, payload) VALUES (?, ?, ?)")) {
            statement.setString(1, state.runId);
            statement.setString(2, sourceService);
            statement.setBytes(3, payload);
            statement.executeUpdate();
        }
    }

    private void writeFile(RunState state, byte[] payload) throws IOException {
        Path runDirectory = runDirectory(state.runId);
        Files.createDirectories(runDirectory);
        Path file = runDirectory.resolve("data.bin").normalize();
        if (!file.startsWith(runDirectory)) {
            throw new IOException("Invalid storage growth path");
        }
        Files.write(file, payload, StandardOpenOption.CREATE, StandardOpenOption.APPEND);
    }

    private FreeSpace queryMysqlFreeSpace() {
        try (Connection connection = dataSource.getConnection();
             PreparedStatement statement = connection.prepareStatement("SELECT @@datadir");
             ResultSet result = statement.executeQuery()) {
            if (!result.next()) {
                return new FreeSpace(Long.MAX_VALUE, 0);
            }
            FileStore fileStore = Files.getFileStore(Paths.get(result.getString(1)).toAbsolutePath().normalize());
            return new FreeSpace(fileStore.getUsableSpace(), fileStore.getTotalSpace());
        } catch (Exception exception) {
            return new FreeSpace(Long.MAX_VALUE, 0);
        }
    }

    private FreeSpace queryFileFreeSpace() {
        try {
            FileStore fileStore = Files.getFileStore(storageRoot);
            return new FreeSpace(fileStore.getUsableSpace(), fileStore.getTotalSpace());
        } catch (IOException exception) {
            return new FreeSpace(Long.MAX_VALUE, 0);
        }
    }

    private void deleteRunDirectory(String runId) throws IOException {
        Path runDirectory = runDirectory(runId);
        if (!Files.exists(runDirectory)) {
            return;
        }
        try (var paths = Files.walk(runDirectory)) {
            paths.sorted(Comparator.reverseOrder()).forEach(path -> {
                try {
                    Files.deleteIfExists(path);
                } catch (IOException exception) {
                    throw new CleanupException(exception);
                }
            });
        } catch (CleanupException exception) {
            throw exception.exception;
        }
    }

    private Path runDirectory(String runId) {
        Path directory = storageRoot.resolve(runId).normalize();
        if (!directory.startsWith(storageRoot)) {
            throw new IllegalArgumentException("Invalid runId path");
        }
        return directory;
    }

    private void ensureTable() {
        try (Connection connection = dataSource.getConnection();
             PreparedStatement statement = connection.prepareStatement("""
                     CREATE TABLE IF NOT EXISTS storage_growth_records (
                         id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                         run_id VARCHAR(64) NOT NULL,
                         source_service VARCHAR(64) NOT NULL,
                         payload VARBINARY(65535) NOT NULL,
                         created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                         INDEX idx_storage_growth_run_id (run_id),
                         INDEX idx_storage_growth_source_service (source_service)
                     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                     """)) {
            statement.executeUpdate();
        } catch (SQLException exception) {
            throw new IllegalStateException("Failed to initialize storage growth table", exception);
        }
    }

    private StorageGrowthRequest normalize(StorageGrowthRequest request) {
        if (request == null) {
            request = new StorageGrowthRequest(null, MYSQL, null, 0, 0, 0, 0, null);
        }
        String targetService = request.targetService() == null || request.targetService().isBlank()
                ? sourceService : request.targetService();
        if (!sourceService.equals(targetService)) {
            throw new IllegalArgumentException("targetService does not match the receiving service");
        }
        String storageType = normalizeStorageType(request.storageType());
        String runId = request.runId() == null || request.runId().isBlank()
                ? "storage-" + UUID.randomUUID().toString().substring(0, 8) : request.runId();
        validateRunId(runId);
        long targetBytes = request.targetBytes() > 0 ? request.targetBytes() : DEFAULT_TARGET_BYTES;
        long rateBytes = request.rateBytesPerSec() > 0 ? request.rateBytesPerSec() : DEFAULT_RATE_BYTES_PER_SEC;
        int durationSec = request.durationSec() > 0 ? request.durationSec() : DEFAULT_DURATION_SEC;
        long minFreeBytes = request.minFreeBytes() > 0 ? request.minFreeBytes() : DEFAULT_MIN_FREE_BYTES;
        int minFreePercent = request.minFreePercent() == null ? DEFAULT_MIN_FREE_PERCENT : request.minFreePercent();
        if (targetBytes > MAX_TARGET_BYTES || rateBytes > MAX_RATE_BYTES_PER_SEC || durationSec > MAX_DURATION_SEC
                || minFreeBytes <= 0 || minFreePercent < 0 || minFreePercent > 99) {
            throw new IllegalArgumentException("Storage growth parameters exceed safety limits");
        }
        return new StorageGrowthRequest(targetService, storageType, runId, targetBytes, rateBytes,
                durationSec, minFreeBytes, minFreePercent);
    }

    private String normalizeStorageType(String storageType) {
        String normalized = storageType == null || storageType.isBlank() ? MYSQL : storageType.toLowerCase();
        if (!MYSQL.equals(normalized) && !FILESYSTEM.equals(normalized)) {
            throw new IllegalArgumentException("storageType must be mysql or filesystem");
        }
        return normalized;
    }

    private void validateRunId(String runId) {
        if (runId == null || !runId.matches(RUN_ID_PATTERN) || runId.contains("..")) {
            throw new IllegalArgumentException("Invalid runId");
        }
    }

    private void stop(RunState state, String status, String reason) {
        synchronized (state) {
            if (!state.status.equals("RUNNING")) {
                return;
            }
            state.status = status;
            state.stopReason = reason;
            state.stoppedAt = Instant.now();
            if (state.task != null) {
                state.task.cancel(false);
            }
        }
    }

    private StorageGrowthStatus toStatus(RunState state) {
        return new StorageGrowthStatus(state.runId, state.status, state.targetBytes, state.writtenBytes,
                state.writtenRows, state.rateBytesPerSec, state.startedAt, state.stoppedAt, state.autoStopAt,
                state.stopReason, state.freeSpaceBytes, state.storageType, state.targetService, sourceService);
    }

    private StorageGrowthStatus idleStatus() {
        return new StorageGrowthStatus("", "IDLE", 0, 0, 0, 0, null, null, null, "", 0,
                MYSQL, sourceService, sourceService);
    }

    private static final class RunState {
        private final String targetService;
        private final String storageType;
        private final String runId;
        private final long targetBytes;
        private final long rateBytesPerSec;
        private final long minFreeBytes;
        private final int minFreePercent;
        private final Instant startedAt;
        private final Instant autoStopAt;
        private volatile String status = "RUNNING";
        private volatile long writtenBytes;
        private volatile long writtenRows;
        private volatile Instant stoppedAt;
        private volatile String stopReason = "";
        private volatile long freeSpaceBytes;
        private volatile ScheduledFuture<?> task;

        private RunState(StorageGrowthRequest request, Instant startedAt) {
            this.targetService = request.targetService();
            this.storageType = request.storageType();
            this.runId = request.runId();
            this.targetBytes = request.targetBytes();
            this.rateBytesPerSec = request.rateBytesPerSec();
            this.minFreeBytes = request.minFreeBytes();
            this.minFreePercent = request.minFreePercent();
            this.startedAt = startedAt;
            this.autoStopAt = startedAt.plusSeconds(request.durationSec());
        }
    }

    private record FreeSpace(long bytes, long totalBytes) {
    }

    private static final class CleanupException extends RuntimeException {
        private final IOException exception;

        private CleanupException(IOException exception) {
            this.exception = exception;
        }
    }
}
