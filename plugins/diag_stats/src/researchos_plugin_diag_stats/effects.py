"""Effect sizes for stats_compare_groups. Undefined values are None; a CI is given only where its coverage was checked
by seeded simulation across effect magnitudes (tests), otherwise None with the reason in `ci_note`.

- Standardized mean differences (Student model d, paired d_z): exact noncentral-t inversion under the normal model.
- Welch: the unstandardized mean difference carries the CI (Welch-Satterthwaite); the standardized d_av has none.
- Rank-biserial (independent): r = 2 AUC - 1; CI = union of Newcombe (2006) method 5 and the DeLong logit interval.
- Rank-biserial (paired): point estimate only (its estimand depends on n; bootstrap intervals under-cover near +-1).
- eta^2: noncentral F inversion (ordinary ANOVA only); omega^2, epsilon^2: point estimates.
- Cramer's V: noncentral chi-square inversion. Odds ratio (2x2): conditional MLE with exact conditional CI.
"""

from __future__ import annotations

import math
from collections.abc import Callable

import numpy as np
from numpy.typing import NDArray
from scipy import optimize, stats

from ._common import interval
from .roc import delong

Vector = NDArray[np.float64]
MIN_N_RANK_CI = 6  # smallest group size with simulated coverage >= 0.95 over the tested grid (ADR-157)
Effect = dict[str, object]
REFS = {
    "hedges_g": "Hedges LV (1981) J Educ Stat 6:107-128; CI: noncentral t inversion, Steiger JH, Fouladi RT (1997) "
    "in Harlow et al., What If There Were No Significance Tests?, ch. 9",
    "d_z": "Cohen J (1988) Statistical Power Analysis, 2nd ed. (d_z = mean / SD of differences); CI: noncentral t "
    "inversion (Steiger & Fouladi 1997)",
    "d_av": "Cumming G (2012) Understanding the New Statistics (d_av, average-variance standardizer)",
    "rank_biserial": "Kerby DS (2014) Compr Psychol 3:11.IT.3.1 (r = 2 AUC - 1); CI: Newcombe RG (2006) Stat Med "
    "25:559-573, method 5",
    "eta_squared": "Steiger JH (2004) Psychol Methods 9:164-182 (noncentral F inversion); omega^2: Hays (1963)",
    "epsilon_squared": "Tomczak M, Tomczak E (2014) Trends Sport Sci 21:19-25 (epsilon^2_R for Kruskal-Wallis)",
    "cramers_v": "Cramer H (1946); CI by noncentral chi-square inversion: Smithson M (2003) Confidence Intervals, "
    "Sage, ch. 4",
    "odds_ratio": "Fisher RA (1935); conditional MLE and exact conditional CI: Cornfield J (1956)",
}


def effect(name: str, value: float | None, ci: list[float] | None, note: str | None = None, ref: str = "") -> Effect:
    out: Effect = {"name": name, "value": value, "ci": ci, "reference": ref or REFS.get(name, "")}
    if note:
        out["ci_note"] = note
    return out


def _root(f: Callable[[float], float], lo: float, hi: float) -> float:
    """Root of a decreasing f on an expanding bracket around [lo, hi]; the search range scales with the start
    bracket (review #40: a huge F needs a huge noncentrality)."""
    limit = 1e7 * max(1.0, abs(lo), abs(hi))
    while f(lo) < 0:
        lo = lo * 2 - 1 if lo <= 0 else lo / 2
        if lo < -limit:
            raise ValueError("interval search did not converge")
    while f(hi) > 0:
        hi = hi * 2 + 1 if hi >= 0 else hi / 2
        if hi > limit:
            raise ValueError("interval search did not converge")
    return float(optimize.brentq(f, lo, hi, xtol=1e-12))


def _nct_cdf(t: float, df: float, ncp: float) -> float:
    """P(T <= t | ncp). SciPy returns NaN deep in a tail (e.g. t = -3.7, df = 18, ncp = 6.3); there the mirror
    P(T >= -t | -ncp) is used, and the limiting 0 / 1 if both fail."""
    v = float(stats.nct.cdf(t, df, ncp))
    if math.isnan(v):
        v = float(stats.nct.sf(-t, df, -ncp))
    if math.isnan(v):
        v = 0.0 if ncp > t else 1.0
    return v


def nct_ci(t: float, df: float, conf: float) -> tuple[float, float]:
    """Noncentrality interval for an observed t: P(T <= t | ncp) = 1 - tail and = tail (cdf decreases in ncp)."""
    tail = (1.0 - conf) / 2.0
    lo = _root(lambda ncp: _nct_cdf(t, df, ncp) - (1.0 - tail), t - 10.0, t + 10.0)
    hi = _root(lambda ncp: _nct_cdf(t, df, ncp) - tail, t - 10.0, t + 10.0)
    return lo, hi


def hedges_g(a: Vector, b: Vector, conf: float) -> Effect:
    """Equal-variance model: g = J d (J = 1 - 3 / (4 df - 1)); CI for the population d from the Student t."""
    n1, n2 = len(a), len(b)
    df = n1 + n2 - 2
    pooled = math.sqrt(((n1 - 1) * a.var(ddof=1) + (n2 - 1) * b.var(ddof=1)) / df)
    if pooled == 0.0:
        return effect("hedges_g", None, None, "pooled SD is 0")
    d = (a.mean() - b.mean()) / pooled
    scale = math.sqrt(1 / n1 + 1 / n2)
    lo, hi = nct_ci(d / scale, df, conf)
    return effect(
        "hedges_g",
        (1.0 - 3.0 / (4.0 * df - 1.0)) * d,
        interval(lo * scale, hi * scale),
        "CI is for the population d (noncentral t), not bias-corrected",
    )


def d_z(diff: Vector, conf: float) -> Effect:
    """Uncorrected d_z = mean / SD of the paired differences (review #29)."""
    n, sd = len(diff), float(diff.std(ddof=1))
    if sd == 0.0:
        return effect("d_z", None, None, "SD of the differences is 0")
    dz = float(diff.mean()) / sd
    lo, hi = nct_ci(dz * math.sqrt(n), n - 1, conf)
    return effect("d_z", dz, interval(lo / math.sqrt(n), hi / math.sqrt(n)))


def d_av(a: Vector, b: Vector) -> Effect:
    s = math.sqrt((a.var(ddof=1) + b.var(ddof=1)) / 2.0)
    value = float(a.mean() - b.mean()) / s if s > 0 else None
    return effect(
        "d_av",
        value,
        None,
        "no validated CI for a standardized difference under unequal variances; "
        "use the mean-difference CI (review #28)",
    )


def newcombe_auc(auc: float, m: int, n: int, conf: float) -> tuple[float, float]:
    """Newcombe (2006) method 5: score interval |theta - AUC| <= z sqrt(V(theta)), Hanley-McNeil-type V with
    N* = (m + n) / 2. Stays inside [0, 1] and is defined at AUC = 0 or 1."""
    z = float(stats.norm.ppf(0.5 + conf / 2.0))
    ns = (m + n) / 2.0

    def f(t: float) -> float:
        var = t * (1 - t) / (m * n) * (1 + (ns - 1) * (1 - t) / (2 - t) + (ns - 1) * t / (1 + t))
        return (t - auc) ** 2 - z * z * var

    lo = 0.0 if auc <= 0 or f(0.0) <= 0 else float(optimize.brentq(f, 0.0, min(auc, 1 - 1e-12), xtol=1e-12))
    hi = 1.0 if auc >= 1 or f(1.0) <= 0 else float(optimize.brentq(f, max(auc, 1e-12), 1.0, xtol=1e-12))
    return lo, hi


def delong_logit(a: Vector, b: Vector, conf: float) -> tuple[float, float] | None:
    """DeLong (placement-value) variance on the logit scale; None at AUC 0 / 1 or zero variance."""
    y = np.r_[np.ones(len(a), np.int64), np.zeros(len(b), np.int64)]
    aucs, cov = delong(y, np.r_[a, b][None, :])
    auc, var = float(aucs[0]), float(cov[0, 0])
    if not (0.0 < auc < 1.0 and var > 0.0):
        return None
    z, center = float(stats.norm.ppf(0.5 + conf / 2.0)), math.log(auc / (1.0 - auc))
    half = z * math.sqrt(var) / (auc * (1.0 - auc))
    return 1.0 / (1.0 + math.exp(-(center - half))), 1.0 / (1.0 + math.exp(-(center + half)))


def rank_biserial_independent(a: Vector, b: Vector, u1: float, conf: float) -> Effect:
    """r = 2 U1 / (n1 n2) - 1 = P(a > b) - P(a < b); positive when group 1 tends to be larger. CI: the union of
    Newcombe's method 5 (fails under unequal spread with imbalance, review #30: 76%) and the DeLong logit
    interval (fails near separation: 68%); simulated coverage >= 0.95 over the tested grid from 6 per group
    (ADR-157)."""
    n1, n2 = len(a), len(b)
    auc = u1 / (n1 * n2)
    if min(n1, n2) < MIN_N_RANK_CI:
        return effect(
            "rank_biserial",
            2 * auc - 1,
            None,
            f"no CI below {MIN_N_RANK_CI} per group: simulated coverage "
            "fell to 0.64 (n = 2), 0.78 (3), 0.88 (4), 0.93 (5) under unequal spread (review #30)",
        )
    lo, hi = newcombe_auc(auc, n1, n2, conf)
    other = delong_logit(a, b, conf)
    if other is not None:
        lo, hi = min(lo, other[0]), max(hi, other[1])
    return effect("rank_biserial", 2 * auc - 1, interval(2 * lo - 1, 2 * hi - 1))


def rank_biserial_paired(diff: Vector) -> Effect:
    """r = (W+ - W-) / (W+ + W-) over nonzero differences (zeros dropped, as in the Wilcoxon test)."""
    d = diff[diff != 0.0]
    if len(d) == 0:
        return effect("rank_biserial", None, None, "all differences are 0")
    ranks = stats.rankdata(np.abs(d))
    total = len(d) * (len(d) + 1) / 2.0
    return effect(
        "rank_biserial",
        (2.0 * float(ranks[d > 0].sum()) - total) / total,
        None,
        "no CI: the matched-pairs estimand depends on n and bootstrap intervals under-cover near +-1 (review #30)",
    )


def _invert(cdf: Callable[[float], float], target: float, scale: float) -> float:
    """Noncentrality lambda >= 0 with cdf(lambda) = target (cdf decreases in lambda); 0 when cdf(0) <= target.
    `scale` ~ the observed statistic's noncentrality, so the bracket starts near the answer."""
    if cdf(0.0) <= target:
        return 0.0
    return _root(lambda lam: cdf(lam) - target, 0.0, max(10.0, 2.0 * scale))


def lambda_ci(cdf: Callable[[float], float], conf: float, scale: float) -> tuple[float, float] | None:
    """None when the inversion fails numerically: the interval is then not reported; the test itself stands."""
    tail = (1.0 - conf) / 2.0
    try:
        return _invert(cdf, 1.0 - tail, scale), _invert(cdf, tail, scale)
    except (ValueError, RuntimeError):
        return None


def ss_effects(groups: list[Vector]) -> tuple[float, float]:
    """Descriptive eta^2 and omega^2 (review #34: no interval work here). Caller ensures SS_total > 0."""
    allv = np.concatenate(groups)
    k, n = len(groups), len(allv)
    ss_b = float(sum(len(g) * (g.mean() - allv.mean()) ** 2 for g in groups))
    ss_t = float(((allv - allv.mean()) ** 2).sum())
    ms_w = (ss_t - ss_b) / (n - k)
    return ss_b / ss_t, max(0.0, (ss_b - (k - 1) * ms_w) / (ss_t + ms_w))


def eta_squared_ci(f: float, df1: int, df2: int, n: int, conf: float) -> list[float] | None:
    def cdf(lam: float) -> float:
        return float(stats.ncf.cdf(f, df1, df2, lam)) if lam > 0 else float(stats.f.cdf(f, df1, df2))

    bounds = lambda_ci(cdf, conf, f * df1)
    return None if bounds is None else interval(bounds[0] / (bounds[0] + n), bounds[1] / (bounds[1] + n))


def epsilon_squared(h: float, n: int) -> Effect:
    return effect("epsilon_squared", h * (n + 1) / (n * n - 1), None, "no validated interval")


def cramers_v(chi2: float, df: int, n: int, m: int, conf: float) -> Effect:
    """V = sqrt(chi2 / (n (m - 1))), m = min(rows, cols); CI maps lambda -> sqrt(lambda / (n (m - 1)))."""
    scale = n * (m - 1)

    def cdf(lam: float) -> float:
        return float(stats.ncx2.cdf(chi2, df, lam)) if lam > 0 else float(stats.chi2.cdf(chi2, df))

    bounds = lambda_ci(cdf, conf, chi2)
    if bounds is None:
        return effect("cramers_v", math.sqrt(chi2 / scale), None, "noncentrality inversion failed numerically")
    return effect(
        "cramers_v",
        math.sqrt(chi2 / scale),
        interval(math.sqrt(bounds[0] / scale), min(1.0, math.sqrt(bounds[1] / scale))),
    )
