function clampScore(value, min = 0, max = 100) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return min;
  }
  return Math.max(min, Math.min(max, numeric));
}

function sigmoid(x) {
  const numeric = Number(x);
  if (!Number.isFinite(numeric)) {
    return 0.5;
  }
  return 1 / (1 + Math.exp(-numeric));
}

function computeSmoothedSentiment(sentimentRaw, previousSentiment = null) {
  const current = clampScore(sentimentRaw);
  if (!Number.isFinite(Number(previousSentiment))) {
    return Math.round(current);
  }
  const smoothed = current * 0.7 + clampScore(previousSentiment) * 0.3;
  return Math.round(clampScore(smoothed));
}

function computeEngagementIndex(unified = {}) {
  const slackCount = Number(unified?.sourceStats?.slackMessageCount || 0);
  const meetingTurns = Number(unified?.sourceStats?.meetingTurnCount || 0);
  const x = slackCount / 25 + meetingTurns / 12 - 2;
  return Math.round(clampScore(sigmoid(x) * 100));
}

function computeHrmsIndex(unified = {}) {
  const performanceScore = Number(unified?.hrms?.performance?.score || unified?.hrms?.performance?.overallScore || 70);
  const leaveDays = Number(unified?.hrms?.timeOff?.daysTaken || unified?.hrms?.timeOff?.usedDays || 0);
  const leavePenalty = clampScore(leaveDays * 2.5, 0, 35);
  const base = clampScore(performanceScore) - leavePenalty;
  return Math.round(clampScore(base));
}

function deriveSignalCounts(signals = []) {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  if (!Array.isArray(signals)) {
    return counts;
  }
  signals.forEach((item) => {
    const tier = String(item?.tier || "low").toLowerCase();
    if (counts[tier] !== undefined) {
      counts[tier] += 1;
    }
  });
  return counts;
}

function computeRiskLogitAndScore({ critical = 0, high = 0, medium = 0, low = 0 } = {}) {
  const logit = critical * 1.35 + high * 0.85 + medium * 0.4 + low * 0.1 - 2.1;
  const score = Math.round(clampScore(sigmoid(logit) * 100));
  return {
    riskLogit: Number(logit.toFixed(4)),
    riskScore: score,
  };
}

function computeHealthScore({ sentimentSmoothed, engagement, hrms, riskScore }) {
  const safety = clampScore(100 - Number(riskScore || 0));
  const weighted =
    clampScore(sentimentSmoothed) * 0.3 +
    safety * 0.4 +
    clampScore(engagement) * 0.2 +
    clampScore(hrms) * 0.1;
  return Math.round(clampScore(weighted));
}

function getHealthBand(score) {
  const safe = clampScore(score);
  if (safe <= 40) return "critical";
  if (safe <= 60) return "monitor";
  if (safe <= 80) return "healthy";
  return "thriving";
}

function deriveContributors({ sentimentSmoothed, engagement, hrms, riskScore }) {
  const riskPenalty = clampScore(Number(riskScore || 0));
  return {
    sentiment: Number((clampScore(sentimentSmoothed) * 0.3).toFixed(2)),
    engagement: Number((clampScore(engagement) * 0.2).toFixed(2)),
    hrms: Number((clampScore(hrms) * 0.1).toFixed(2)),
    retentionSafety: Number((clampScore(100 - riskPenalty) * 0.4).toFixed(2)),
  };
}

function computeConfidence({ sentiment, retention }) {
  const sSchema = sentiment?.schemaValid !== false;
  const rSchema = retention?.schemaValid !== false;
  const sFallbackPenalty = sentiment?.fallbackUsed ? 0.2 : 0;
  const rFallbackPenalty = retention?.fallbackUsed ? 0.25 : 0;
  const schemaPenalty = (sSchema ? 0 : 0.2) + (rSchema ? 0 : 0.2);
  const score = 1 - sFallbackPenalty - rFallbackPenalty - schemaPenalty;
  return Number(clampScore(score, 0, 1).toFixed(3));
}

function buildTemporalDeltas({ previousProfile, sentimentSmoothed, riskScore }) {
  const prevSentiment = Number(
    previousProfile?.analysis?.components?.sentimentSmoothed ??
      previousProfile?.analysis?.sentiment?.score ??
      sentimentSmoothed
  );
  const prevRisk = Number(
    previousProfile?.analysis?.components?.riskScore ??
      previousProfile?.analysis?.retentionRisk?.score ??
      riskScore
  );

  return {
    deltaSentiment7d: Number((clampScore(sentimentSmoothed) - clampScore(prevSentiment)).toFixed(2)),
    deltaRisk30d: Number((clampScore(riskScore) - clampScore(prevRisk)).toFixed(2)),
  };
}

function computeDeterministicScoring({ unified, sentiment = {}, retentionRisk = {}, previousProfile = null } = {}) {
  const sentimentRaw = Math.round(clampScore(sentiment?.score || 0));
  const sentimentSmoothed = computeSmoothedSentiment(
    sentimentRaw,
    previousProfile?.analysis?.components?.sentimentSmoothed ?? previousProfile?.analysis?.sentiment?.score
  );
  const engagement = computeEngagementIndex(unified);
  const hrms = computeHrmsIndex(unified);

  const signalCounts = deriveSignalCounts(retentionRisk?.signals || []);
  const riskBlend = computeRiskLogitAndScore(signalCounts);
  const llmRisk = clampScore(retentionRisk?.riskScore || 0);
  const riskScore = Math.round(clampScore(riskBlend.riskScore * 0.6 + llmRisk * 0.4));

  const healthScore = computeHealthScore({
    sentimentSmoothed,
    engagement,
    hrms,
    riskScore,
  });

  const contributors = deriveContributors({
    sentimentSmoothed,
    engagement,
    hrms,
    riskScore,
  });

  const confidence = computeConfidence({
    sentiment,
    retention: retentionRisk,
  });

  const temporal = buildTemporalDeltas({ previousProfile, sentimentSmoothed, riskScore });

  const extractionMeta = {
    sentimentFallbackUsed: Boolean(sentiment?.fallbackUsed),
    retentionFallbackUsed: Boolean(retentionRisk?.fallbackUsed),
    sentimentSchemaValid: sentiment?.schemaValid !== false,
    retentionSchemaValid: retentionRisk?.schemaValid !== false,
  };

  return {
    scoringVersion: "hybrid-v1",
    components: {
      sentimentRaw,
      sentimentSmoothed,
      engagement,
      hrms,
      riskLogit: riskBlend.riskLogit,
      riskScore,
      healthScore,
      contributors,
      confidence,
    },
    temporal,
    healthBand: getHealthBand(healthScore),
    retentionRiskScore: riskScore,
    extractionMeta,
  };
}

export {
  clampScore,
  sigmoid,
  computeSmoothedSentiment,
  computeEngagementIndex,
  computeHrmsIndex,
  deriveSignalCounts,
  computeRiskLogitAndScore,
  computeHealthScore,
  getHealthBand,
  deriveContributors,
  computeConfidence,
  buildTemporalDeltas,
  computeDeterministicScoring,
};
