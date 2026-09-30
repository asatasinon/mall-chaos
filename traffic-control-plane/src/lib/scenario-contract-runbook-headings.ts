import type {
  ScenarioContractLocale,
  ScenarioRunbookHeadingId,
} from './scenario-contract-validator';

export const SCENARIO_CONTRACT_RUNBOOK_HEADING_TEXT: Readonly<Record<
  ScenarioContractLocale,
  Readonly<Record<ScenarioRunbookHeadingId, string>>
>> = {
  en: {
    PURPOSE_AND_FIXED_TARGET: 'Purpose and fixed target',
    ACTUAL_IMPLEMENTATION: 'Actual implementation',
    PARAMETERS_AND_LIFECYCLE: 'Parameters and lifecycle',
    IMPACT_AND_EXCLUSIONS: 'Impact and exclusions',
    EVIDENCE: 'Evidence',
    TEMPO_INVESTIGATION: 'Tempo investigation',
    RECOVERY_AND_VERIFICATION: 'Recovery and verification',
    LIMITS_AND_SAFE_INTERPRETATION: 'Limits and safe interpretation',
    ALERTS: 'Alert mapping',
  },
  'zh-CN': {
    PURPOSE_AND_FIXED_TARGET: '目的与固定目标',
    ACTUAL_IMPLEMENTATION: '实际实现逻辑',
    PARAMETERS_AND_LIFECYCLE: '参数与生命周期',
    IMPACT_AND_EXCLUSIONS: '影响范围与排除项',
    EVIDENCE: '证据与判断',
    TEMPO_INVESTIGATION: 'Tempo 排障',
    RECOVERY_AND_VERIFICATION: '恢复与验证',
    LIMITS_AND_SAFE_INTERPRETATION: '限制与安全解释',
    ALERTS: '告警关联',
  },
};
