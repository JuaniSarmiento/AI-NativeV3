"""Platform ops — scripts operacionales."""
from platform_ops.ab_testing import (
    ABComparisonReport,
    EpisodeForComparison,
    ProfileComparisonResult,
    compare_profiles,
)
from platform_ops.academic_export import (
    AcademicExporter,
    CohortDataset,
    EpisodeRecord,
)
from platform_ops.audit import (
    AccessEvent,
    AuditEngine,
    BruteForceRule,
    CrossTenantAccessRule,
    RepeatedAuthFailuresRule,
    Severity,
    SuspiciousAccess,
)
from platform_ops.export_worker import (
    ExportJob,
    ExportJobStore,
    ExportWorker,
    JobStatus,
)
from platform_ops.feature_flags import (
    FeatureFlags,
    FeatureNotDeclaredError,
    FlagsSnapshot,
)
from platform_ops.kappa_analysis import (
    CATEGORIES,
    KappaRating,
    KappaResult,
    compute_cohen_kappa,
    format_report,
)
from platform_ops.ldap_federation import (
    LDAPConfig,
    LDAPFederationError,
    LDAPFederationSpec,
    LDAPFederator,
    LDAPGroupMapping,
)
from platform_ops.adversarial_aggregation import (
    aggregate_adversarial_events,
)
from platform_ops.cii_alerts import (
    ALERTS_VERSION,
    MIN_STUDENTS_FOR_QUARTILES,
    compute_alerts_payload,
    compute_cohort_quartiles_payload,
    compute_cohort_slopes_stats,
    compute_student_alerts,
    position_in_quartiles,
)
from platform_ops.cii_longitudinal import (
    CII_LONGITUDINAL_VERSION,
    MIN_EPISODES_FOR_LONGITUDINAL,
    compute_cii_evolution_longitudinal,
    compute_evolution_per_template,
    compute_mean_slope,
)
from platform_ops.longitudinal import (
    APPROPRIATION_ORDINAL,
    ClassificationPoint,
    CohortProgression,
    StudentTrajectory,
    build_trajectories,
    summarize_cohort,
)
from platform_ops.privacy import (
    AnonymizationReport,
    ExportedData,
    anonymize_student,
    export_student_data,
)
from platform_ops.real_datasources import (
    RealCohortDataSource,
    RealLongitudinalDataSource,
    set_tenant_rls,
)
from platform_ops.tenant_onboarding import (
    KeycloakClient,
    KeycloakConfig,
    OnboardingReport,
    TenantOnboarder,
    TenantSpec,
)
from platform_ops.tenant_secrets import (
    SecretNotFoundError,
    TenantSecretConfig,
    TenantSecretResolver,
    get_resolver,
)

__all__ = [
    # Tenant onboarding
    "KeycloakClient", "KeycloakConfig",
    "TenantSpec", "TenantOnboarder", "OnboardingReport",
    # Privacy
    "ExportedData", "AnonymizationReport",
    "export_student_data", "anonymize_student",
    # Secrets
    "TenantSecretResolver", "TenantSecretConfig",
    "SecretNotFoundError", "get_resolver",
    # Feature flags
    "FeatureFlags", "FeatureNotDeclaredError", "FlagsSnapshot",
    # Academic research
    "AcademicExporter", "CohortDataset", "EpisodeRecord",
    "KappaRating", "KappaResult", "compute_cohen_kappa",
    "format_report", "CATEGORIES",
    # LDAP
    "LDAPConfig", "LDAPFederationSpec", "LDAPFederator",
    "LDAPGroupMapping", "LDAPFederationError",
    # Audit
    "AccessEvent", "AuditEngine", "BruteForceRule",
    "CrossTenantAccessRule", "RepeatedAuthFailuresRule",
    "Severity", "SuspiciousAccess",
    # Longitudinal (F7)
    "ClassificationPoint", "StudentTrajectory", "CohortProgression",
    "APPROPRIATION_ORDINAL", "build_trajectories", "summarize_cohort",
    # A/B testing (F7)
    "EpisodeForComparison", "ProfileComparisonResult",
    "ABComparisonReport", "compare_profiles",
    # Export worker (F7)
    "ExportJob", "ExportJobStore", "ExportWorker", "JobStatus",
    # Real DB datasources (F8)
    "RealCohortDataSource", "RealLongitudinalDataSource", "set_tenant_rls",
]
