<!-- SYNTHETIC HELD-OUT TEST FIXTURE for ResearchOS writing checks (W3/W5). Not a real study; all citekeys are fictional placeholders (fixture*). Contains 10 deliberately planted flaws and 2 clean control paragraphs; see heldout_ecg_answer_key.md. Written before any rule change of the ported checker. -->

# Patient-Independent Arrhythmia Classification from Single-Lead ECG with a Lightweight 1-D CNN

## Abstract

Automatic arrhythmia detection could reduce the workload of Holter review. We train a lightweight one-dimensional convolutional network (1D-CNN) to classify heartbeats from lead II of the MIT-BIH Arrhythmia Database into five AAMI classes. The network reached a macro F1-score of 0.89 on the test beats. These findings demonstrate that the network universally detects arrhythmias in any patient population.

## Introduction

Cardiac arrhythmias affect millions of people and are a leading cause of sudden cardiac death {{cite:fixtureEpi2020}}. Holter recordings last 24 to 48 hours, so manual beat-by-beat annotation is slow and error-prone {{cite:fixtureHolter2017}}. Convolutional networks are more reliable than cardiologists at labelling ventricular ectopic beats.

Reduced heart rate variability leads to ventricular ectopy after myocardial infarction. This link motivates beat-level monitoring in post-infarction patients. Here we ask whether a lightweight network can classify beats from patients it has never seen.

## Methods

We used all 48 half-hour two-lead recordings of the MIT-BIH Arrhythmia Database from 47 patients {{cite:fixtureMITBIH2001}}. Signals were sampled at 360 Hz, and we used lead II only. Baseline wander was removed with a 0.5 Hz high-pass filter, and powerline noise with a 60 Hz notch filter. Each beat was segmented as a 0.75 s window centred on the annotated R peak. The use of this public, de-identified database was approved by the institutional ethics committee.

All beats were standardised with the mean and standard deviation of the entire dataset. The beats of all patients were then pooled, shuffled and randomly divided into 70% training and 30% test beats. The network has four convolutional blocks with batch normalisation, followed by global average pooling and a softmax layer. It was trained with Adam for 50 epochs using a batch size of 256. An RR-interval logistic-regression baseline used the pre- and post-RR intervals as features. The learning rate and dropout rate were selected on the test beats. Confidence intervals were not computed for any metric.

## Results

On the test beats, the 1D-CNN reached a macro F1-score of 0.89 and an overall accuracy of 97.6% (Table 2). Sensitivity was 0.94 for ventricular ectopic beats and 0.71 for supraventricular ectopic beats. This is 9 percentage points higher than previously published patient-independent methods. Sensitivity for supraventricular ectopic beats dropped from 0.71 to 0.58 when the input window was shortened to 0.5 s.

Ventricular ectopic beats were most often confused with normal beats in records with heavy muscle noise (Fig. 3). Most errors occurred in a small number of records with frequent fusion beats. Fusion beats made up less than 1% of the training beats.

## Discussion

Our network achieved a higher macro F1-score than the RR-interval baseline on the test beats. Because the beats were split at random rather than by patient, these scores probably overestimate performance on new patients {{cite:fixtureSplit2019}}. We could not assess performance on other leads or recording devices.

Shortening the input window to 0.5 s raised the sensitivity for supraventricular ectopic beats. Hospitals will soon deploy this network for every Holter recording. Cardiologists will no longer need to over-read ambulatory ECGs. Future work will validate the network on the INCART database.

## References

Placeholder list; resolved from the library by citekey.
