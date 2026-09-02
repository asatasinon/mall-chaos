package com.castrel.chaos.catalog.repository;

import com.castrel.chaos.catalog.entity.Product;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.QueryHints;

import jakarta.persistence.QueryHint;
import java.util.List;
import java.util.Optional;

public interface ProductRepository extends JpaRepository<Product, Long> {

    @QueryHints(@QueryHint(name = "jakarta.persistence.query.timeout", value = "2000"))
    Optional<Product> findBySku(String sku);

    Page<Product> findByCategory(String category, Pageable pageable);

        Page<Product> findByCategoryAndNameContainingIgnoreCase(
            String category, String keyword, Pageable pageable);

        Page<Product> findByNameContainingIgnoreCase(String keyword, Pageable pageable);

    List<Product> findBySkuIn(List<String> skus);
}
