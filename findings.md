# The research behind 40 Hz

Light that flickers and sound that pulses 40 times a second is one of the odder ideas in Alzheimer's research. It's
also one of the cheapest. A good screen and headphones can deliver it... if they're set up right, and most aren't.

Not medical advice. The science is promising but unsettled.

## Why 40 Hz

Gamma is the brain's fast rhythm, roughly 30 to 80 Hz. It shows up during attention and memory work. In Alzheimer's
mice it weakens before plaques or memory problems appear.

The idea came out of Li-Huei Tsai's lab at MIT. Drive the brain at 40 Hz from the outside, with flicker and clicks,
and see what changes.

- **2016.** An hour of 40 Hz flicker lowered amyloid in the visual cortex of Alzheimer's mice. A week of daily
  sessions cut plaque in older mice. Microglia, the brain's cleanup cells, moved in on the amyloid.
- **2019.** Adding 40 Hz sound reached the hippocampus and prefrontal cortex, which light alone didn't. The mice did
  better on memory tasks.
- **2019.** In two neurodegeneration models, weeks of daily sessions kept neurons and synapses that would otherwise
  have died.
- **2024.** One proposed mechanism... the stimulation speeds up the fluid flow that rinses waste out of the brain.
  Block that flow and the amyloid stays put.

It isn't settled even in mice. In 2023 György Buzsáki's lab at NYU found 40 Hz light didn't drive the brain's own
gamma and didn't lower amyloid, and their mice avoided the flicker. MIT pushed back on the methods. Flicker clearly produces a 40 Hz response. The fight is over
whether it's the gamma that matters.

## In people

- **Safety, MIT 2022.** Daily light and sound at home was safe and people stuck with it. The 40 Hz response showed up
  deep in the brain, hippocampus included. The pilot was 15 patients over 3 months, too small to measure benefit.
- **Two years, MIT 2025.** Five of those patients kept going for two years. Still safe, and decline looked slower,
  mostly in the late-onset ones.
- **OVERTURE, Cognito 2024.** 76 people with mild to moderate Alzheimer's, 6 months, against a sham device. It missed
  its main goal. Some secondary measures looked better: ~75% less decline in daily living and MMSE scores, ~70% less
  brain shrinkage. Only 53 finished, so read that as a hint. More headaches and tinnitus with the real device.
- **HOPE, Cognito.** The big one. 670 people at 70 sites, scored on daily living and MMSE, the two that looked best in
  OVERTURE. Results are due in 2026 and weren't out as of October.
- **Inside the brain, 2025.** Electrodes in the hippocampus pick up 40 Hz flicker directly.

Nobody has shown amyloid or tau clearance in people yet. So it's promising, unproven, cheap, and low risk for most
people. That's the case for getting the stimulus right instead of guessing.

## Why we built our own

This started as a simpler web page that never quite worked, and it took a while to see why. It was arithmetic.

A screen can't flicker faster than half its refresh rate. A clean 40 Hz needs a refresh that divides evenly by 40.

- **120, 240, 360 and 480 Hz** work. At 120 Hz each cycle is 3 frames, 1 on and 2 off.
- **60, 90, 144 and 165 Hz** don't. On those, 40 Hz comes out as a lopsided 20 Hz.

Most of what's out there runs into this and doesn't say so.

- YouTube tops out at 60 fps. A "40 Hz" video can't flicker at 40 Hz on any screen.
- Most laptops and monitors are 60 Hz, so even a perfect app can't do it there.
- The audio side mostly sells binaural beats, which get a weaker response than real pulses.
- MIT's 10 kHz click came from mouse studies. Mice hear best up high, and older human ears lose those pitches first.
- Nothing checks. A browser knows what it sent, not what the panel showed. macOS can report 120 Hz in Low Power Mode
  while the panel runs at 60. Backlights and OLEDs dim themselves without saying so.

So this page tests the device first. Sound runs everywhere, since audio timing is exact on any device. Light runs only
on a screen that can show 40 Hz cleanly. The one real check of the light is a light sensor (a ~$1 photodiode into a
mic input shows the actual flicker).

## The light

- **White flicker.** Every outcome study used it.
- **Short on-time.** Under 50% entrains more easily. 1 frame in 3 at 120 Hz (33%) sits right in the studied range.
- **Bright.** In older adults, 400 to 700 cd/m² beat 100. So HDR screens get a flash at 2x normal white.
- **Colour is gentler but weaker.** Colour vision tops out around 25 Hz (blue/yellow nearer 10 to 15), so at 40 Hz
  brightness carries the response. Head to head, a white strobe beat invisible spectral flicker. The green/blue
  shimmer stays in settings as the easy option.
- **Comfort is the real problem.** A full-depth strobe is hard to sit in front of for an hour, and people quit. The
  gentler options are the shimmer, a softer dark level and a smaller field.
- **40 may not be the magic number.** One study found 34 to 38 Hz entrained older adults more strongly. A 120 Hz
  screen can only do 40, 30, 24 or 20, so that's a 240 Hz question.

## The sound

Sound is the channel that always works, no special hardware. Light plus sound beat either alone in Cognito's EEG data,
and in mice the pair reached areas neither did alone.

- **Low pitches.** The 40 Hz response is ~3x bigger on a 250 Hz carrier than on 4 kHz. So we use noise weighted to
  250 to 500 Hz.
- **Sharp pulses.** A fast start (~2 ms), a quick fade and ~70% silence beat a smooth wobble.
- **Noise over a single tone.** A lone 250 Hz tone pulsed at 40 Hz blurs the pulse in the ear. A band of noise
  around it doesn't.
- **Attention matters.** Click responses shrink when people get distracted. Softer pulses hold up and sound nicer,
  which counts over an hour a day.
- **Same pulse in both ears.** Binaural beats give a smaller response than real pulses, and none above 3 kHz.
  Pulses out of phase between ears don't help either.
- **Width for free.** The response comes from the lows and the sense of space comes from the highs. So the lows stay
  identical in both ears and the highs differ slightly.
- **Light follows the sound's clock.** Audio and display clocks drift ~180 ms an hour, about 7 full cycles. MIT
  locked light to sound on purpose, so we do too.

The rule behind all of it... the carrier is free, the envelope is sacred. Change the colour, the pitch or the music.
The 40 Hz timing doesn't move.

## Safety and claims

- A 40 Hz white flicker is exactly what the web's flashing rule (WCAG 2.3.1) warns about. So there's a warning before
  any light, no autoplay, and never saturated red.
- Skip the light with epilepsy, photosensitivity or migraines.
- OVERTURE saw more headaches and tinnitus with the real device.
- The site doesn't claim to treat anything. A claim like that makes it a regulated medical device.

## Open questions

- Does it work in people? HOPE should say something soon.
- Is 40 the right frequency?
- How much does a smaller, more comfortable field cost?
- Does colour flicker do anything at 40 Hz once brightness is matched?
- Do bright laptop screens deliver a one-frame flash? Local dimming and slow pixels may round it off, and only a light
  sensor will tell.

## Sources

### Start here

**The mouse work**
- [Iaccarino et al., Nature 2016](https://www.nature.com/articles/nature20587) ... the first one. 40 Hz flicker lowered amyloid in the visual cortex.
- [Martorell et al., Cell 2019](https://www.cell.com/cell/fulltext/S0092-8674(19)30163-1) ... light plus sound reached the hippocampus and prefrontal cortex, and memory improved.
- [Adaikkan et al., Neuron 2019](https://doi.org/10.1016/j.neuron.2019.04.011) ... daily sessions kept neurons alive in two neurodegeneration models.
- [Murdock et al., Nature 2024](https://www.nature.com/articles/s41586-024-07132-6) ... the fluid-flow mechanism.
- [Soula et al., Nat Neurosci 2023](https://www.nature.com/articles/s41593-023-01270-2) ... the main negative result, from NYU.
- [Alzforum on the dispute](https://www.alzforum.org/news/research-news/does-flashing-light-really-lower-cortical-amyloid) ... both sides, in plain terms.
- [MIT Picower review](https://picower.mit.edu/news/review-evidence-expanding-40hz-gamma-stimulation-promotes-brain-health) ... where the evidence stands, from the lab that started it.

**In people**
- [Chan et al., PLOS One 2022](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0278412) ... MIT's safety pilot.
- [MIT, 2-year follow-up (2025)](https://news.mit.edu/2025/study-suggests-40hz-sensory-stimulation-may-benefit-some-alzheimers-patients-1114) ... five people, decline looked slower in some.
- [OVERTURE, Front Neurol 2024](https://www.frontiersin.org/journals/neurology/articles/10.3389/fneur.2024.1343588/full) ... Cognito's 6-month trial. Missed its main goal, secondary measures looked better.
- [Cognito's HOPE trial](https://www.biospace.com/press-releases/cognito-therapeutics-completes-enrollment-in-hope-pivotal-study-of-spectris-ad-therapy-for-the-treatment-of-patients-with-alzheimer-s-disease) ... the big one, 670 people.
- [40 Hz in the human hippocampus, Commun Biol 2025](https://www.nature.com/articles/s42003-025-08766-6) ... recorded from inside the brain.

**Light**
- [Duty cycle and intensity, Frontiers 2022](https://www.frontiersin.org/journals/neuroinformatics/articles/10.3389/fninf.2022.968907/full) ... shorter on-time entrains more easily.
- [Flicker for older adults](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9481621/) ... brighter beat dimmer.
- [Colour vs brightness flicker, J Neurosci 2024](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10402088/) ... the brain follows brightness flicker far faster than colour.
- [Spectral flicker vs a white strobe, 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC9277695/) ... the strobe got the bigger 40 Hz response.
- [Invisible spectral flicker, Sci Rep 2024](https://pmc.ncbi.nlm.nih.gov/articles/PMC11606973/) ... still a 40 Hz response, much more comfortable.
- [Color flicker, Sci Rep 2024](https://www.nature.com/articles/s41598-024-52679-z) ... swapping colours drives a response (brightness wasn't matched).
- [Choice of frequency, PLOS One 2025](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0321633) ... 40 may not be the best number.

**Sound**
- [Spectris EEG study](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12788959/) ... light plus sound beat either alone.
- [Ross et al., tone pitch](https://pubmed.ncbi.nlm.nih.gov/14644459/) ... low tones give the bigger 40 Hz response.
- [Pulse shape](https://www.biorxiv.org/content/10.1101/541359v1.full) ... a sharper start and more silence both help.
- [Schwarz & Taylor, binaural beats](https://pubmed.ncbi.nlm.nih.gov/15721080/) ... weaker than real pulses.
- [Clicks vs smooth pulses, attention](https://pubmed.ncbi.nlm.nih.gov/27424792/) ... clicks fade when you're distracted.

**Safety**
- [WCAG 2.3.1](https://www.w3.org/TR/UNDERSTANDING-WCAG20/seizure-does-not-violate.html) ... the web's flashing rule. A white strobe at 40 Hz fails it outright.
- [40 Hz audio in healthy over-65s](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12564345/) ... a safety study in healthy older adults.

### Everything else

- [Human visual cortex responds to invisible chromatic flicker (Nat Neurosci 2007)](http://vision.psych.ac.cn/files/NatureNeuroscience2007.pdf)
- [Heterochromatic flicker ERGs: luminance takes over at high temporal frequency](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8494685/)
- [Webvision: temporal resolution, S-cone pathway limits](https://www.ncbi.nlm.nih.gov/books/NBK11559/)
- [Chromatic vs luminance stimuli for SSVEP across frequency bands](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5855130/)
- [MIT/Cognito patent US 11,964,109 (duty cycle, 10kHz click spec)](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/11964109)
- [Binaural beats through the auditory pathway (eNeuro 2020)](https://www.eneuro.org/content/7/2/ENEURO.0232-19.2020)
- [Binaural summation of AM involves weak interaural suppression](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7044261/)
- [Dichotic vs monaural ASSR, MEG](https://pubmed.ncbi.nlm.nih.gov/20005163/)
- [Multiple-ASSR interactions, 30-50 Hz is the worst case](https://pmc.ncbi.nlm.nih.gov/articles/PMC3463185/)
- [MASTER stimulus and recording parameters](https://pubmed.ncbi.nlm.nih.gov/9547921/)
- [Carrier frequency amplitudes, filtered clicks vs SAM tones](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9998542/)
- [Envelope following responses: aging and modulation depth](https://pmc.ncbi.nlm.nih.gov/articles/PMC5031488/)
- [Gamma music as an acoustic stimulus](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10808749/)
- [Binaural unmasking and masker correlation](https://en.wikipedia.org/wiki/Binaural_unmasking)
- [BetterDisplay: macOS reports 120Hz while scanning at 60](https://github.com/waydabber/BetterDisplay/issues/1267)
- [MDN: web accessibility for seizure disorders](https://developer.mozilla.org/en-US/docs/Web/Accessibility/Guides/Seizure_disorders)
