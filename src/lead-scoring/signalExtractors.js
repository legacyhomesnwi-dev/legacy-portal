// signalExtractors.js
// One test(property) => boolean per signal_type the engine can currently
// evaluate. A signal_type with no extractor here simply never fires — that's
// intentional and matches reality: most DATA_SOURCE_NEEDED/FUTURE signals
// don't have a data source feeding the property record yet. As each scraper
// ships, add its extractor here and flip the corresponding registry row's
// status in Supabase — the engine itself never needs to change.

const { getSubmarketTier } = require('./submarketTiers');

const EXTRACTORS = {
  // ---- Currently available (live data) ----
  OWN_ESTATE_TRUST_LLC: (p) => !!p.ownerIsEstateTrustOrLLC,
  OWN_ABSENTEE: (p) => !!p.isAbsenteeOwner,
  OWN_OUT_OF_STATE: (p) => !!p.isOutOfState,
  OWN_LONG_HOLD: (p) => (p.yearsOwned || 0) >= 20,

  TAX_DELINQUENT: (p) => (p.taxAmountDue || 0) > 0,
  TAX_MULTI_YEAR: (p) => (p.taxYearsDelinquent || 0) >= 2,
  TAX_HIGH_RATIO: (p) => p.assessedValue > 0 && (p.taxAmountDue || 0) / p.assessedValue > 0.04,
  TAX_VERY_LOW_VALUE: (p) => (p.assessedValue ?? Infinity) < 40000,
  // Superseded — kept only so old test fixtures referencing it don't error.
  // Registry row is inactive, so this never actually fires anymore.
  TAX_LOW_DISTRESSED_SUB: (p) =>
    (p.assessedValue ?? Infinity) < 80000 &&
    ['gary', 'hammond', 'east chicago'].includes((p.city || '').trim().toLowerCase()),

  // Submarket-aware replacement. Fires when assessed value is below the
  // relevant tier's threshold. Confidence reflects how confirmed that
  // threshold actually is: full confidence for Tier 1 (real buy-box number),
  // reduced for provisional Tier 2/3 extrapolations, lowest for cities that
  // don't fall into any known cap-rate tier at all (e.g. Cedar Lake).
  VAL_LOW_FOR_SUBMARKET: (p) => {
    const tier = getSubmarketTier(p.city);
    const fired = (p.assessedValue ?? Infinity) < tier.lowValueThreshold;
    if (!fired) return false;
    const confidence =
      tier.calibration === 'confirmed' ? 0.9 : tier.calibration === 'provisional' ? 0.55 : 0.35;
    return { fired: true, confidence };
  },

  OCC_RENTAL_ACTIVE_COMPLAINTS: (p) => !!p.isAbsenteeOwner && (p.openCodeViolations || 0) > 0,
  OCC_BOARDED: (p) => !!p.boardedWindowsOrDoors,

  COND_OPEN_VIOLATION: (p) => (p.openCodeViolations || 0) > 0,
  COND_MULTI_VIOLATION_STACK: (p) => (p.openCodeViolations || 0) >= 3,
  COND_CONDEMNED: (p) => !!p.condemned,
  COND_NEGLECT: (p) => !!p.overgrownOrNeglected,

  NBHD_VIOLATION_DENSITY: (p) => !!p.highViolationDensityBlock,
  NBHD_HIGH_RENTAL_DENSITY: (p) => !!p.highRentalDensityBlock,

  // ---- Data-source-needed / future, but wired for when test properties supply the field ----
  // (lets us test the engine's chain/stack logic ahead of the real scraper existing)
  OWN_FREE_AND_CLEAR: (p) => !!p.ownedFreeAndClear,
  OWN_RECENT_QUITCLAIM: (p) => !!p.recentQuitclaimTransfer,
  TAX_SALE_SCHEDULED: (p) => !!p.taxSaleScheduled,
  TAX_VALUE_DROPPED_YOY: (p) => !!p.assessedValueDroppedYoY,
  TAX_HOA_MECHANIC_LIEN: (p) => !!p.hoaOrMechanicLien,
  LEGAL_PRE_FORECLOSURE: (p) => !!p.preForeclosureFiled,
  LEGAL_SHERIFF_SALE_SCHEDULED: (p) => !!p.sheriffSaleScheduled,
  LEGAL_ZOMBIE_PROPERTY: (p) => !!p.isZombieProperty,
  LEGAL_BANKRUPTCY: (p) => !!p.bankruptcyFiled,
  LEGAL_DIVORCE: (p) => !!p.divorceFiled,
  LEGAL_PROBATE: (p) => !!p.probateFiled,
  LEGAL_JUDGMENT: (p) => !!p.judgmentFiled,
  LEGAL_LANDLORD_EVICTIONS: (p) => (p.evictionsFiled || 0) >= 2,
  OCC_VACANT: (p) => !!p.isVacant,
  OCC_USPS_UNDELIVERABLE: (p) => !!p.uspsUndeliverable,
  OCC_NO_HOMESTEAD: (p) => !!p.noHomesteadExemption,
  OCC_SQUATTER_REPORTED: (p) => !!p.squatterReported,
  OCC_VACANT_REGISTRATION: (p) => !!p.vacantPropertyRegistered,
  COND_OLD_NO_PERMITS: (p) => (p.yearBuiltAge || 0) >= 60 && !p.hasPermitHistory,
  MKT_STALE_FSBO: (p) => !!p.isFSBO && (p.daysOnMarket || 0) >= 90,
  MKT_FSBO_VACANT_RENTAL: (p) => !!p.fsboRentalVacant,
  MKT_PRICE_DROPS: (p) => (p.priceReductions || 0) >= 2,
  MKT_EXPIRED_MLS: (p) => !!p.mlsExpired,
  MKT_WITHDRAWN_CANCELED_MLS: (p) => !!p.mlsWithdrawnOrCanceled,
  MKT_RELISTED_NEW_AGENT: (p) => !!p.relistedNewAgent,
  MKT_BELOW_COMPS_PPSF: (p) => !!p.pricedBelowCompsPpsf,
  MKT_DOM_2X_AVERAGE: (p) => !!p.domDoubleSubmarketAvg,
  LIFE_INHERITED: (p) => !!p.inheritedSignal,
  LIFE_MEDICAL_LIEN: (p) => !!p.medicalLien,
  LIFE_CHILD_SUPPORT_LIEN: (p) => !!p.childSupportLien,
  LIFE_FEDERAL_STATE_TAX_LIEN: (p) => !!p.federalOrStateTaxLien,
  LIFE_JUDGMENT_LIEN: (p) => !!p.judgmentLienRecorded,
  NBHD_FLOOD_ZONE: (p) => !!p.inFloodZone,
  NBHD_ENV_CONTAMINATION: (p) => !!p.nearEnvironmentalContamination,
  NBHD_SHERIFF_SALE_CLUSTER: (p) => !!p.nearbySheriffSaleCluster,
  NBHD_DECLINING_COMPS: (p) => !!p.decliningSubmarketComps,
  NBHD_VACANT_LOT_NEARBY: (p) => !!p.vacantLotNearby,
  NBHD_RECENT_DISASTER_DECLARATION: (p) => !!p.recentDisasterDeclaration,

  // ---- Negative / disqualifying ----
  DISQ_DO_NOT_CONTACT: (p) => !!p.doNotContact,
  DISQ_RECENT_ARMS_LENGTH_SALE: (p) => !!p.recentArmsLengthSale,
  DISQ_ACTIVE_MARKET_LISTING: (p) => !!p.activeMarketListing,
  DISQ_ALREADY_SOLD: (p) => !!p.propertyAlreadySold,
  DISQ_FORECLOSURE_DISMISSED_RECENT: (p) => !!p.foreclosureDismissedRecent,

  // ---- NOT_APPROPRIATE signals: no automated extractor by design. These
  // only ever fire behind an explicit manualOverrideConfirmed flag — no
  // scraper should ever populate these fields on its own.
  OWN_MULTIPLE_HEIRS: (p) => (p.titleHolderCount || 0) >= 3 && !!p.manualOverrideConfirmed,
  OWN_DECEASED_NO_PROBATE: (p) => !!p.ownerDeceasedNoProbate && !!p.manualOverrideConfirmed,
  OCC_UTILITY_SHUTOFF: (p) => !!p.utilityShutoffSignal && !!p.manualOverrideConfirmed,
  COND_FIRE_DAMAGE: (p) => !!p.fireDamage && !!p.manualOverrideConfirmed,
  COND_ROOF_VISIBLE: (p) => !!p.visibleRoofDamage && !!p.manualOverrideConfirmed,
  COND_DAMAGE_REPORT: (p) => !!p.damageReportOnFile && !!p.manualOverrideConfirmed,
  LIFE_RELOCATION: (p) => !!p.relocationSignal && !!p.manualOverrideConfirmed,
  LIFE_SENIOR_OWNER: (p) => (p.ownerAge || 0) >= 70 && !!p.manualOverrideConfirmed,
  LIFE_MILITARY_PCS: (p) => !!p.militaryPcsSignal && !!p.manualOverrideConfirmed,
};

module.exports = { EXTRACTORS };
