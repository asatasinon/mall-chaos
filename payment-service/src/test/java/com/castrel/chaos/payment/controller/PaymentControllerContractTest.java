package com.castrel.chaos.payment.controller;

import com.castrel.chaos.payment.service.PaymentService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;

@ExtendWith(MockitoExtension.class)
class PaymentControllerContractTest {

    @Mock
    private PaymentService paymentService;

    @InjectMocks
    private PaymentController controller;

    @Test
    void customerConfirmationIgnoresRunnerPaymentStrategy() {
        controller.confirm(10L, 7L, "CUSTOMER", "FAILED");

        verify(paymentService).confirmIntent(10L, 7L, null, true);
        verifyNoMoreInteractions(paymentService);
    }
}