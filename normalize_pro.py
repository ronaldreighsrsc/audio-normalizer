import os
import sys
import shutil
import static_ffmpeg

# Forzar salida UTF-8 en la consola de Windows (soporta emojis, cirílico, georgiano, etc.)
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

# Agrega ffmpeg y ffprobe al PATH del entorno actual automáticamente ANTES de importar pydub
static_ffmpeg.add_paths()

from pydub import AudioSegment
from pydub.effects import compress_dynamic_range as pydub_compress

INPUT_DIR = "input"
OUTPUT_DIR = "output"
TARGET_DBFS = -14.0
LIMITER_CEILING = -1.0       # Techo máximo de picos en dBFS
COMPRESSOR_THRESHOLD = 6.0   # dB de tolerancia antes de comprimir
COMPRESSOR_RATIO = 3.0       # Ratio de compresión (3:1)
COMPRESSOR_CHUNK_MS = 150    # Tamaño de cada segmento en milisegundos

# ──────────────────────────────────────────────
# Funciones de procesamiento de audio
# ──────────────────────────────────────────────

def match_target_amplitude(sound, target_dBFS):
    """
    Normalización RMS: calcula la diferencia entre los dBFS actuales
    y el objetivo, luego aplica ganancia o atenuación uniforme.
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
    Limiter de picos (brick-wall).
    
    Procesa el audio en micro-segmentos y atenúa SOLO aquellos
    cuyo pico máximo exceda el techo definido. Esto garantiza que
    ningún momento de la canción supere el ceiling sin afectar
    el resto del audio.
    
    Parámetros:
        ceiling_dBFS:   Nivel máximo permitido para picos (ej: -1.0 dBFS).
        chunk_size_ms:  Tamaño del micro-segmento (10ms = muy granular).
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
    Limpia el nombre del archivo reemplazando espacios y caracteres conflictivos.
    """
    return filename.replace(" ", "_")


# ──────────────────────────────────────────────
# Flujo principal
# ──────────────────────────────────────────────

def main():
    os.makedirs(INPUT_DIR, exist_ok=True)
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    supported_extensions = ('.mp3', '.m4a', '.wav', '.ogg', '.flac')

    files_processed = 0
    files_failed = 0

    print("=" * 60)
    print("  AUDIO NORMALIZER PRO")
    print("  RMS Normalization + Dynamic Compression + Peak Limiter")
    print("=" * 60)
    print(f"  Target RMS:            {TARGET_DBFS} dBFS")
    print(f"  Limiter Ceiling:       {LIMITER_CEILING} dBFS")
    print(f"  Compression Ratio:     {COMPRESSOR_RATIO}:1")
    print(f"  Compression Threshold: ±{COMPRESSOR_THRESHOLD} dB")
    print("=" * 60)
    print(f"\nBuscando archivos de audio en '{INPUT_DIR}'...\n")

    for filename in os.listdir(INPUT_DIR):
        if not filename.lower().endswith(supported_extensions):
            continue

        input_path = os.path.join(INPUT_DIR, filename)
        cleaned_filename = clean_name(filename)
        output_path = os.path.join(OUTPUT_DIR, cleaned_filename)

        if os.path.exists(output_path):
            print(f"Saltando (ya procesado): {cleaned_filename}")
            continue

        print(f"Procesando: {filename}")
        try:
            audio = AudioSegment.from_file(input_path)
            original_dBFS = audio.dBFS

            # Paso 1: Compresión suave del rango dinámico
            audio = compress_dynamic_range(
                audio, TARGET_DBFS,
                threshold_dB=COMPRESSOR_THRESHOLD,
                ratio=COMPRESSOR_RATIO,
                chunk_size_ms=COMPRESSOR_CHUNK_MS
            )

            # Paso 2: Normalización RMS al target
            audio = match_target_amplitude(audio, TARGET_DBFS)

            # Paso 3: Limiter de picos (brick-wall)
            audio = apply_limiter(audio, ceiling_dBFS=LIMITER_CEILING)

            # Determinar formato de exportación
            export_format = filename.split('.')[-1].lower()
            if export_format in ['m4a', 'mp4']:
                export_format = 'ipod'

            audio.export(output_path, format=export_format)

            final_dBFS = audio.dBFS
            print(f"  [{original_dBFS:+.1f} dB] -> [{final_dBFS:+.1f} dB]  [Éxito] -> {cleaned_filename}")

            # Buscar y copiar archivo .lrc si existe (soporta sufijo _private)
            base_name = os.path.splitext(filename)[0]
            lrc_input_path = os.path.join(INPUT_DIR, base_name + '.lrc')
            lrc_private_path = os.path.join(INPUT_DIR, base_name + '_private.lrc')

            lrc_found_path = None
            if os.path.exists(lrc_input_path):
                lrc_found_path = lrc_input_path
            elif os.path.exists(lrc_private_path):
                lrc_found_path = lrc_private_path

            if lrc_found_path:
                cleaned_base = os.path.splitext(cleaned_filename)[0]
                lrc_output_path = os.path.join(OUTPUT_DIR, cleaned_base + '.lrc')
                shutil.copy2(lrc_found_path, lrc_output_path)
                print(f"  [Letra sincronizada copiada] -> {cleaned_base}.lrc")

            files_processed += 1

        except Exception as e:
            print(f"  [Error] No se pudo procesar. Detalle: {e}")
            files_failed += 1

    print("\n" + "=" * 60)
    print("  RESUMEN DE NORMALIZACIÓN PRO")
    print("=" * 60)
    print(f"  Archivos procesados: {files_processed}")
    print(f"  Archivos fallidos:   {files_failed}")
    print("=" * 60)


if __name__ == "__main__":
    main()
