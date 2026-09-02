package com.castrel.chaos.catalog.controller;

import com.castrel.chaos.catalog.dto.ProductDTO;
import com.castrel.chaos.catalog.service.CatalogService;
import com.castrel.chaos.common.ApiResponse;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.util.ReflectionTestUtils;

import java.math.BigDecimal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class CatalogControllerTest {

    private CatalogService catalogService;
    private CatalogController controller;

    @BeforeEach
    void setUp() {
        catalogService = mock(CatalogService.class);
        controller = new CatalogController();
        ReflectionTestUtils.setField(controller, "catalogService", catalogService);
    }

    @Test
    void keepsProductResponseEnvelopeAndExposesOnlyCacheResultMetadata() {
        ProductDTO product = product("SKU-001");
        when(catalogService.getProductDetail("SKU-001"))
                .thenReturn(new CatalogService.ProductDetailResult(product, "CACHE_HIT"));
        MockHttpServletResponse response = new MockHttpServletResponse();

        ApiResponse<ProductDTO> result = controller.getProduct("SKU-001", response);

        assertThat(result.getCode()).isEqualTo(200);
        assertThat(result.getData()).isSameAs(product);
        assertThat(response.getHeader("X-Castrel-Cache-Result")).isEqualTo("CACHE_HIT");
        assertThat(result.getData()).isNotNull();
        assertThat(result.getData().toString()).doesNotContain("padding");
    }

    private ProductDTO product(String sku) {
        ProductDTO result = new ProductDTO();
        result.setId(1L);
        result.setSku(sku);
        result.setName("Product");
        result.setPrice(new BigDecimal("10.00"));
        result.setStatus(1);
        result.setCategory("Electronics");
        result.setAvailableQty(10);
        return result;
    }
}
