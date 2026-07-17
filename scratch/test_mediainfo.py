import time
import os
import static_ffmpeg
static_ffmpeg.add_paths()
from pydub.utils import mediainfo

INPUT_DIR = "input"
files = [f for f in os.listdir(INPUT_DIR) if f.endswith('.mp3')]
if files:
    test_file = os.path.join(INPUT_DIR, files[0])
    print(f"Testing file: {test_file}")
    
    t0 = time.time()
    info = mediainfo(test_file)
    dur = float(info.get('duration', 0.0))
    t1 = time.time()
    
    print(f"Duration: {dur} seconds")
    print(f"Time taken: {(t1 - t0)*1000:.2f} ms")
else:
    print("No mp3 files found.")
