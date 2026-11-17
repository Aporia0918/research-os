# 零世界：真实公开数据 / Null worlds on real public data

[中文](#中文) · [English](#english)

```
python run.py --runs 99 --json results.json     # about 27 min; 2 parallel runs (the engine's default on 4 cores)
pytest tests/test_nullworld_real.py             # fast version: breast_cancer, 19 null worlds, about 1 min
```

## 中文

**数据**：只用 scikit-learn 1.9.1 自带的三个真实公开数据集，不联网：`load_breast_cancer`（569 例，30 个特征，2 类）、
`load_wine`（178 例，13 个特征，3 类）、`load_digits`（1797 张 8×8 手写数字图，64 个像素特征，10 类）。
`run.py` 把每个数据集导出成用户会交来的 CSV：`sample_id`、各特征列、`label`。

**做了什么**：引擎不改一行，脚本是普通 sklearn 脚本（`scripts/`），每次考试 99 个零世界，种子 0。
每行一个样本时，`sample_id` 就是分组列，零世界即普通的标签置换。

| 编号 | 脚本 | 内容 |
|---|---|---|
| A | `honest.py` | 标准化 + 逻辑回归，放在 Pipeline 里做 5 折交叉验证 |
| B1 | `select_leaky.py` | 先在全部数据上标准化并 `SelectKBest(k=10)`，再交叉验证（经典错误） |
| B1-ref | `select_honest.py` | 同样步骤放进每一折 |
| B2 | `oversampled_leaky.py` | 交叉验证前随机过采样（小类别复制行，保留 `sample_id`），随机森林，按行切折（经典错误） |
| B2-ref | `oversampled_honest.py` | 同一张表和模型，按 `sample_id` 切折（GroupKFold） |

**结论**（数字见下表）：
- A：三个数据集都是 **pass**，真实分数远高于全部 99 个零世界（p = 0.01，99 个世界能给出的最小值）。
- B1：在这三个低维数据上，特征选择泄漏几乎不抬分（泄漏 − 诚实：+0.006 / −0.002 / +0.005），零世界也几乎不动，
  引擎判 **pass**。分数确实是学到的，所以这不算误判；但也说明这种泄漏在这里引擎看不出来，也不需要看出来。
- B2：零世界被抬高的程度取决于复制了多少行。breast_cancer 复制 145 行：零世界均值 0.712 对机会水平 0.628，
  **fail**；wine 复制 35 行：0.513 对 0.399，**unsure**；digits 只复制 33 行（1.8%）：0.124 对 0.103，**pass**（漏报）。
  真实分数的虚高很小（+0.017 / 0.000 / −0.001），因为这些数据本身信号很强；零世界却把复制泄漏暴露出来。
- B2-ref：三个都是 **pass**，没有误报。
- **发现并修复了一个 bug**（单独提交）：过采样后每个样本的行数与标签相关，整组置换会改变零世界的类别比例，
  而引擎原来用真实标签的多数类比例作机会水平。修复前 breast_cancer 的 B2-ref（诚实脚本）被判 **fail**
  （19 个世界：机会水平 0.500，零世界均值 0.583）。现在机会水平取零世界自身标签的平均（这里为 0.628）。
- **C（分组数据）未做**：scikit-learn 自带的数据集都没有受试者 / 患者编号（digits 原始的书写者编号未随包发布），
  我们不伪造“真实患者”分组。B2 用的是真实行的复制，`sample_id` 只表示“同一条原始记录”。

## English

**Data**: only three real public datasets bundled with scikit-learn 1.9.1, no network: `load_breast_cancer` (569
samples, 30 features, 2 classes), `load_wine` (178, 13, 3) and `load_digits` (1797 8×8 images, 64 pixel features, 10
classes). `run.py` exports each one as the CSV a user would hand over: `sample_id`, the features, `label`.

**What was run**: the engine unchanged, plain sklearn scripts (`scripts/`, table above), 99 null worlds per exam, seed 0.
With one row per sample the group column is `sample_id` and a null world is an ordinary label permutation.

**Findings**:
- A passes on all three: the real score beats all 99 null worlds (p = 0.01, the smallest 99 worlds can give).
- B1 (selection before CV) barely inflates these low-dimensional datasets (leaky − honest: +0.006 / −0.002 / +0.005)
  and barely moves the null worlds, so the engine says **pass**. The score is genuinely learned, so this is not a
  wrong verdict, but the exam does not flag this leak here.
- B2 (oversampling before a row-wise split): how far the null worlds rise depends on how many rows were copied.
  breast_cancer, 145 copies: null mean 0.712 vs chance 0.628, **fail**. wine, 35 copies: 0.513 vs 0.399, **unsure**.
  digits, 33 copies (1.8% of rows): 0.124 vs 0.103, **pass** (a miss). The real score is barely inflated
  (+0.017 / 0.000 / −0.001) because the signal is strong, yet the null worlds expose the copies.
- B2-ref passes on all three: no false alarm.
- **Bug found and fixed** (separate commit): oversampling ties rows per sample to the label, so whole-group shuffles
  change the class balance, while the engine took chance from the real labels. Before the fix, breast_cancer B2-ref
  (an honest script) was judged **fail** (19 worlds: chance 0.500, null mean 0.583). Chance is now averaged over the
  null worlds' own labels (0.628 here).
- **C (grouped data) skipped**: none of the bundled datasets carries subject or patient IDs (the digits writers' IDs
  are not shipped), and we do not invent patient groups. B2 copies real rows; `sample_id` only means "the same record".

## Results / 结果 (99 null worlds, seed 0)

| dataset | case | rows | chance | real | null mean | null p95 | p | verdict | seconds |
|---|---|---|---|---|---|---|---|---|---|
| breast_cancer | A | 569 | 0.627 | 0.979 | 0.603 | 0.621 | 0.010 | pass (real_beats_null) | 141.6 |
| breast_cancer | B1 | 569 | 0.627 | 0.958 | 0.618 | 0.631 | 0.010 | pass (real_beats_null) | 90.7 |
| breast_cancer | B1-ref | 569 | 0.627 | 0.960 | 0.617 | 0.629 | 0.010 | pass (real_beats_null) | 94.5 |
| breast_cancer | B2 | 714 | 0.628 | 0.979 | 0.712 | 0.737 | 0.010 | fail (null_above_chance) | 105.4 |
| breast_cancer | B2-ref | 714 | 0.628 | 0.962 | 0.580 | 0.611 | 0.010 | pass (real_beats_null) | 105.6 |
| wine | A | 178 | 0.399 | 0.983 | 0.355 | 0.427 | 0.010 | pass (real_beats_null) | 91.1 |
| wine | B1 | 178 | 0.399 | 0.961 | 0.367 | 0.429 | 0.010 | pass (real_beats_null) | 84.0 |
| wine | B1-ref | 178 | 0.399 | 0.955 | 0.357 | 0.421 | 0.010 | pass (real_beats_null) | 89.6 |
| wine | B2 | 213 | 0.399 | 0.981 | 0.513 | 0.568 | 0.010 | unsure (null_near_threshold) | 89.0 |
| wine | B2-ref | 213 | 0.399 | 0.981 | 0.344 | 0.415 | 0.010 | pass (real_beats_null) | 89.6 |
| digits | A | 1797 | 0.102 | 0.969 | 0.100 | 0.109 | 0.010 | pass (real_beats_null) | 155.2 |
| digits | B1 | 1797 | 0.102 | 0.853 | 0.113 | 0.124 | 0.010 | pass (real_beats_null) | 87.2 |
| digits | B1-ref | 1797 | 0.102 | 0.848 | 0.100 | 0.111 | 0.010 | pass (real_beats_null) | 95.3 |
| digits | B2 | 1830 | 0.103 | 0.974 | 0.124 | 0.137 | 0.010 | pass (real_beats_null) | 144.9 |
| digits | B2-ref | 1830 | 0.103 | 0.975 | 0.097 | 0.112 | 0.010 | pass (real_beats_null) | 142.7 |

`chance` is the majority-class rate averaged over the null worlds; `seconds` is wall time per exam (100 script runs)
on a 4-core Linux machine.
