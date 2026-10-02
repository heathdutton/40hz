<h1><img src="brand/logo.svg" alt="40 Hz" height="80"></h1>

Gamma light and sound in the browser. It tests your device first, then runs only what that device can actually do.

> **This flickers at 40 Hz.** Skip the light if you have epilepsy, photosensitivity, or a history of migraines.

## Why most screens can't do this

A screen can't flicker faster than half its refresh rate. A clean 40 Hz flicker needs a refresh rate that divides evenly by 40.

- **120, 240, 360 and 480 Hz** work. MacBook Pro, iPad Pro, iPhone Pro, 240 Hz monitors.
- **60, 90, 144 and 165 Hz** don't. On those, 40 Hz comes out as 20 Hz.

So on a normal 60 Hz laptop the light is off, and the page says why. Sound has no such limit. It's exact on every device.

## Try it

[heathdutton.github.io/40hz](https://heathdutton.github.io/40hz/)

## How the light works

Plain white flicker, the same kind every study used. On a 120 Hz screen each cycle is 3 frames, 1 on and 2 off. That 33% on-time is right where the research points. The logo is that cycle slowed down 40 times.

Brighter works better, so HDR screens get a brighter flicker.

There's a gentler green/blue shimmer in settings. It's easier to sit through, but it isn't the default. Colour vision can't keep up with 40 Hz (it tops out around 25 Hz), so the brain responds much less to a colour-only flicker.

## How the sound works

A soft noise that pulses 40 times a second. What the research pushed us toward:

- Pulses with a sharp start, a quick fade, then silence. That gets a bigger response than a smooth wobble.
- Weighted toward low tones, 250 to 500 Hz. The 40 Hz response is ~3x bigger at 250 Hz than at 4 kHz, and older ears lose the highs first.
- The same pulse in both ears. No binaural beats, they get a weaker response than real pulses.
- The highs differ slightly between ears, so it sounds wide instead of stuck in your head.

You can load your own music too. The same 40 Hz pulse gets applied to it.

The light syncs to the sound's clock. Left alone they drift ~180 ms an hour, about 7 full cycles.

## The research

What the studies found, and why we built this, is in [findings.md](findings.md).

## Not medical advice

The science is promising but unsettled. [Cognito's](https://www.biospace.com/press-releases/cognito-therapeutics-completes-enrollment-in-hope-pivotal-study-of-spectris-ad-therapy-for-the-treatment-of-patients-with-alzheimer-s-disease) earlier trial missed its main goal. This is a research project, not a treatment.
