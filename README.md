# Audio Normalizer

Un script local en Python para normalizar matemáticamente el volumen de archivos de audio (MP3, M4A, WAV, etc.) a `-14 dBFS`, el estándar de la industria.

## Scripts Disponibles

### `normalize.py` — Versión Básica (RMS)
Normalización simple basada en el promedio de energía (RMS) de cada pista. Rápida y efectiva para la mayoría de los casos.

### `normalize_pro.py` — Versión Pro (RMS + Compresión + Limiter)
Versión avanzada que aplica un pipeline de 3 etapas para un resultado de calidad profesional:

1. **Compresión suave del rango dinámico**: Divide la canción en segmentos de 150ms y suaviza las diferencias extremas entre las partes más silenciosas y más ruidosas (ratio 3:1), sin aplastar la dinámica natural.
2. **Normalización RMS**: Ajusta el promedio de energía general al target de -14 dBFS.
3. **Limiter de picos (brick-wall)**: Procesa en micro-segmentos de 10ms y garantiza que ningún pico supere -1 dBFS, eliminando esos momentos donde una canción "sube de golpe".

### `server.py` — Versión Web Interactiva (Soundwave Player & Trimmer) [NUEVO] ✨
Interfaz gráfica de escritorio web moderna para reproducir, gestionar, recortar y procesar tus audios interactivamente:

- **Forma de Onda Interactiva**: Carga y renderiza el audio usando WaveSurfer.js para que puedas arrastrar manijas y seleccionar el rango de corte con precisión.
- **Visualizador Canvas Reactivo**: Dibuja un espectro de frecuencias en tiempo real usando la Web Audio API y muestra un disco de vinilo con animación de rotación.
- **Letras Sincronizadas (LRC)**: Carga y desliza las letras en tiempo real sincronizadamente con la canción.
- **Procesamiento de Recorte y DSP**: Recorta el segmento de audio y guárdalo en `output/` aplicando opcionalmente Normalización RMS o Normalización Pro.
- **Desfase Inteligente de Letras**: Al recortar el audio, también recorta y desplaza los tiempos del archivo `.lrc` asociado para mantener la sincronización perfecta de la letra en la canción recortada.

## Características Comunes

- 🎛 **Normalización basada en RMS**: Calcula e iguala la sonoridad media de la pista de forma precisa.
- 📦 **Cero dependencias externas**: Instala FFmpeg y FFprobe automáticamente en tu entorno virtual a través de la librería `static-ffmpeg`.
- 🛡 **Resiliente**: Incluye manejo de errores (`try/except`) para saltarse archivos corruptos sin detener el proceso general.
- ✨ **Salida limpia**: Genera nombres de archivo limpios (reemplazando espacios por guiones bajos) en la carpeta de destino.
- 🎤 **Soporte para .lrc**: Detecta y copia automáticamente archivos de letras sincronizadas (incluyendo los que terminan en `_private.lrc`).

## Instalación

1. Asegúrate de tener **Python 3** instalado en tu sistema.
2. Abre una terminal (PowerShell o CMD) en la raíz del proyecto.
3. Crea y activa un entorno virtual:
   ```powershell
   python -m venv venv
   .\venv\Scripts\Activate.ps1
   ```
4. Instala las dependencias:
   ```powershell
   pip install -r requirements.txt
   ```

## Uso

1. Coloca todos los archivos de audio que desees procesar dentro de la carpeta `input/`.
2. Ejecuta el script o servidor que prefieras:

   **Interfaz Web Interactiva (Reproductor + Recortador + Normalizador):**
   ```powershell
   python server.py
   ```
   Luego abre tu navegador en: [http://127.0.0.1:5000](http://127.0.0.1:5000)

   **Versión Básica por Lote (rápida CLI):**
   ```powershell
   python normalize.py
   ```

   **Versión Pro por Lote (mejor calidad CLI):**
   ```powershell
   python normalize_pro.py
   ```
3. Los audios procesados y las letras sincronizadas recortadas se encontrarán en la carpeta `output/`.

