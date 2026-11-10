# Null-world exam demo

Two versions of the same student script on synthetic ECG-like data (no real data, no dependencies).

```
python make_data.py ecg_features.csv
python -m researchos.services.nullworld detect ecg_features.csv
python -m researchos.services.nullworld exam --script leaky.py --data ecg_features.csv --group subject --label af --contrast
python -m researchos.services.nullworld exam --script fixed.py --data ecg_features.csv --group subject --label af --contrast
```

`leaky.py` splits rows at random, so a subject's windows sit on both sides of the split. In the null worlds every
subject keeps one (random) label, and the script still scores far above chance by recognising subjects: **fail**.
The naive row shuffle, shown with `--contrast`, sits at chance and would have missed it.

`fixed.py` splits by subject: the null worlds fall to chance and the real score beats all of them: **pass**.
