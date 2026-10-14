"""Pure-stdlib fallback models (used only when numpy/scikit-learn are absent).

* PureLogistic — batch gradient-descent logistic regression on z-scored
  features. Deterministic, no dependencies. ~5k x 16 matrix runs in seconds.
* PureOutlier — robust z-score outlier detector that stands in for
  sklearn's Isolation Forest: fits per-feature median/MAD, scores the max
  robust deviation, threshold calibrated to the requested contamination.

Both expose the small subset of the sklearn API the service layer needs
(fit / predict_proba or decision equivalent) and are picklable.
"""

from __future__ import annotations

import math
import statistics
from typing import List, Sequence

from ml._compat import expit


class PureLogistic:
    """Logistic regression trained with full-batch gradient descent."""

    def __init__(self, epochs: int = 400, lr: float = 0.3, l2: float = 1e-3):
        self.epochs, self.lr, self.l2 = epochs, lr, l2
        self.means: List[float] = []
        self.stds: List[float] = []
        self.w: List[float] = []
        self.b: float = 0.0

    def _z(self, row: Sequence[float]) -> List[float]:
        return [(x - m) / s if s > 1e-9 else 0.0
                for x, m, s in zip(row, self.means, self.stds)]

    def fit(self, X: List[List[float]], y: List[int]) -> "PureLogistic":
        n = len(X)
        p = len(X[0])
        self.means = [statistics.fmean(col) for col in zip(*X)]
        self.stds = [statistics.pstdev(col) or 1.0 for col in zip(*X)]
        Z = [self._z(row) for row in X]
        self.w = [0.0] * p
        self.b = 0.0
        for _ in range(self.epochs):
            grad_w = [0.0] * p
            grad_b = 0.0
            for z, yi in zip(Z, y):
                err = expit(self.b + sum(a * b_ for a, b_ in zip(z, self.w))) - yi
                grad_b += err
                for j, a in enumerate(z):
                    grad_w[j] += err * a
            scale = 1.0 / n
            self.b -= self.lr * grad_b * scale
            for j in range(p):
                self.w[j] -= self.lr * (grad_w[j] * scale + self.l2 * self.w[j])
        return self

    def predict_proba1(self, row: Sequence[float]) -> float:
        z = self._z(row)
        return expit(self.b + sum(a * b_ for a, b_ in zip(z, self.w)))

    # sklearn-ish aliases -------------------------------------------------
    def predict_proba(self, X: List[List[float]]) -> List[List[float]]:
        out = []
        for row in X:
            p1 = self.predict_proba1(row)
            out.append([1.0 - p1, p1])
        return out

    @property
    def coef_(self):  # for the coefficient-explanation fallback
        return [self.w]


class PureOutlier:
    """Robust-z outlier detector (Isolation Forest stand-in)."""

    def __init__(self, contamination: float = 0.025):
        self.contamination = contamination
        self.med: List[float] = []
        self.mad: List[float] = []
        self.names: List[str] = []
        self.threshold: float = 3.5

    def fit(self, X: List[List[float]], feature_names: Sequence[str] = ()) -> "PureOutlier":
        self.names = list(feature_names) or [f"f{i}" for i in range(len(X[0]))]
        cols = list(zip(*X))
        self.med = [statistics.median(col) for col in cols]
        self.mad = [(statistics.median([abs(v - m) for v in col]) * 1.4826) or 1e-6
                    for col, m in zip(cols, self.med)]
        scores = [self._score(row) for row in X]
        ordered = sorted(scores, reverse=True)
        k = max(1, int(len(ordered) * self.contamination))
        self.threshold = ordered[k - 1]
        return self

    def _score(self, row: Sequence[float]) -> float:
        return max(abs(x - m) / s for x, m, s in zip(row, self.med, self.mad))

    def score(self, row: Sequence[float]) -> float:
        """Return (robust_z, flagged_bool, worst_feature_name)."""
        zs = [abs(x - m) / s for x, m, s in zip(row, self.med, self.mad)]
        worst = max(range(len(zs)), key=lambda i: zs[i]) if zs else 0
        return zs[worst] if zs else 0.0

    def is_outlier(self, row: Sequence[float]) -> bool:
        return self.score(row) > self.threshold
