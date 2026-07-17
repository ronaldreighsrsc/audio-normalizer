import os
import static_ffmpeg
static_ffmpeg.add_paths()
from pydub import AudioSegment
from pydub.effects import compress_dynamic_range

INPUT_FILE = "input/_Me_enamoré_de_alguien_que_también_se_enamoró...__[Cover_completo](MP3_320K).mp3"
OUTPUT_FILE = "output/test_compressor_pydub.mp3"

if os.path.exists(INPUT_FILE):
    print("Loading audio...")
    audio = AudioSegment.from_file(INPUT_FILE)
    print("Applying native dynamic range compression...")
    # Use standard values for smooth vocal compression:
    # Threshold at -20 dBFS, ratio of 3.0 (3:1), attack 10ms, release 150ms
    compressed = compress_dynamic_range(audio, threshold=-20.0, ratio=3.0, attack=10.0, release=150.0)
    
    # Also apply peak limiting or RMS normalization to -14 dBFS
    # RMS Normalization
    change_in_dBFS = -14.0 - compressed.dBFS
    normalized = compressed.apply_gain(change_in_dBFS)
    
    print("Exporting...")
    normalized.export(OUTPUT_FILE, format="mp3")
    print("Success! Saved to output/test_compressor_pydub.mp3")
else:
    print("Test file not found.")
