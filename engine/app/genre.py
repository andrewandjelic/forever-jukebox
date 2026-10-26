"""Music style tagging with the Discogs-EffNet model (MTG / Essentia).

Predicts the track's top Discogs styles (e.g. "Electronic---Trance") from
audio alone. The model lives in engine/models (CC BY-NC-SA 4.0, see
https://essentia.upf.edu/models.html); when it or onnxruntime is missing,
tagging is skipped and analysis carries on without genres.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np

MODEL_DIR = Path(__file__).resolve().parent.parent / "models"
MODEL_NAME = "discogs-effnet-bsdynamic-1"
SAMPLE_RATE = 16000
# Matches Essentia's TensorflowPredictEffnetDiscogs defaults.
FRAME_SIZE = 512
HOP_SIZE = 256
PATCH_FRAMES = 128
PATCH_HOP = 62
BATCH = 64


@lru_cache(maxsize=1)
def _load_model():
    import onnxruntime as ort

    session = ort.InferenceSession(str(MODEL_DIR / f"{MODEL_NAME}.onnx"))
    meta = json.loads((MODEL_DIR / f"{MODEL_NAME}.json").read_text())
    return session, meta["classes"]


def _mel_patches(path: str) -> np.ndarray:
    import essentia.standard as es

    audio = es.MonoLoader(filename=path, sampleRate=SAMPLE_RATE, resampleQuality=4)()
    extract = es.TensorflowInputMusiCNN()
    frames = np.array(
        [
            extract(frame)
            for frame in es.FrameGenerator(
                audio, frameSize=FRAME_SIZE, hopSize=HOP_SIZE, startFromZero=True
            )
        ],
        dtype=np.float32,
    )
    if len(frames) < PATCH_FRAMES:
        frames = np.pad(frames, ((0, PATCH_FRAMES - len(frames)), (0, 0)))
    starts = range(0, len(frames) - PATCH_FRAMES + 1, PATCH_HOP)
    return np.stack([frames[s:s + PATCH_FRAMES] for s in starts])


def predict_genres(path: str, top: int = 5) -> Optional[List[Dict[str, Any]]]:
    """Top Discogs styles for the whole track, averaged over ~2s patches."""
    if not (MODEL_DIR / f"{MODEL_NAME}.onnx").exists():
        return None
    try:
        session, classes = _load_model()
    except ImportError:
        return None
    patches = _mel_patches(path)
    activations = np.concatenate(
        [
            session.run(["activations"], {"melspectrogram": patches[i:i + BATCH]})[0]
            for i in range(0, len(patches), BATCH)
        ]
    ).mean(axis=0)
    best = np.argsort(activations)[::-1][:top]
    return [
        {"label": classes[i], "score": round(float(activations[i]), 3)} for i in best
    ]


if __name__ == "__main__":
    import sys
    import time

    for p in sys.argv[1:]:
        t = time.time()
        genres = predict_genres(p) or []
        print(f"{Path(p).name} ({time.time() - t:.1f}s)")
        for g in genres:
            print(f"   {g['score']:.2f}  {g['label']}")
