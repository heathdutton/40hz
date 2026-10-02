#!/usr/bin/env bash
#
# Bake a 40 Hz flicker into an HDR PQ video.
#
# Why bake it rather than drive it from JS: video presentation runs on the media/compositor path,
# so it is immune to main-thread jank in a way requestAnimationFrame is not. The cost is that the
# file is only correct on a display whose refresh is a whole multiple of 40 Hz. On a 60 Hz panel
# it 2:1-pulldowns into a lopsided 20 Hz, so the player must gate on measured refresh rate.
#
# Resolution is deliberately tiny. Bilinear upscaling of a flat field is still a flat field, so
# 256x144 stretched to fullscreen costs nothing. File size is negligible for the same reason:
# every frame is one of two flat images, so temporal prediction crushes it. 30s lands around 240K.
#
#   ./make-gamma.sh                                  # 30s, 120fps, 1000 nits, 33% duty
#   FPS=240 ON=3 ./make-gamma.sh                     # 240 Hz panel, 50% duty
#   MODE=chromatic NITS=200 ./make-gamma.sh          # isoluminant, far easier to sit with
#   MODE=chromatic CHROMA=1 NITS=60 ./make-gamma.sh  # full saturation, note the luminance cost
#
set -euo pipefail

NITS=${NITS:-1000}          # luminance of the lit frame
MODE=${MODE:-luminance}     # luminance | chromatic
CHROMA=${CHROMA:-0.35}      # chromatic only: cone contrast vs a reachable blue leg
W=${W:-256}
H=${H:-144}
FPS=${FPS:-120}             # must be a whole multiple of 40
DUR=${DUR:-30}              # seconds
ON=${ON:-1}                 # lit frames per 40 Hz cycle
# Luminance is the canonical asset the page loads, so it gets the bare name. Other modes are
# suffixed. Keep this in step with VIDEO_SRC in app.js.
OUT=${OUT:-dist/gamma40-${FPS}fps$([ "$MODE" = luminance ] || echo "-${MODE}").mp4}

TARGET_HZ=40
FPC=$(( FPS / TARGET_HZ ))

if (( FPS % TARGET_HZ != 0 )); then
  echo "FPS=$FPS is not a whole multiple of $TARGET_HZ. Use 80, 120, 240, 360 or 480." >&2
  exit 1
fi
if (( ON < 1 || ON >= FPC )); then
  echo "ON=$ON must be between 1 and $((FPC - 1)) at $FPS fps." >&2
  exit 1
fi

CYCLES=$(( DUR * TARGET_HZ ))
FRAMES=$(( CYCLES * FPC ))
MAXCLL=${MAXCLL:-$(python3 -c "print(max(1, round($NITS)))")}

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

echo "40 Hz flicker, ${MODE}"
echo "  ${W}x${H} @ ${FPS}fps, ${FPC} frames per cycle, ${ON} lit ($(python3 -c "print(f'{100*$ON/$FPC:.1f}')")% duty)"
echo "  ${DUR}s = ${CYCLES} cycles = ${FRAMES} frames"

# Write the two source frames as flat 16-bit PNGs holding PQ code words directly.
#
# 16 bits rather than 8 matters only for the chromatic mode, and there it matters a lot: rounding
# the PQ codes to 8 bits leaves ~1.5% residual luminance modulation, which is exactly the quantity
# an isoluminant stimulus exists to eliminate. At 16 bits it drops to ~0.1%.
python3 - "$work" "$W" "$H" "$NITS" "$MODE" "$CHROMA" <<'PY'
import sys, zlib, struct

work, W, H = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
nits, mode, chroma = float(sys.argv[4]), sys.argv[5], float(sys.argv[6])

# SMPTE ST 2084 inverse EOTF: absolute nits -> 0..1 code value.
m1, m2 = 2610 / 16384, 2523 / 4096 * 128
c1, c2, c3 = 3424 / 4096, 2413 / 4096 * 32, 2392 / 4096 * 32
def pq(L):
    y = max(0.0, min(1.0, L / 10000.0)) ** m1
    return ((c1 + c2 * y) / (1 + c3 * y)) ** m2

def png16(path, rgb):
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    px = struct.pack('>3H', *[max(0, min(65535, round(v * 65535))) for v in rgb])
    raw = (b'\x00' + px * W) * H
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n'
                + chunk(b'IHDR', struct.pack('>IIBBBBB', W, H, 16, 2, 0, 0, 0))
                + chunk(b'IDAT', zlib.compress(raw, 9))
                + chunk(b'IEND', b''))

if mode == 'chromatic':
    # BT.2020 luminance coefficients. Blue carries 5.9% of luma, so a full-saturation green/blue
    # pair needs ~17x the drive on its blue leg. White, pure green and pure blue at one luminance
    # are all isoluminant, and luminance is linear, so any convex combination of them is too.
    # CHROMA slides along that line, trading cone contrast for a blue leg the panel can reach.
    kg, kb = 0.6780, 0.0593
    w = (1 - chroma) * nits
    g_leg, b_leg = w + chroma * nits / kg, w + chroma * nits / kb
    png16(work + '/lit.png',  (pq(w), pq(g_leg), pq(w)))
    png16(work + '/dark.png', (pq(w), pq(w), pq(b_leg)))
    print('  chroma %.2f at %.0f nits: green leg %.0f, blue leg %.0f nits'
          % (chroma, nits, g_leg, b_leg))
    if b_leg > 1000:
        print('  CAUTION: a blue subpixel alone rarely exceeds 10-15%% of white peak. If this panel\n'
              '  cannot reach %.0f nits on blue the pair clips, stops being isoluminant, and\n'
              '  luminance flicker comes back. Lower NITS or lower CHROMA.' % b_leg)
else:
    png16(work + '/lit.png',  (pq(nits),) * 3)
    png16(work + '/dark.png', (0.0, 0.0, 0.0))
    print('  PQ code %.4f for %.0f nits, dark frame at 0' % (pq(nits), nits))
PY
echo

for (( i = 0; i < FPC; i++ )); do
  src=$([ "$i" -lt "$ON" ] && echo lit || echo dark)
  cp "$work/$src.png" "$(printf '%s/unit_%03d.png' "$work" "$i")"
done

mkdir -p "$(dirname "$OUT")"

# hdr-opt + repeat-headers keep the mastering-display and MaxCLL SEI in every keyframe, and
# -tag:v hvc1 is non-negotiable: ffmpeg defaults to hev1, which Apple platforms silently refuse.
# L(10000000,1) is 1000 nits max / 0.0001 nits min, in PQ's 0.0001 cd/m2 units.
ffmpeg -v warning -stats \
  -framerate "$FPS" -start_number 0 -i "$work/unit_%03d.png" \
  -vf "loop=loop=$((CYCLES - 1)):size=${FPC}:start=0,setpts=N/(${FPS}*TB),format=yuv420p10le" \
  -c:v libx265 -preset medium -tag:v hvc1 \
  -color_primaries bt2020 -color_trc smpte2084 -colorspace bt2020nc \
  -x265-params "crf=12:hdr-opt=1:repeat-headers=1:keyint=${FPS}:colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc:master-display=G(8500,39850)B(6550,2300)R(35400,14600)WP(15635,16450)L(10000000,1):max-cll=${MAXCLL},${MAXCLL}" \
  -movflags +faststart -y "$OUT"

echo
echo "wrote $OUT  ($(du -h "$OUT" | cut -f1))"
echo
echo "verification:"
ffprobe -v error -select_streams v:0 \
  -show_entries "stream=codec_name,profile,width,height,pix_fmt,r_frame_rate,nb_frames,color_primaries,color_transfer,color_space,codec_tag_string" \
  -of default=noprint_wrappers=1 "$OUT" | sed 's/^/  /'
ffprobe -v error -select_streams v:0 -show_frames -read_intervals "%+#1" -of json "$OUT" \
  | python3 -c '
import json, sys
sd = json.load(sys.stdin)["frames"][0].get("side_data_list", [])
found = {d.get("side_data_type") for d in sd}
for want in ("Mastering display metadata", "Content light level metadata"):
    print("  %-32s %s" % (want, "present" if want in found else "MISSING"))
'
# The frames themselves, not just the tags: lit frames must land exactly 25 ms apart.
echo "  first cycles:"
ffmpeg -v info -i "$OUT" -vf "select=lt(n\,${FPC}*2),signalstats,metadata=print" -f null - 2>&1 \
  | grep -E "pts_time|YAVG" | paste - - \
  | sed -E 's/\[Parsed_metadata_[0-9]+ @ [^]]*\] //g; s/^/    /'
echo
echo "  This file is only correct on a ${FPS} Hz display. Gate playback on measured refresh."
