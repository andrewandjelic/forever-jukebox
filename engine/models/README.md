# Genre model

`discogs-effnet-bsdynamic-1.onnx` and `.json` are the Discogs-EffNet music style
model by the Music Technology Group, Universitat Pompeu Fabra, from
<https://essentia.upf.edu/models.html>, redistributed unmodified.

**License:** [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)
(attribution, non-commercial, share-alike). This differs from the repository's
MIT license, which covers the code only. Do not use the model commercially.

Used by `engine/app/genre.py` to tag each analyzed track with its top Discogs
styles. Delete this folder to turn genre tagging off; analysis still works.
