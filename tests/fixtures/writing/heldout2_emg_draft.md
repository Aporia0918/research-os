<!-- SYNTHETIC HELD-OUT TEST FIXTURE 2 for ResearchOS writing checks (W3/W5). Not a real study; all citekeys are fictional placeholders (fixture*). Contains 10 deliberately planted flaws and 2 clean control paragraphs; see heldout2_emg_answer_key.md. Written after scoring the unchanged checker on heldout_ecg_draft.md and before any rule change. -->

# Participant-Independent Hand-Gesture Recognition from Forearm Surface EMG

## Abstract

Myoelectric prostheses decode intended hand movements from forearm muscle activity. We recorded surface electromyography (EMG) from 10 participants performing six hand gestures and classified 200 ms windows with a random forest. The classifier reached an accuracy of 91.2% across gestures. Our results establish that the classifier works reliably for all amputees.

## Introduction

Pattern-recognition control has been studied for more than two decades {{cite:fixtureEMGReview2018}}. Surface EMG is the most practical input modality for prosthetic control. Muscle fatigue drives the drift in EMG amplitude over a session.

## Methods

Ten able-bodied participants (n = 10) took part in a single session. Eight bipolar electrodes were placed around the dominant forearm, and signals were sampled at 2 kHz. Ethics approval was not sought for this pilot. Signals were band-pass filtered between 20 and 450 Hz and cut into 200 ms windows with 50% overlap. Four time-domain features were computed per channel.

Features were selected using the full dataset before cross-validation. Windows from all ten participants were shuffled and split into five folds. The random forest used 300 trees. A linear discriminant analysis (LDA) classifier served as the baseline.

## Results

Mean five-fold accuracy was 91.2% for the random forest and 85.4% for LDA (Table 1). Our accuracy exceeds the best results reported in earlier studies by 6%. Accuracy fell when the electrodes were shifted by 1 cm around the forearm.

Wrist flexion and extension were recognised most accurately, while pinch and tripod grips were most often confused (Fig. 2). Errors were more frequent at the end of each session than at its start.

## Discussion

The random forest reached a higher mean accuracy than the LDA baseline in this sample. With ten able-bodied participants and windows shared across folds, the estimate is likely optimistic for new users and does not cover amputees {{cite:fixtureShift2016}}. A participant-wise evaluation is needed before any clinical conclusion.

Shifting the electrodes by 1 cm around the forearm increased accuracy in our data. Amputees will never again need clinical recalibration of their prosthesis. This system will become the standard controller in all commercial prostheses.
