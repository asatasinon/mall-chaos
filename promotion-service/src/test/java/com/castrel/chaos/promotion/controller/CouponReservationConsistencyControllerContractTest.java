package com.castrel.chaos.promotion.controller;

import com.castrel.chaos.common.coordination.OperationRunContext;
import com.castrel.chaos.common.coordination.OperationRunGuard;
import com.castrel.chaos.promotion.service.CouponReservationConsistencyService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpHeaders;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;

import javax.sql.DataSource;
import java.time.Instant;
import java.util.Arrays;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;

@ExtendWith(MockitoExtension.class)
class CouponReservationConsistencyControllerContractTest {

    private static final String RUN_ID = "123e4567-e89b-12d3-a456-426614174000";

    @Mock
    private CouponReservationConsistencyService reservationService;

    private CouponReservationConsistencyController controller;

    @BeforeEach
    void setUp() {
        controller = new CouponReservationConsistencyController(reservationService);
    }

    @Test
    void exposesTheCataloguedReservationLifecycleRoutes() {
        assertThat(postRoutes(CouponReservationConsistencyController.class)).contains(
                "/internal/promotion/coupons/reservations/prepare",
                "/internal/promotion/coupons/reservations/release",
                "/internal/promotion/coupons/reservations/remove");
    }

    @Test
    void forwardsFullLifecycleContextAndAllowsMinimalCleanupContext() {
        HttpHeaders fullHeaders = fullContext();
        HttpHeaders cleanupHeaders = cleanupContext();
        OperationRunContext fullContext = OperationRunContext.fromHeaders(fullHeaders);
        OperationRunContext cleanupContext = OperationRunContext.fromHeaders(cleanupHeaders);

        var prepare = controller.prepare(fullHeaders);
        var release = controller.release(fullHeaders);
        var cleanup = controller.remove(cleanupHeaders);

        assertEnvelope(prepare.getCode(), prepare.getMessage());
        assertThat(prepare.getData()).containsEntry("accepted", true)
                .containsEntry("operation", "coupon-reservation-consistency");
        assertEnvelope(release.getCode(), release.getMessage());
        assertThat(release.getData()).containsEntry("released", true).containsEntry("runId", RUN_ID);
        assertEnvelope(cleanup.getCode(), cleanup.getMessage());
        assertThat(cleanup.getData()).containsEntry("cleaned", true);
        verify(reservationService).prepare(fullContext);
        verify(reservationService).release(fullContext);
        verify(reservationService).cleanupPreparedReservation(cleanupContext);
    }

    @Test
    void realCleanupAcceptsMinimalContextAndRejectsMissingFence() {
        var guard = mock(OperationRunGuard.class);
        var service = new CouponReservationConsistencyService(
                mock(org.springframework.jdbc.core.JdbcTemplate.class), mock(DataSource.class), guard);
        var realController = new CouponReservationConsistencyController(service);
        HttpHeaders cleanupHeaders = cleanupContext();
        OperationRunContext cleanupContext = OperationRunContext.fromHeaders(cleanupHeaders);

        var response = realController.remove(cleanupHeaders);

        assertEnvelope(response.getCode(), response.getMessage());
        assertThat(response.getData()).containsEntry("cleaned", true);
        verify(guard).release(cleanupContext);

        HttpHeaders invalidContext = new HttpHeaders();
        invalidContext.set("X-Operation-Run-Id", RUN_ID);
        assertThatThrownBy(() -> realController.remove(invalidContext))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Invalid operation cleanup context");
        verify(guard, times(1)).release(cleanupContext);
        verifyNoMoreInteractions(guard);
    }

    private static HttpHeaders fullContext() {
        HttpHeaders headers = cleanupContext();
        headers.set("X-Operation-Run-Expires-At", Instant.now().plusSeconds(600).toString());
        headers.set("X-Operation-Run-Idempotency-Key", "phase-three-coupon-001");
        return headers;
    }

    private static HttpHeaders cleanupContext() {
        HttpHeaders headers = new HttpHeaders();
        headers.set("X-Operation-Run-Id", RUN_ID);
        headers.set("X-Operation-Run-Fencing-Token", "7");
        return headers;
    }

    private static Set<String> postRoutes(Class<?> controllerType) {
        RequestMapping classMapping = controllerType.getAnnotation(RequestMapping.class);
        String prefix = classMapping == null || classMapping.value().length == 0
                ? "" : classMapping.value()[0];
        return Arrays.stream(controllerType.getDeclaredMethods())
                .map(method -> method.getAnnotation(PostMapping.class))
                .filter(Objects::nonNull)
                .flatMap(mapping -> Arrays.stream(mapping.value()))
                .map(path -> prefix + path)
                .collect(Collectors.toSet());
    }

    private static void assertEnvelope(int code, String message) {
        assertThat(code).isEqualTo(200);
        assertThat(message).isEqualTo("OK");
    }

}
