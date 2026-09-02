package com.castrel.chaos.catalog.cache;

import com.castrel.chaos.catalog.dto.ProductDTO;
import com.fasterxml.jackson.annotation.JsonInclude;

@JsonInclude(JsonInclude.Include.NON_NULL)
public class ProductDetailCacheEnvelope {

    private int schemaVersion;
    private String sku;
    private String cachedAt;
    private String expiresAt;
    private ProductDTO product;
    private String padding;

    public int getSchemaVersion() {
        return schemaVersion;
    }

    public void setSchemaVersion(int schemaVersion) {
        this.schemaVersion = schemaVersion;
    }

    public String getSku() {
        return sku;
    }

    public void setSku(String sku) {
        this.sku = sku;
    }

    public String getCachedAt() {
        return cachedAt;
    }

    public void setCachedAt(String cachedAt) {
        this.cachedAt = cachedAt;
    }

    public String getExpiresAt() {
        return expiresAt;
    }

    public void setExpiresAt(String expiresAt) {
        this.expiresAt = expiresAt;
    }

    public ProductDTO getProduct() {
        return product;
    }

    public void setProduct(ProductDTO product) {
        this.product = product;
    }

    public String getPadding() {
        return padding;
    }

    public void setPadding(String padding) {
        this.padding = padding;
    }
}