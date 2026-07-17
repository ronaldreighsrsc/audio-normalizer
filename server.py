import os
import sys
import shutil
import re
import static_ffmpeg

# Force UTF-8 encoding on standard output/error for Windows compatibility
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

# Dynamically add ffmpeg and ffprobe paths before importing pydub
static_ffmpeg.add_paths()

from pydub import AudioSegment
from pydub.effects import compress_dynamic_range as pydub_compress
from flask import Flask, request, jsonify, send_from_directory

app = Flask(__name__, static_folder='web', static_url_path='')

# Constants
INPUT_DIR = "input"
OUTPUT_DIR = "output"
TARGET_DBFS = -14.0
LIMITER_CEILING = -1.0       # Peak ceiling in dBFS
COMPRESSOR_THRESHOLD = 6.0   # dB tolerance before compression
COMPRESSOR_RATIO = 3.0       # Compression ratio (3:1)
COMPRESSOR_CHUNK_MS = 150    # Compression chunk size in ms

# In-memory duration cache
DURATION_CACHE = {}  # filepath -> (mtime, duration_seconds)

# Ensure directories exist
os.makedirs(INPUT_DIR, exist_ok=True)
os.makedirs(OUTPUT_DIR, exist_ok=True)


# ──────────────────────────────────────────────
# DSP Audio Processing Functions
# ──────────────────────────────────────────────

def match_target_amplitude(sound, target_dBFS):
    """
    RMS Normalization: adjusts overall volume to the target dBFS.
    """
    change_in_dBFS = target_dBFS - sound.dBFS
    return sound.apply_gain(change_in_dBFS)


def compress_dynamic_range(audio, target_dBFS, threshold_dB, ratio, chunk_size_ms):
    """
    Smooth dynamic range compression using FFmpeg's native acompressor filter via Pydub.
    """
    # Map threshold_dB to an absolute dBFS value for the compressor.
    # target_dBFS is -14.0. If threshold_dB is 6.0, we want to compress anything above -20.0 dBFS.
    comp_threshold = target_dBFS - threshold_dB
    # Run the native ffmpeg compressor with smooth attack (10ms) and release (150ms)
    return pydub_compress(audio, threshold=comp_threshold, ratio=ratio, attack=10.0, release=150.0)


def apply_limiter(audio, ceiling_dBFS, chunk_size_ms=10):
    """
    Brick-wall peak limiter.
    """
    chunks = [audio[i:i + chunk_size_ms] for i in range(0, len(audio), chunk_size_ms)]
    limited = AudioSegment.empty()

    for chunk in chunks:
        if chunk.max_dBFS > ceiling_dBFS:
            gain_reduction = ceiling_dBFS - chunk.max_dBFS
            chunk = chunk.apply_gain(gain_reduction)
        limited += chunk

    return limited


def clean_name(filename):
    """
    Cleans filename by replacing spaces and characters.
    """
    return filename.replace(" ", "_")


def get_cached_duration(filepath, mtime):
    """
    Reads the audio duration and caches it using the file's modification time.
    """
    if filepath in DURATION_CACHE:
        cached_mtime, cached_dur = DURATION_CACHE[filepath]
        if cached_mtime == mtime:
            return cached_dur

    try:
        audio = AudioSegment.from_file(filepath)
        duration = len(audio) / 1000.0
        DURATION_CACHE[filepath] = (mtime, duration)
        return duration
    except Exception as e:
        print(f"Error reading audio duration for {filepath}: {e}")
        return 0.0


def shift_lrc(input_path, output_path, start_sec, end_sec):
    """
    Parses an LRC file, extracts lyrics lines falling within the trimmer start and end bounds,
    and shifts their timestamps relative to the trimmed start time.
    """
    if not os.path.exists(input_path):
        return
    try:
        with open(input_path, 'r', encoding='utf-8', errors='ignore') as f:
            lines = f.readlines()

        shifted_lines = []
        pattern = re.compile(r'\[(\d+):(\d+(?:\.\d+)?)\]')

        for line in lines:
            matches = list(pattern.finditer(line))
            if not matches:
                # Metadata tags (e.g. [ti:Song Title]) are preserved as is
                shifted_lines.append(line)
                continue

            new_line = line
            should_keep = False
            for match in matches:
                mins = int(match.group(1))
                secs = float(match.group(2))
                time_sec = mins * 60 + secs

                if start_sec <= time_sec <= end_sec:
                    new_time = time_sec - start_sec
                    new_mins = int(new_time // 60)
                    new_secs = new_time % 60
                    formatted = f"{new_mins:02d}:{new_secs:05.2f}"
                    new_line = new_line.replace(match.group(0), f"[{formatted}]")
                    should_keep = True
                else:
                    # Strip timestamps out of bounds
                    new_line = new_line.replace(match.group(0), "")

            if should_keep:
                if new_line.strip():
                    shifted_lines.append(new_line)

        with open(output_path, 'w', encoding='utf-8') as f:
            f.writelines(shifted_lines)
    except Exception as e:
        print(f"Error processing LRC: {e}")


# ──────────────────────────────────────────────
# Flask Routes
# ──────────────────────────────────────────────

@app.route('/')
def index():
    return send_from_directory(app.static_folder, 'index.html')


@app.route('/api/files', methods=['GET'])
def list_files():
    input_files = []
    output_files = []
    supported = ('.mp3', '.m4a', '.wav', '.ogg', '.flac')

    def scan_dir(directory, list_to_fill, folder_type):
        if not os.path.exists(directory):
            os.makedirs(directory, exist_ok=True)
        for filename in os.listdir(directory):
            if filename.lower().endswith(supported):
                filepath = os.path.join(directory, filename)
                try:
                    stat = os.stat(filepath)
                    duration = 0.0
                    
                    # Check if associated LRC lyrics exist
                    base_name = os.path.splitext(filename)[0]
                    has_lrc = (
                        os.path.exists(os.path.join(directory, base_name + '.lrc')) or
                        os.path.exists(os.path.join(directory, base_name + '_private.lrc'))
                    )
                    
                    list_to_fill.append({
                        'name': filename,
                        'size': stat.st_size,
                        'mtime': stat.st_mtime,
                        'duration': duration,
                        'folder': folder_type,
                        'has_lrc': has_lrc
                    })
                except Exception as e:
                    print(f"Skipping directory entry {filename}: {e}")

    scan_dir(INPUT_DIR, input_files, 'input')
    scan_dir(OUTPUT_DIR, output_files, 'output')

    # Sort files by modification date (newest first)
    input_files.sort(key=lambda x: x['mtime'], reverse=True)
    output_files.sort(key=lambda x: x['mtime'], reverse=True)

    return jsonify({
        'input': input_files,
        'output': output_files
    })


@app.route('/audio/input/<path:filename>')
def stream_input(filename):
    return send_from_directory(INPUT_DIR, filename, as_attachment=False)


@app.route('/audio/output/<path:filename>')
def stream_output(filename):
    return send_from_directory(OUTPUT_DIR, filename, as_attachment=False)


@app.route('/api/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return jsonify({'error': 'No se encontró la parte del archivo'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No se seleccionó ningún archivo'}), 400

    filename = clean_name(file.filename)
    dest_path = os.path.join(INPUT_DIR, filename)
    file.save(dest_path)
    
    # Check if accompanying lyric file (.lrc) is present in the request
    if 'lrc' in request.files:
        lrc_file = request.files['lrc']
        if lrc_file.filename != '':
            base_name = os.path.splitext(filename)[0]
            lrc_dest = os.path.join(INPUT_DIR, base_name + '.lrc')
            lrc_file.save(lrc_dest)

    return jsonify({'success': True, 'filename': filename})


@app.route('/api/delete', methods=['POST'])
def delete_file():
    data = request.json or {}
    filename = data.get('filename')
    folder = data.get('folder')

    if not filename or folder not in ('input', 'output'):
        return jsonify({'error': 'Parámetros no válidos'}), 400

    target_dir = INPUT_DIR if folder == 'input' else OUTPUT_DIR
    filepath = os.path.join(target_dir, filename)

    if os.path.exists(filepath):
        os.remove(filepath)
        # Delete associated LRC files
        base_name = os.path.splitext(filename)[0]
        for suffix in ('.lrc', '_private.lrc'):
            lrc_path = os.path.join(target_dir, base_name + suffix)
            if os.path.exists(lrc_path):
                os.remove(lrc_path)

        if filepath in DURATION_CACHE:
            del DURATION_CACHE[filepath]

        return jsonify({'success': True})
    return jsonify({'error': 'Archivo no encontrado'}), 404


@app.route('/api/trim', methods=['POST'])
def trim_audio():
    data = request.json or {}
    filename = data.get('filename')
    start = data.get('start')
    end = data.get('end')
    output_name = data.get('output_name')
    mode = data.get('mode', 'trim_only')

    if not filename or start is None or end is None or not output_name:
        return jsonify({'error': 'Faltan campos obligatorios'}), 400

    input_path = os.path.join(INPUT_DIR, filename)
    if not os.path.exists(input_path):
        return jsonify({'error': 'El archivo de entrada no existe'}), 404

    cleaned_out_name = clean_name(output_name)
    in_ext = os.path.splitext(filename)[1].lower()
    out_ext = os.path.splitext(cleaned_out_name)[1].lower()
    
    if not out_ext:
        cleaned_out_name += in_ext
        out_ext = in_ext

    output_path = os.path.join(OUTPUT_DIR, cleaned_out_name)

    try:
        audio = AudioSegment.from_file(input_path)
        start_ms = int(float(start) * 1000)
        end_ms = int(float(end) * 1000)
        total_ms = len(audio)

        if start_ms < 0: start_ms = 0
        if end_ms > total_ms: end_ms = total_ms
        if start_ms >= end_ms:
            return jsonify({'error': 'El tiempo de inicio debe ser menor al de finalización'}), 400

        trimmed = audio[start_ms:end_ms]
        original_dbfs = trimmed.dBFS

        # DSP Processing pipeline
        if mode == 'trim_basic':
            trimmed = match_target_amplitude(trimmed, TARGET_DBFS)
        elif mode == 'trim_pro':
            trimmed = compress_dynamic_range(
                trimmed, TARGET_DBFS,
                threshold_dB=COMPRESSOR_THRESHOLD,
                ratio=COMPRESSOR_RATIO,
                chunk_size_ms=COMPRESSOR_CHUNK_MS
            )
            trimmed = match_target_amplitude(trimmed, TARGET_DBFS)
            trimmed = apply_limiter(trimmed, ceiling_dBFS=LIMITER_CEILING)

        # Export with clean file types
        export_format = out_ext.replace('.', '')
        if export_format in ['m4a', 'mp4']:
            export_format = 'ipod'

        trimmed.export(output_path, format=export_format)
        final_dbfs = trimmed.dBFS

        # LRC shifting process
        base_name = os.path.splitext(filename)[0]
        lrc_input_path = os.path.join(INPUT_DIR, base_name + '.lrc')
        lrc_private_path = os.path.join(INPUT_DIR, base_name + '_private.lrc')
        lrc_found_path = None

        if os.path.exists(lrc_input_path):
            lrc_found_path = lrc_input_path
        elif os.path.exists(lrc_private_path):
            lrc_found_path = lrc_private_path

        if lrc_found_path:
            cleaned_base = os.path.splitext(cleaned_out_name)[0]
            lrc_output_path = os.path.join(OUTPUT_DIR, cleaned_base + '.lrc')
            shift_lrc(lrc_found_path, lrc_output_path, float(start), float(end))

        return jsonify({
            'success': True,
            'filename': cleaned_out_name,
            'original_dbfs': original_dbfs if original_dbfs != float('-inf') else -99.0,
            'final_dbfs': final_dbfs if final_dbfs != float('-inf') else -99.0,
            'trimmed_duration': len(trimmed) / 1000.0
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'Error de procesamiento DSP: {str(e)}'}), 500


if __name__ == '__main__':
    # Running locally on port 5000
    app.run(host='127.0.0.1', port=5000, debug=True)
