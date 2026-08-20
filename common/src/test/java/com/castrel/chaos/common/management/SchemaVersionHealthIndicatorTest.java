package com.castrel.chaos.common.management;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;

import javax.sql.DataSource;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class SchemaVersionHealthIndicatorTest {

    private DataSource dataSource;
    private Connection connection;
    private PreparedStatement statement;
    private ResultSet resultSet;

    @BeforeEach
    void setUp() throws Exception {
        dataSource = mock(DataSource.class);
        connection = mock(Connection.class);
        statement = mock(PreparedStatement.class);
        resultSet = mock(ResultSet.class);

        when(dataSource.getConnection()).thenReturn(connection);
        when(connection.prepareStatement("SELECT version FROM schema_version WHERE id = 1"))
                .thenReturn(statement);
        when(statement.executeQuery()).thenReturn(resultSet);
    }

    @Test
    void reportsUpWhenExpectedVersionIsPresent() throws Exception {
        when(resultSet.next()).thenReturn(true);
        when(resultSet.getInt(1)).thenReturn(1);

        var health = new SchemaVersionHealthIndicator(dataSource, 1).health();

        assertThat(health.getStatus().getCode()).isEqualTo("UP");
        assertThat(health.getDetails()).containsEntry("version", 1);
    }

    @Test
    void reportsDownWhenVersionRowIsMissing() throws Exception {
        when(resultSet.next()).thenReturn(false);

        var health = new SchemaVersionHealthIndicator(dataSource, 1).health();

        assertThat(health.getStatus().getCode()).isEqualTo("DOWN");
        assertThat(health.getDetails()).containsEntry("reason", "schema_version row is missing");
    }

    @Test
    void reportsDownWhenVersionDoesNotMatch() throws Exception {
        when(resultSet.next()).thenReturn(true);
        when(resultSet.getInt(1)).thenReturn(2);

        var health = new SchemaVersionHealthIndicator(dataSource, 1).health();

        assertThat(health.getStatus().getCode()).isEqualTo("DOWN");
        assertThat(health.getDetails())
                .containsEntry("expectedVersion", 1)
                .containsEntry("actualVersion", 2);
    }
}