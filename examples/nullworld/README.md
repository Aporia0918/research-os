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
