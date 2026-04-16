package com.castrel.chaos.runner.repository;

import com.castrel.chaos.runner.entity.RunnerProfile;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface RunnerProfileRepository extends JpaRepository<RunnerProfile, Long> {

    @Modifying
    @Query("UPDATE RunnerProfile p SET p.baseQps = :baseQps, p.peakMultiplier = :peakMultiplier, " +
           "p.cycleMinutes = :cycleMinutes, p.jitterPct = :jitterPct, p.version = p.version + 1 " +
           "WHERE p.id = 1 AND p.version = :version")
    int updateWithVersion(@Param("baseQps") int baseQps,
                          @Param("peakMultiplier") float peakMultiplier,
                          @Param("cycleMinutes") int cycleMinutes,
                          @Param("jitterPct") float jitterPct,
                          @Param("version") int version);
}
