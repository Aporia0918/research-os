# Null-world exam demo

Two versions of the same student script on synthetic ECG-like data (no real data, no dependencies).

```
python make_data.py ecg_features.csv
python -m researchos.services.nullworld detect ecg_features.csv
python -m researchos.services.nullworld exam --script leaky.py --data ecg_features.csv --group subject --label af --contrast
python -m researchos.services.nullworld exam --script fixed.py --data ecg_features.csv --group subject --label af --contrast
python -m researchos.services.nullworld power --script fixed.py --data ecg_features.csv --group subject --label af \
    --effects 0.2,0.5,0.8,1.2 --fractions 0.5,1
```

`leaky.py` splits rows at random, so a subject's windows sit on both sides of the split. In the null worlds every
subject keeps one (random) label, and the script still scores far above chance by recognising subjects: **fail**.
The naive row shuffle, shown with `--contrast`, sits at chance and would have missed it.

`fixed.py` splits by subject: the null worlds fall to chance and the real score beats all of them: **pass**.

`power` plants an effect of known size (in standard deviations of each feature) into null worlds and counts how often
`fixed.py` finds it, with a 95% Wilson interval, for half the subjects and for all of them. On the demo, a 1.2 SD
effect is found 20 of 20 times with 60 subjects and 12 of 20 times with 30. Sample sizes beyond the subjects you have
are not extrapolated.

## Blind test

`blind.py` builds datasets whose truth is known, runs the exam on them in shuffled order without telling it the
truth, and scores the verdicts. Six cases, ten synthetic datasets each, 19 null worlds per exam
(`python blind.py --datasets 10`, about 1.5 minutes on 4 cores):

| | result | 95% CI |
|---|---|---|
| subject leaks caught (with and without real signal) | 20/20 | 0.84–1.00 |
| the same leaks caught by the naive row shuffle | 0/20 | 0.00–0.16 |
| false alarms on clean splits | 0/30 | 0.00–0.11 |
| strong real signal passed | 10/10 | 0.72–1.00 |
| weak real signal passed | 2/10 | 0.06–0.51 |
| no signal passed | 0/10 | 0.00–0.28 |
| target leak (a feature copies the label) caught | 0/10 | 0.00–0.28 |

What this does and does not show:
- The data are synthetic and the leak is strong; real studies are messier, so these are upper bounds.
- A weak effect usually comes back *unsure*, not *pass*: the exam is conservative, and 19 worlds have little power.
  `python -m researchos.services.nullworld power` measures that power for a given dataset.
- A feature that already holds the answer (target leakage) moves with the real labels, so no label shuffle can
  reveal it. The exam passes it. It catches leakage through **structure** (the same subject on both sides of the
  split), not leakage through **features**.
