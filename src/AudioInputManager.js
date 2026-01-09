// ============================================
// Audio Input Manager
// ============================================
export class AudioInputManager {
    constructor(onAudioReady) {
        this.onAudioReady = onAudioReady;
        this.audioContext = null;
        this.analyser = null;
        this.dataArray = null;
        this.frequencyData = null;
        this.stream = null;
        this.audioElement = null;
        this.source = null;
        this.currentSource = 'none';
        this.selector = null;
        this.deviceSelector = null;
        this.fileInput = null;
        this.canvas = null;
        this.canvasCtx = null;
        this.isAnalyzing = false;
        this.availableDevices = [];
        this.currentDeviceId = null;
    }

    async init() {
        this.selector = document.getElementById('audio-selector');
        this.deviceSelector = document.getElementById('audio-device-selector');
        this.fileInput = document.getElementById('audio-file');
        this.canvas = document.getElementById('audio-canvas');

        if (!this.selector || !this.fileInput || !this.canvas) {
            console.error('Audio UI elements not found');
            return;
        }

        this.canvasCtx = this.canvas.getContext('2d');
        this.canvas.width = this.canvas.offsetWidth;
        this.canvas.height = this.canvas.offsetHeight;

        // Setup selector change handler
        this.selector.addEventListener('change', (e) => {
            this.handleSourceChange(e.target.value);
        });

        // Setup device selector change handler
        if (this.deviceSelector) {
            this.deviceSelector.addEventListener('change', (e) => {
                if (this.currentSource === 'microphone') {
                    this.currentDeviceId = e.target.value;
                    this.startMicrophone(this.currentDeviceId);
                }
            });
        }

        // Setup file input handler
        this.fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                this.loadAudioFile(file);
            }
        });

        // Enumerate audio input devices
        await this.updateAudioDevices();

        // Listen for device changes
        navigator.mediaDevices.addEventListener('devicechange', () => {
            console.log('[AUDIO] Device change detected');
            this.updateAudioDevices();
        });

        console.log('[AUDIO] Audio input manager initialized');
    }

    async updateAudioDevices() {
        try {
            // Request permission first
            try {
                const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                tempStream.getTracks().forEach(track => track.stop());
            } catch (e) {
                console.warn('[AUDIO] Permission request failed:', e.message);
            }

            const devices = await navigator.mediaDevices.enumerateDevices();
            this.availableDevices = devices.filter(device => device.kind === 'audioinput');

            console.log(`[AUDIO] Found ${this.availableDevices.length} audio input device(s):`);
            this.availableDevices.forEach((device, index) => {
                const label = device.label || `Microphone ${index + 1}`;
                console.log(`[AUDIO]   [${index}] ${label}`);

                // Detect external soundcards
                const lowerLabel = label.toLowerCase();
                if (lowerLabel.includes('volt') || lowerLabel.includes('focusrite') ||
                    lowerLabel.includes('scarlett') || lowerLabel.includes('motu')) {
                    console.log(`[AUDIO]       ✓ External audio interface detected!`);
                }
            });

            // Update device selector if exists
            if (this.deviceSelector) {
                this.updateDeviceSelector();
            }
        } catch (error) {
            console.error('[AUDIO] Error enumerating devices:', error);
        }
    }

    updateDeviceSelector() {
        if (!this.deviceSelector) return;

        this.deviceSelector.innerHTML = '';

        if (this.availableDevices.length > 0) {
            this.availableDevices.forEach((device, index) => {
                const option = document.createElement('option');
                option.value = device.deviceId;
                const label = device.label || `Microphone ${index + 1}`;
                const lowerLabel = label.toLowerCase();

                // Highlight external interfaces
                if (lowerLabel.includes('volt') || lowerLabel.includes('focusrite') ||
                    lowerLabel.includes('scarlett') || lowerLabel.includes('motu')) {
                    option.textContent = `🎚️ ${label}`;
                } else {
                    option.textContent = label;
                }

                this.deviceSelector.appendChild(option);
            });

            if (this.currentDeviceId) {
                this.deviceSelector.value = this.currentDeviceId;
            }
        } else {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = 'No audio devices found';
            this.deviceSelector.appendChild(option);
        }
    }

    async handleSourceChange(source) {
        this.currentSource = source;
        console.log(`[AUDIO] Switching to source: ${source}`);

        // Stop current audio
        this.stopCurrentAudio();

        switch (source) {
            case 'microphone':
                await this.startMicrophone(this.currentDeviceId);
                break;
            case 'file':
                this.fileInput.click();
                break;
            case 'desktop':
                await this.startDesktopAudio();
                break;
            case 'none':
                this.canvas.style.display = 'none';
                this.onAudioReady(null);
                if (this.deviceSelector) {
                    this.deviceSelector.style.display = 'none';
                }
                break;
        }
    }

    async startMicrophone(deviceId = null) {
        try {
            const constraints = {
                audio: deviceId ? { deviceId: { exact: deviceId } } : true
            };

            this.stream = await navigator.mediaDevices.getUserMedia(constraints);
            this.setupAudioAnalyzer();
            this.source = this.audioContext.createMediaStreamSource(this.stream);
            this.source.connect(this.analyser);

            this.canvas.style.display = 'block';
            if (this.deviceSelector) {
                this.deviceSelector.style.display = 'block';
            }
            this.startVisualization();
            this.onAudioReady(this.getAudioData.bind(this));

            const deviceName = deviceId ?
                (this.availableDevices.find(d => d.deviceId === deviceId)?.label || 'Unknown') :
                'Default Microphone';
            console.log(`[AUDIO] Microphone started successfully: ${deviceName}`);
        } catch (error) {
            console.error('[AUDIO] Error accessing microphone:', error);
            alert('Could not access microphone. Please check permissions.');
            this.selector.value = 'none';
        }
    }

    async startDesktopAudio() {
        try {
            // Note: This requires Chrome with --enable-features=WebRTCPipeWireCapturer flag
            // or getDisplayMedia with audio:true
            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: false,
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false
                }
            });

            this.stream = stream;
            this.setupAudioAnalyzer();
            this.source = this.audioContext.createMediaStreamSource(this.stream);
            this.source.connect(this.analyser);

            this.canvas.style.display = 'block';
            this.startVisualization();
            this.onAudioReady(this.getAudioData.bind(this));

            console.log('[AUDIO] Desktop audio capture started');
        } catch (error) {
            console.error('[AUDIO] Error accessing desktop audio:', error);
            alert('Desktop audio capture failed. This feature requires Chrome/Edge with specific flags enabled.');
            this.selector.value = 'none';
        }
    }

    loadAudioFile(file) {
        const url = URL.createObjectURL(file);
        this.audioElement = new Audio(url);
        this.audioElement.loop = true;
        this.audioElement.crossOrigin = 'anonymous';
        this.audioElement.playbackRate = 1.0; // Default playback rate

        this.audioElement.addEventListener('canplaythrough', () => {
            this.setupAudioAnalyzer();
            this.source = this.audioContext.createMediaElementSource(this.audioElement);
            this.source.connect(this.analyser);
            this.analyser.connect(this.audioContext.destination);

            this.audioElement.play();
            this.canvas.style.display = 'block';
            this.startVisualization();
            this.onAudioReady(this.getAudioData.bind(this));

            console.log('[AUDIO] Audio file loaded:', file.name);
        }, { once: true });
    }

    setupAudioAnalyzer() {
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }

        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 256;
        this.analyser.smoothingTimeConstant = 0.8;

        const bufferLength = this.analyser.frequencyBinCount;
        this.dataArray = new Uint8Array(bufferLength);
        this.frequencyData = new Float32Array(bufferLength);

        console.log('[AUDIO] Audio analyzer setup complete');
    }

    startVisualization() {
        if (this.isAnalyzing) return;
        this.isAnalyzing = true;
        this.visualize();
    }

    visualize() {
        if (!this.isAnalyzing) return;

        requestAnimationFrame(() => this.visualize());

        this.analyser.getByteFrequencyData(this.dataArray);

        // Draw visualization
        this.canvasCtx.fillStyle = 'rgba(0, 0, 0, 0.2)';
        this.canvasCtx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        const barWidth = (this.canvas.width / this.dataArray.length) * 2.5;
        let barHeight;
        let x = 0;

        for (let i = 0; i < this.dataArray.length; i++) {
            barHeight = (this.dataArray[i] / 255) * this.canvas.height;

            const hue = (i / this.dataArray.length) * 360;
            this.canvasCtx.fillStyle = `hsl(${hue}, 100%, 50%)`;
            this.canvasCtx.fillRect(x, this.canvas.height - barHeight, barWidth, barHeight);

            x += barWidth + 1;
        }
    }

    getAudioData() {
        if (!this.analyser) {
            return {
                frequency: new Float32Array(128),
                waveform: new Float32Array(128),
                intensity: 0.0,
                bass: 0.0,
                mid: 0.0,
                treble: 0.0
            };
        }

        this.analyser.getByteFrequencyData(this.dataArray);

        // Normalize frequency data to 0-1 range
        for (let i = 0; i < this.frequencyData.length; i++) {
            this.frequencyData[i] = this.dataArray[i] / 255.0;
        }

        // Calculate intensity and frequency bands
        const bass = this.getAverageBand(0, 10);
        const mid = this.getAverageBand(10, 50);
        const treble = this.getAverageBand(50, 128);
        const intensity = (bass + mid + treble) / 3.0;

        return {
            frequency: this.frequencyData,
            waveform: new Float32Array(this.dataArray.length),
            intensity,
            bass,
            mid,
            treble
        };
    }

    getAverageBand(startIndex, endIndex) {
        if (!this.frequencyData) return 0;

        let sum = 0;
        for (let i = startIndex; i < endIndex && i < this.frequencyData.length; i++) {
            sum += this.frequencyData[i];
        }
        return sum / (endIndex - startIndex);
    }

    stopCurrentAudio() {
        this.isAnalyzing = false;

        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }

        if (this.audioElement) {
            this.audioElement.pause();
            this.audioElement.src = '';
            this.audioElement = null;
        }

        if (this.source) {
            this.source.disconnect();
            this.source = null;
        }

        if (this.analyser) {
            this.analyser.disconnect();
            this.analyser = null;
        }

        console.log('[AUDIO] Stopped current audio');
    }

    isActive() {
        return this.currentSource !== 'none' && this.analyser !== null;
    }

    resume() {
        if (this.audioContext && this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }
    }

    setSpeed(speed) {
        if (this.audioElement) {
            // Clamp speed between 0.25 and 4.0 for audio playback
            this.audioElement.playbackRate = Math.max(0.25, Math.min(4.0, speed));
            console.log(`[AUDIO] Playback rate set to ${this.audioElement.playbackRate.toFixed(2)}`);
        }
    }
}
