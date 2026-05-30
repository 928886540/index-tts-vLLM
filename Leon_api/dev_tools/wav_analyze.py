import sys, wave, numpy as np, os

def analyze(path):
    w = wave.open(path, 'rb')
    sr, ch, n = w.getframerate(), w.getnchannels(), w.getnframes()
    raw = w.readframes(n); w.close()
    a = np.frombuffer(raw, dtype=np.int16).astype(np.float32)
    if ch > 1:
        a = a.reshape(-1, ch).mean(axis=1)
    dur = len(a) / sr
    peak = float(np.abs(a).max()) if a.size else 0.0
    clip_pct = float(np.mean(np.abs(a) >= 32760) * 100) if a.size else 0.0
    rms = float(np.sqrt(np.mean((a / 32768.0) ** 2))) if a.size else 0.0
    # 20ms window RMS -> silence-gap detection
    win = max(1, int(sr * 0.02))
    nseg = len(a) // win
    gaps = []
    if nseg:
        aw = a[:nseg * win].reshape(nseg, win)
        wrms = np.sqrt(np.mean((aw / 32768.0) ** 2, axis=1))
        silent = wrms < 0.004
        c = 0
        for s in silent:
            if s:
                c += 1
            else:
                if c >= 4:
                    gaps.append(c * 20)
                c = 0
        if c >= 4:
            gaps.append(c * 20)
    # sample-to-sample discontinuities (clicks)
    d = np.abs(np.diff(a)) if a.size > 1 else np.array([0.0])
    big = int(np.sum(d > 8000))
    huge = int(np.sum(d > 16000))
    maxjump = float(d.max())
    name = os.path.basename(path)
    print(f"{name}\n  dur={dur:.1f}s sr={sr} ch={ch} peak={peak:.0f}/32767 clip%={clip_pct:.3f} rms={rms:.3f}")
    print(f"  内部静音段(ms,>=80ms)={gaps[:25]} 共{len(gaps)}段")
    print(f"  采样跳变 >8000={big}  >16000(明显咔哒)={huge}  最大跳变={maxjump:.0f}")

for p in sys.argv[1:]:
    try:
        analyze(p)
    except Exception as e:
        print(f"{p}: ERROR {e}")
