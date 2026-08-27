package com.castrel.chaos.common.management;

import javax.sql.DataSource;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.HealthIndicator;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.stereotype.Component;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;

@Component("schemaVersion")
@ConditionalOnClass(DataSource.class)
@ConditionalOnBean(DataSource.class)
public class SchemaVersionHealthIndicator implements HealthIndicator {

    private static final String VERSION_QUERY =
            "SELECT version FROM schema_version WHERE id = 1";

    private final DataSource dataSource;
    private final int expectedVersion;

    public SchemaVersionHealthIndicator(
            DataSource dataSource,
            @Value("${castrel.schema.expected-version:1}") int expectedVersion) {
        this.dataSource = dataSource;
        this.expectedVersion = expectedVersion;
    }

    @Override
    public Health health() {
        try (Connection connection = dataSource.getConnection();
             PreparedStatement statement = connection.prepareStatement(VERSION_QUERY);
             ResultSet resultSet = statement.executeQuery()) {
            if (!resultSet.next()) {
                return Health.down()
                        .withDetail("reason", "schema_version row is missing")
                        .withDetail("expectedVersion", expectedVersion)
                        .build();
            }

            int actualVersion = resultSet.getInt(1);
            if (actualVersion != expectedVersion) {
                return Health.down()
                        .withDetail("reason", "schema version mismatch")
                        .withDetail("expectedVersion", expectedVersion)
                        .withDetail("actualVersion", actualVersion)
                        .build();
            }

            return Health.up()
                    .withDetail("version", actualVersion)
                    .build();
        } catch (Exception exception) {
            return Health.down(exception)
                    .withDetail("expectedVersion", expectedVersion)
                    .build();
        }
    }
}