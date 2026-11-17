<!-- SYNTHETIC TEST FIXTURE for Research OS writing-assist (W3/W5). Not a real study. All citekeys are fictional placeholders (fixture*). Contains deliberately planted flaws; see answer-key.md. -->

# Subject-Independent Motor-Imagery Decoding on EEGMMIDB with a Compact Convolutional Network

## Abstract

Motor-imagery (MI) brain-computer interfaces translate imagined movements into control signals. We evaluate a compact convolutional network (CCN) for left- versus right-hand imagery on the public PhysioNet EEG Motor Movement/Imagery Database (EEGMMIDB). On 20 subjects, the CCN reached a mean accuracy of 0.74 compared with 0.68 for a common spatial pattern (CSP) baseline. This proves that compact deep networks always generalise across users. We discuss implications for calibration-free BCIs.

## Introduction

Motor imagery produces event-related desynchronisation of mu and beta rhythms over sensorimotor cortex {{cite:fixtureRhythms2001}}. Classical pipelines combine band-pass filtering with CSP and linear discriminant analysis {{cite:fixtureCSP2008}}. Deep networks clearly outperform hand-crafted feature pipelines for MI decoding. Most published MI studies, however, train and test on the same users, which inflates accuracy when deployed on new users.

Imagining a hand movement causes a strong increase of mu-band power over the contralateral motor cortex. This motivates spatial filters that emphasise contralateral channels. In this paper we ask whether a compact network can decode MI from users it has never seen.

## Methods

We used recordings from 20 subjects of EEGMMIDB (runs 4, 8 and 12, imagined left versus right fist). Signals were recorded from 64 electrodes placed according to the 10-10 system and re-referenced to the common average. Data were sampled at 160 Hz. We applied a band-pass filter between 8 and 30 Hz and epoched each trial from 0.5 to 2.5 s after cue onset. Ocular artifacts were reduced with independent component analysis (ICA), removing components correlated with frontal channels.

All epochs from all subjects were z-scored using the global mean and standard deviation, then shuffled and divided into 80% training and 20% test epochs. The CCN has two temporal and one depthwise spatial convolution layer, followed by average pooling and a dense softmax layer. It was trained with Adam for 100 epochs. The CSP baseline used six spatial filters and LDA. Hyperparameters were tuned on the test epochs. No power analysis was performed.

## Results

The CCN reached a mean test accuracy of 0.74 and the CSP baseline 0.68 (Table 1). The difference was significant (paired t-test, p < 0.01). Accuracy varied across subjects, ranging from 0.55 to 0.93. The CCN improved accuracy by 12 percentage points over the best prior subject-independent result.

During imagery, mu-band power over the contralateral motor cortex decreased relative to rest in 17 of 20 subjects. Beta-band changes were weaker and less consistent.

## Discussion

Our compact network achieved higher mean accuracy than the CSP baseline on held-out epochs of EEGMMIDB. The 0.06 gain is modest and the per-subject spread is large, so the result should be read as preliminary evidence rather than a definitive comparison {{cite:fixtureEval2019}}. Because only 20 subjects and one dataset were analysed, we cannot say how the network behaves on other headsets or clinical populations.

The results show that the network will eliminate the need for user calibration in all future BCIs. Clinicians will certainly adopt this approach. Future work will extend the evaluation to additional datasets.

## References

Placeholder list; resolved from the library by citekey.
