package com.castrel.chaos.catalog.cache;

public class ProductDetailCacheMarker {

    private int schemaVersion;
    private String faultRunId;
    private long fencingToken;
    private String hashKey;
    private String probeSku;
    private String expiresAt;

    public int getSchemaVersion() {
        return schemaVersion;
    }

    public void setSchemaVersion(int schemaVersion) {
        this.schemaVersion = schemaVersion;
    }

    public String getFaultRunId() {
        return faultRunId;
    }

    public void setFaultRunId(String faultRunId) {
        this.faultRunId = faultRunId;
    }

    public long getFencingToken() {
        return fencingToken;
    }

    public void setFencingToken(long fencingToken) {
        this.fencingToken = fencingToken;
    }

    public String getHashKey() {
        return hashKey;
    }

    public void setHashKey(String hashKey) {
        this.hashKey = hashKey;
    }

    public String getProbeSku() {
        return probeSku;
    }

    public void setProbeSku(String probeSku) {
        this.probeSku = probeSku;
    }

    public String getExpiresAt() {
        return expiresAt;
    }

    public void setExpiresAt(String expiresAt) {
        this.expiresAt = expiresAt;
    }
}