import * as THREE from 'three';
import { WebMidi } from 'webmidi';
import { VideoInputManager } from './VideoInputManager.js';
import { AudioInputManager } from './AudioInputManager.js';

// ============================================
// Logger
// ============================================
class Logger {
    static log(category, message, data = null) {
        const timestamp = new Date().toLocaleTimeString();
        console.log(`[${timestamp}] [${category}]`, message, data || '');
    }

    static midi(message, data) {
        this.log('MIDI', message, data);
    }

    static shader(message, data) {
        this.log('SHADER', message, data);
    }

    static system(message, data) {
        this.log('SYSTEM', message, data);
    }
}

// ============================================
// Shader Manager
// ============================================
class ShaderManager {
    constructor() {
        this.shaders = [];
        this.currentIndex = 0;
        this.loadedShaders = new Map();
    }

    async loadShaderList() {
        try {
            // Get all shader files in the shaders directory
            const glslFiles = import.meta.glob('../shaders/*.{glsl,glsln,gsls}', { as: 'raw' });
            this.shaders = Object.keys(glslFiles).map(path => path.replace('../shaders/', ''));

            Logger.shader('Found shaders:', this.shaders);

            // Preload all shaders
            for (const [path, loader] of Object.entries(glslFiles)) {
                const name = path.replace('../shaders/', '');
                const content = await loader();
                this.loadedShaders.set(name, content);
                Logger.shader(`Loaded: ${name}`);
            }

            return this.shaders.length > 0;
        } catch (error) {
            Logger.shader('Error loading shaders:', error);
            return false;
        }
    }

    getCurrentShader() {
        if (this.shaders.length === 0) return null;
        const name = this.shaders[this.currentIndex];
        return {
            name,
            content: this.loadedShaders.get(name)
        };
    }

    nextShader() {
        if (this.shaders.length === 0) return null;
        this.currentIndex = (this.currentIndex + 1) % this.shaders.length;
        Logger.shader(`Switched to: ${this.shaders[this.currentIndex]}`);
        return this.getCurrentShader();
    }

    previousShader() {
        if (this.shaders.length === 0) return null;
        this.currentIndex = (this.currentIndex - 1 + this.shaders.length) % this.shaders.length;
        Logger.shader(`Switched to: ${this.shaders[this.currentIndex]}`);
        return this.getCurrentShader();
    }

    setShaderByIndex(index) {
        if (index >= 0 && index < this.shaders.length) {
            this.currentIndex = index;
            Logger.shader(`Switched to: ${this.shaders[this.currentIndex]}`);
            return this.getCurrentShader();
        }
        return null;
    }
}

// ============================================
// MIDI Controller
// ============================================
class MIDIController {
    constructor(onShaderChange, onParameterChange) {
        this.onShaderChange = onShaderChange;
        this.onParameterChange = onParameterChange;
        this.currentInput = null;
        this.selector = null;

        // MIDI Mappings
        this.mappings = {
            // -------------- FADER CONTROLS --------------
            vibrance: { type: 'cc', value: 0 },            // CC0 - Vibrance
            hue: { type: 'cc', value: 1 },                // CC1 - Hue rotation
            saturation: { type: 'cc', value: 2 },         // CC2 - Saturation
            grayscale: { type: 'cc', value: 3 },            // CC3 - Grayscale
            contrast: { type: 'cc', value: 4 },            // CC4 - Contrast
            brightness: { type: 'cc', value: 5 },            // CC5 - Brightness
            zoom: { type: 'cc', value: 6 },               // CC6 - Zoom
            videoMix: { type: 'cc', value: 7 },           // CC7 - Video mix amount
            speed: { type: 'cc', value: 16 },             // CC16 - Speed
            audioIntensity: { type: 'cc', value: 17 },    // CC17 - Audio intensity

            // -------------- VIDEO EFFECTS PARAMETERS --------------
            videoRotation: { type: 'cc', value: 18 },     // CC18 - Video rotation
            videoKaleidoscope: { type: 'cc', value: 19 }, // CC19 - Kaleidoscope segments
            videoChromaKey: { type: 'cc', value: 20 },    // CC20 - Chroma key threshold
            videoEdge: { type: 'cc', value: 21 },         // CC21 - Edge detection intensity
            videoColorShift: { type: 'cc', value: 22 },   // CC22 - Color channel shift

            // -------------- AUDIO MODULATION --------------
            audioToHue: { type: 'cc', value: 23 },        // CC23 - Audio modulates Hue
            audioToSaturation: { type: 'cc', value: 24 }, // CC24 - Audio modulates Saturation
            audioToBrightness: { type: 'cc', value: 25 }, // CC25 - Audio modulates Brightness
            audioToZoom: { type: 'cc', value: 26 },       // CC26 - Audio modulates Zoom

            // -------------- VIDEO EFFECT SWITCHES --------------
            videoInvert: { type: 'cc', value: 41 },       // CC41 - Invert video colors toggle
            videoBlur: { type: 'cc', value: 45 },         // CC45 - Blur video toggle
            videoPixelate: { type: 'cc', value: 60 },     // CC60 - Pixelate video toggle

            // -------------- AUDIO DISTORTION EFFECTS --------------
            distortionHorizontal: { type: 'cc', value: 50 }, // CC50 - Horizontal wave distortion
            distortionVertical: { type: 'cc', value: 51 },   // CC51 - Vertical wave distortion
            distortionRadial: { type: 'cc', value: 52 },     // CC52 - Radial/circular distortion
            screenSplit: { type: 'cc', value: 53 },          // CC53 - Screen split mode (0=off, 1=1/8, 2=1/4, 3=grid)

            // -------------- SHADER NAVIGATION --------------
            shaderPrev: { type: 'cc', value: 43 },         // CC43 - Previous shader
            shaderNext: { type: 'cc', value: 44 },         // CC44 - Next shader
            mirror: { type: 'cc', value: 48 },            // CC48 - Mirror toggle (threshold 0.5)
        };
    }

    async init() {
        try {
            this.selector = document.getElementById('midi-selector');

            await WebMidi.enable();
            Logger.midi('WebMIDI enabled successfully');

            // Update device list
            this.updateDeviceList();

            // Setup selector change handler
            if (this.selector) {
                this.selector.addEventListener('change', (e) => {
                    const inputId = e.target.value;
                    if (inputId) {
                        const input = WebMidi.getInputById(inputId);
                        if (input) {
                            this.connectToInput(input);
                        }
                    }
                });
            }

            // Auto-connect to first device if available
            if (WebMidi.inputs.length > 0) {
                this.connectToInput(WebMidi.inputs[0]);
            } else {
                Logger.midi('No MIDI inputs found. Connect a device...');
            }

            // Listen for new devices
            WebMidi.addListener('connected', (e) => {
                Logger.midi('Device connected:', e.port.name);
                if (e.port.type === 'input') {
                    this.updateDeviceList();
                    // Auto-connect if no device is connected
                    if (!this.currentInput) {
                        this.connectToInput(e.port);
                    }
                }
            });

            WebMidi.addListener('disconnected', (e) => {
                Logger.midi('Device disconnected:', e.port.name);
                if (e.port.type === 'input') {
                    this.updateDeviceList();
                    // If current device was disconnected, clear it
                    if (this.currentInput && this.currentInput.id === e.port.id) {
                        this.currentInput = null;
                        this.showLastMidiEvent('Device disconnected');
                    }
                }
            });

        } catch (error) {
            Logger.midi('Error initializing MIDI:', error);
            console.error('MIDI Error:', error);
        }
    }

    updateDeviceList() {
        if (!this.selector) return;

        const inputs = WebMidi.inputs;
        Logger.midi(`Available devices: ${inputs.length}`);

        // Clear and populate selector
        this.selector.innerHTML = '';

        if (inputs.length === 0) {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = 'No MIDI devices';
            this.selector.appendChild(option);
        } else {
            inputs.forEach((input, index) => {
                const option = document.createElement('option');
                option.value = input.id;
                option.textContent = `${index + 1}: ${input.name}`;
                this.selector.appendChild(option);
                Logger.midi(`  [${index}] ${input.name} (${input.id})`);
            });

            // Select current device if exists
            if (this.currentInput) {
                this.selector.value = this.currentInput.id;
            }
        }
    }

    connectToInput(input) {
        // Disconnect from previous input
        if (this.currentInput) {
            Logger.midi(`Disconnecting from: ${this.currentInput.name}`);
            this.currentInput.removeListener();
        }

        Logger.midi(`Connecting to: ${input.name}`);
        this.currentInput = input;

        // Update selector
        if (this.selector) {
            this.selector.value = input.id;
        }

        this.showLastMidiEvent(`Connected to: ${input.name}`);

        // Listen to all note on messages
        input.addListener('noteon', (e) => {
            const msg = `Note ON: ${e.note.name}${e.note.octave} (${e.note.number}) Vel: ${e.rawVelocity}`;
            Logger.midi(msg);
            this.showLastMidiEvent(msg);
            this.handleNoteOn(e.note.number);
        });

        // Listen to all note off messages
        input.addListener('noteoff', (e) => {
            const msg = `Note OFF: ${e.note.name}${e.note.octave} (${e.note.number})`;
            Logger.midi(msg);
            this.showLastMidiEvent(msg);
        });

        // Listen to control change messages
        input.addListener('controlchange', (e) => {
            const msg = `CC${e.controller.number} = ${e.rawValue}/127 (${e.value.toFixed(2)})`;
            Logger.midi(msg);
            this.showLastMidiEvent(msg);
            this.handleCC(e.controller.number, e.value);
        });

        // Listen to pitch bend
        input.addListener('pitchbend', (e) => {
            const msg = `Pitch Bend: ${e.value.toFixed(2)}`;
            Logger.midi(msg);
            this.showLastMidiEvent(msg);
        });

        Logger.midi(`Now listening to: ${input.name}`);
    }

    showLastMidiEvent(message) {
        const element = document.getElementById('last-midi-event');
        if (element) {
            element.textContent = `Last: ${message}`;
        }
    }

    handleNoteOn(note) {
        // Map notes 0-127 to shader selection
        this.onShaderChange('index', note);
    }

    handleCC(cc, value) {
        if (cc === this.mappings.hue.value) {
            // Map 0-1 to 0-360 degrees
            const hue = value * 360;
            this.onParameterChange('hue', hue);
            this.updateUI('hue-value', hue.toFixed(1));
        } else if (cc === this.mappings.saturation.value) {
            this.onParameterChange('saturation', value);
            this.updateUI('sat-value', value.toFixed(2));
        } else if (cc === this.mappings.grayscale.value) {
            this.onParameterChange('grayscale', value);
            this.updateUI('gray-value', value.toFixed(2));
        } else if (cc === this.mappings.contrast.value) {
            // Map 0-1 to 0-2 for contrast range
            const contrast = value * 2.0;
            this.onParameterChange('contrast', contrast);
            this.updateUI('contrast-value', contrast.toFixed(2));
        } else if (cc === this.mappings.brightness.value) {
            // Map 0-1 to 0-2 for brightness range
            const brightness = value * 2.0;
            this.onParameterChange('brightness', brightness);
            this.updateUI('bright-value', brightness.toFixed(2));
        } else if (cc === this.mappings.vibrance.value) {
            this.onParameterChange('vibrance', value);
            this.updateUI('vib-value', value.toFixed(2));
        } else if (cc === this.mappings.shaderNext.value) {
            if (value > 0.5) {  // Trigger on values above threshold
                this.onShaderChange('next');
            }
        } else if (cc === this.mappings.shaderPrev.value) {
            if (value > 0.5) {  // Trigger on values above threshold
                this.onShaderChange('prev');
            }
        } else if (cc === this.mappings.zoom.value) {
            // Map 0-1 to 0.1-5.0 zoom range
            const zoom = 0.1 + value * 4.9;
            this.onParameterChange('zoom', zoom);
            this.updateUI('zoom-value', zoom.toFixed(2));
        } else if (cc === this.mappings.speed.value) {
            // Map 0-1 to 0-4 speed multiplier
            const speed = value * 4.0;
            this.onParameterChange('speed', speed);
            this.updateUI('speed-value', speed.toFixed(2));
        } else if (cc === this.mappings.mirror.value) {
            // Toggle mirror at 0.5 threshold
            const mirror = value > 0.5 ? 1.0 : 0.0;
            this.onParameterChange('mirror', mirror);
            this.updateUI('mirror-value', mirror > 0.5 ? 'ON' : 'OFF');
        } else if (cc === this.mappings.videoMix.value) {
            this.onParameterChange('videoMix', value);
            this.updateUI('video-mix-value', value.toFixed(2));
        } else if (cc === this.mappings.audioIntensity.value) {
            this.onParameterChange('audioIntensity', value);
            this.updateUI('audio-intensity-value', value.toFixed(2));
        } else if (cc === this.mappings.audioToHue.value) {
            this.onParameterChange('audioToHue', value);
        } else if (cc === this.mappings.audioToSaturation.value) {
            this.onParameterChange('audioToSaturation', value);
        } else if (cc === this.mappings.audioToBrightness.value) {
            this.onParameterChange('audioToBrightness', value);
        } else if (cc === this.mappings.audioToZoom.value) {
            this.onParameterChange('audioToZoom', value);
        } else if (cc === this.mappings.videoInvert.value) {
            // Toggle video invert at 0.5 threshold
            const invert = value > 0.5 ? 1.0 : 0.0;
            this.onParameterChange('videoInvert', invert);
            Logger.system(`Video Invert: ${invert > 0.5 ? 'ON' : 'OFF'}`);
        } else if (cc === this.mappings.videoBlur.value) {
            // Toggle video blur at 0.5 threshold
            const blur = value > 0.5 ? 1.0 : 0.0;
            this.onParameterChange('videoBlur', blur);
            Logger.system(`Video Blur: ${blur > 0.5 ? 'ON' : 'OFF'}`);
        } else if (cc === this.mappings.videoPixelate.value) {
            // Toggle video pixelate at 0.5 threshold
            const pixelate = value > 0.5 ? 1.0 : 0.0;
            this.onParameterChange('videoPixelate', pixelate);
            Logger.system(`Video Pixelate: ${pixelate > 0.5 ? 'ON' : 'OFF'}`);
        } else if (cc === this.mappings.videoRotation.value) {
            // Map 0-1 to 0-360 degrees
            const rotation = value * 360.0;
            this.onParameterChange('videoRotation', rotation);
        } else if (cc === this.mappings.videoKaleidoscope.value) {
            // Map 0-1 to 2-16 segments
            const segments = Math.floor(2.0 + value * 14.0);
            this.onParameterChange('videoKaleidoscope', segments);
        } else if (cc === this.mappings.videoChromaKey.value) {
            this.onParameterChange('videoChromaKey', value);
        } else if (cc === this.mappings.videoEdge.value) {
            this.onParameterChange('videoEdge', value);
        } else if (cc === this.mappings.videoColorShift.value) {
            this.onParameterChange('videoColorShift', value);
        } else if (cc === this.mappings.distortionHorizontal.value) {
            this.onParameterChange('distortionHorizontal', value);
            this.updateUI('distortion-h-value', value.toFixed(2));
        } else if (cc === this.mappings.distortionVertical.value) {
            this.onParameterChange('distortionVertical', value);
            this.updateUI('distortion-v-value', value.toFixed(2));
        } else if (cc === this.mappings.distortionRadial.value) {
            this.onParameterChange('distortionRadial', value);
            this.updateUI('distortion-r-value', value.toFixed(2));
        } else if (cc === this.mappings.screenSplit.value) {
            // Map 0-1 to 0-3 (4 modes)
            const mode = Math.floor(value * 3.999);
            this.onParameterChange('screenSplit', mode);
            const modeNames = ['Off', '1/8 Split', '1/4 Split', 'Grid'];
            this.updateUI('screen-split-value', modeNames[mode]);
            Logger.system(`Screen Split Mode: ${modeNames[mode]}`);
        }
    }

    updateUI(id, value) {
        const element = document.getElementById(id);
        if (element) element.textContent = value;
    }
}

// ============================================
// Shader Renderer
// ============================================
class ShaderRenderer {
    constructor() {
        this.scene = new THREE.Scene();
        this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.clock = new THREE.Clock();

        this.renderer.setSize(window.innerWidth, window.innerHeight);
        document.body.appendChild(this.renderer.domElement);

        // Post-processing uniforms (global effects)
        this.globalUniforms = {
            u_vibrance: 0.0,
            u_hue: 0.0,
            u_saturation: 1.0,
            u_grayscale: 0.0,
            u_contrast: 1.0,
            u_brightness: 1.0,
            u_zoom: 1.0,
            u_speed: 1.0,
            u_mirror: 0.0,
            u_videoMix: 0.0,
            u_audioIntensity: 0.0,
            u_audioToHue: 0.0,
            u_audioToSaturation: 0.0,
            u_audioToBrightness: 0.0,
            u_audioToZoom: 0.0,
            u_videoInvert: 0.0,
            u_videoBlur: 0.0,
            u_videoPixelate: 0.0,
            u_videoRotation: 0.0,
            u_videoKaleidoscope: 0.0,
            u_videoChromaKey: 0.0,
            u_videoEdge: 0.0,
            u_videoColorShift: 0.0,
            u_distortionHorizontal: 0.0,
            u_distortionVertical: 0.0,
            u_distortionRadial: 0.0,
            u_screenSplit: 0
        };

        // Video and audio textures
        this.videoTexture = null;
        this.audioData = null;

        // Current shader material
        this.material = null;
        this.mesh = null;

        // Time tracking for speed control
        this.baseTime = 0;

        // Color sync tracking
        this.videoColorSyncCanvas = null;
        this.videoColorSyncCtx = null;
        this.lastColorSyncLog = 0;
        this.colorSyncLogInterval = 500; // Log every 500ms

        // Handle window resize
        window.addEventListener('resize', () => this.onResize());
    }

    createShaderMaterial(fragmentShader) {
        // Wrap the user's fragment shader with our post-processing
        const wrappedFragmentShader = `
            uniform float iTime;
            uniform vec2 iResolution;
            uniform float iTimeDelta;
            uniform int iFrame;

            // Global controls
            uniform float u_vibrance;
            uniform float u_hue;
            uniform float u_saturation;
            uniform float u_grayscale;
            uniform float u_contrast;
            uniform float u_brightness;
            uniform float u_zoom;
            uniform float u_speed;
            uniform float u_mirror;
            uniform float u_videoMix;
            uniform float u_audioIntensity;
            uniform float u_audioToHue;
            uniform float u_audioToSaturation;
            uniform float u_audioToBrightness;
            uniform float u_audioToZoom;
            uniform float u_videoInvert;
            uniform float u_videoBlur;
            uniform float u_videoPixelate;
            uniform float u_videoRotation;
            uniform float u_videoKaleidoscope;
            uniform float u_videoChromaKey;
            uniform float u_videoEdge;
            uniform float u_videoColorShift;
            uniform float u_distortionHorizontal;
            uniform float u_distortionVertical;
            uniform float u_distortionRadial;
            uniform int u_screenSplit;

            // Video and audio
            uniform sampler2D u_videoTexture;
            uniform bool u_hasVideo;
            uniform float u_audioBass;
            uniform float u_audioMid;
            uniform float u_audioTreble;

            // RGB to HSL conversion
            vec3 rgb2hsl(vec3 color) {
                float maxc = max(max(color.r, color.g), color.b);
                float minc = min(min(color.r, color.g), color.b);
                float l = (maxc + minc) / 2.0;

                if (maxc == minc) {
                    return vec3(0.0, 0.0, l);
                }

                float delta = maxc - minc;
                float s = l > 0.5 ? delta / (2.0 - maxc - minc) : delta / (maxc + minc);

                float h;
                if (color.r == maxc) {
                    h = (color.g - color.b) / delta + (color.g < color.b ? 6.0 : 0.0);
                } else if (color.g == maxc) {
                    h = (color.b - color.r) / delta + 2.0;
                } else {
                    h = (color.r - color.g) / delta + 4.0;
                }
                h /= 6.0;

                return vec3(h, s, l);
            }

            // HSL to RGB conversion
            vec3 hsl2rgb(vec3 hsl) {
                float h = hsl.x;
                float s = hsl.y;
                float l = hsl.z;

                float c = (1.0 - abs(2.0 * l - 1.0)) * s;
                float x = c * (1.0 - abs(mod(h * 6.0, 2.0) - 1.0));
                float m = l - c / 2.0;

                vec3 rgb;
                if (h < 1.0/6.0) rgb = vec3(c, x, 0.0);
                else if (h < 2.0/6.0) rgb = vec3(x, c, 0.0);
                else if (h < 3.0/6.0) rgb = vec3(0.0, c, x);
                else if (h < 4.0/6.0) rgb = vec3(0.0, x, c);
                else if (h < 5.0/6.0) rgb = vec3(x, 0.0, c);
                else rgb = vec3(c, 0.0, x);

                return rgb + m;
            }

            ${fragmentShader}

            void main() {
                vec2 fragCoord = gl_FragCoord.xy;

                // Calculate audio modulation (bass is most impactful)
                float audioMod = u_audioBass;

                // Apply audio-reactive distortion effects
                vec2 center = iResolution.xy * 0.5;
                vec2 normalizedCoord = (fragCoord - center) / iResolution.xy;

                // Horizontal wave distortion (audio-reactive)
                if (u_distortionHorizontal > 0.0) {
                    float wave = sin(normalizedCoord.y * 10.0 + iTime * 2.0) * audioMod * u_distortionHorizontal * 50.0;
                    fragCoord.x += wave;
                }

                // Vertical wave distortion (audio-reactive)
                if (u_distortionVertical > 0.0) {
                    float wave = sin(normalizedCoord.x * 10.0 + iTime * 2.0) * audioMod * u_distortionVertical * 50.0;
                    fragCoord.y += wave;
                }

                // Radial/circular distortion (audio-reactive)
                if (u_distortionRadial > 0.0) {
                    float dist = length(normalizedCoord);
                    float angle = atan(normalizedCoord.y, normalizedCoord.x);
                    float waveRadial = sin(dist * 20.0 - iTime * 3.0) * audioMod * u_distortionRadial;
                    fragCoord += vec2(cos(angle), sin(angle)) * waveRadial * 30.0;
                }

                // Screen split modes
                if (u_screenSplit == 1) {
                    // 1/8 split - vertical strips
                    float stripWidth = iResolution.x / 8.0;
                    float stripIndex = floor(fragCoord.x / stripWidth);
                    fragCoord.x = mod(fragCoord.x, stripWidth) + stripIndex * stripWidth;
                    // Apply offset based on audio
                    fragCoord.y += audioMod * 20.0 * sin(stripIndex + iTime);
                } else if (u_screenSplit == 2) {
                    // 1/4 split - quadrants
                    vec2 quadrant = floor(fragCoord / (iResolution.xy * 0.5));
                    fragCoord = mod(fragCoord, iResolution.xy * 0.5);
                    // Apply rotation per quadrant based on audio
                    float quadAngle = (quadrant.x + quadrant.y * 2.0) * 1.57079632679 + audioMod * 0.5;
                    vec2 qCenter = iResolution.xy * 0.25;
                    fragCoord = fragCoord - qCenter;
                    float c = cos(quadAngle);
                    float s = sin(quadAngle);
                    fragCoord = vec2(
                        fragCoord.x * c - fragCoord.y * s,
                        fragCoord.x * s + fragCoord.y * c
                    ) + qCenter;
                } else if (u_screenSplit == 3) {
                    // Grid mode - 4x4
                    vec2 gridSize = iResolution.xy / 4.0;
                    vec2 gridIndex = floor(fragCoord / gridSize);
                    fragCoord = mod(fragCoord, gridSize);
                    // Apply zoom per cell based on audio
                    float cellZoom = 1.0 + audioMod * 0.5 * sin(gridIndex.x + gridIndex.y + iTime);
                    fragCoord = (fragCoord - gridSize * 0.5) * cellZoom + gridSize * 0.5;
                }

                // Apply zoom with audio modulation
                float dynamicZoom = u_zoom + (audioMod * u_audioToZoom * 2.0);
                center = iResolution.xy * 0.5;
                fragCoord = (fragCoord - center) / dynamicZoom + center;

                // Apply mirror effect (horizontal flip at center)
                if (u_mirror > 0.5) {
                    if (fragCoord.x > center.x) {
                        fragCoord.x = center.x - (fragCoord.x - center.x);
                    }
                }

                vec4 color = vec4(0.0);

                // Call the user's mainImage function with modified coordinates
                mainImage(color, fragCoord);

                vec3 finalColor = color.rgb;

                // Apply brightness with audio modulation
                float dynamicBrightness = u_brightness + (audioMod * u_audioToBrightness);
                finalColor *= dynamicBrightness;

                // Apply contrast
                finalColor = (finalColor - 0.5) * u_contrast + 0.5;

                // Apply global color transformations via HSL
                vec3 hsl = rgb2hsl(finalColor);

                // Apply hue rotation with audio modulation
                float dynamicHue = u_hue + (audioMod * u_audioToHue * 360.0);
                hsl.x = mod(hsl.x + dynamicHue / 360.0, 1.0);

                // Apply saturation adjustment with audio modulation
                float dynamicSaturation = u_saturation + (audioMod * u_audioToSaturation);
                hsl.y *= clamp(dynamicSaturation, 0.0, 2.0);

                // Apply vibrance (boost less saturated colors more)
                float satBoost = (1.0 - hsl.y) * u_vibrance;
                hsl.y = clamp(hsl.y + satBoost, 0.0, 1.0);

                finalColor = hsl2rgb(hsl);

                // Apply grayscale
                float gray = dot(finalColor, vec3(0.299, 0.587, 0.114));
                finalColor = mix(finalColor, vec3(gray), u_grayscale);

                // Mix with video texture if available
                if (u_hasVideo && u_videoMix > 0.0) {
                    vec2 videoUV = gl_FragCoord.xy / iResolution.xy;
                    videoUV.y = 1.0 - videoUV.y; // Flip Y coordinate

                    // Center UV for rotation and kaleidoscope
                    vec2 centeredUV = videoUV - 0.5;

                    // Apply rotation
                    if (u_videoRotation > 0.0) {
                        float angle = radians(u_videoRotation);
                        float c = cos(angle);
                        float s = sin(angle);
                        mat2 rotMatrix = mat2(c, -s, s, c);
                        centeredUV = rotMatrix * centeredUV;
                    }

                    // Apply kaleidoscope effect
                    if (u_videoKaleidoscope > 1.0) {
                        float segments = u_videoKaleidoscope;
                        float angle = atan(centeredUV.y, centeredUV.x);
                        float radius = length(centeredUV);
                        float segmentAngle = 3.14159265 * 2.0 / segments;
                        angle = mod(angle, segmentAngle);
                        if (mod(floor(atan(centeredUV.y, centeredUV.x) / segmentAngle), 2.0) < 1.0) {
                            angle = segmentAngle - angle;
                        }
                        centeredUV = vec2(cos(angle), sin(angle)) * radius;
                    }

                    // Convert back to UV space
                    videoUV = centeredUV + 0.5;

                    // Apply pixelate effect to UV coordinates
                    if (u_videoPixelate > 0.5) {
                        float pixelSize = 0.02; // Adjust for desired pixel size
                        videoUV = floor(videoUV / pixelSize) * pixelSize;
                    }

                    // Sample video texture
                    vec3 videoColor = texture2D(u_videoTexture, videoUV).rgb;

                    // Apply blur effect (simple box blur)
                    if (u_videoBlur > 0.5) {
                        float blurSize = 0.003;
                        videoColor = vec3(0.0);
                        for (float x = -2.0; x <= 2.0; x += 1.0) {
                            for (float y = -2.0; y <= 2.0; y += 1.0) {
                                vec2 offset = vec2(x, y) * blurSize;
                                videoColor += texture2D(u_videoTexture, videoUV + offset).rgb;
                            }
                        }
                        videoColor /= 25.0; // Average of 5x5 kernel
                    }

                    // Apply edge detection
                    if (u_videoEdge > 0.0) {
                        vec3 edge = vec3(0.0);
                        float edgeSize = 0.002;
                        vec3 s00 = texture2D(u_videoTexture, videoUV + vec2(-edgeSize, -edgeSize)).rgb;
                        vec3 s10 = texture2D(u_videoTexture, videoUV + vec2(0.0, -edgeSize)).rgb;
                        vec3 s20 = texture2D(u_videoTexture, videoUV + vec2(edgeSize, -edgeSize)).rgb;
                        vec3 s01 = texture2D(u_videoTexture, videoUV + vec2(-edgeSize, 0.0)).rgb;
                        vec3 s21 = texture2D(u_videoTexture, videoUV + vec2(edgeSize, 0.0)).rgb;
                        vec3 s02 = texture2D(u_videoTexture, videoUV + vec2(-edgeSize, edgeSize)).rgb;
                        vec3 s12 = texture2D(u_videoTexture, videoUV + vec2(0.0, edgeSize)).rgb;
                        vec3 s22 = texture2D(u_videoTexture, videoUV + vec2(edgeSize, edgeSize)).rgb;

                        vec3 sobelX = s00 + 2.0 * s10 + s20 - s02 - 2.0 * s12 - s22;
                        vec3 sobelY = s00 + 2.0 * s01 + s02 - s20 - 2.0 * s21 - s22;
                        edge = sqrt(sobelX * sobelX + sobelY * sobelY);

                        videoColor = mix(videoColor, edge, u_videoEdge);
                    }

                    // Apply color channel shift
                    if (u_videoColorShift > 0.0) {
                        float shift = u_videoColorShift * 0.02;
                        float r = texture2D(u_videoTexture, videoUV + vec2(shift, 0.0)).r;
                        float g = texture2D(u_videoTexture, videoUV).g;
                        float b = texture2D(u_videoTexture, videoUV - vec2(shift, 0.0)).b;
                        videoColor = vec3(r, g, b);
                    }

                    // Apply invert effect
                    if (u_videoInvert > 0.5) {
                        videoColor = vec3(1.0) - videoColor;
                    }

                    // Apply chroma key (green screen removal)
                    if (u_videoChromaKey > 0.0) {
                        vec3 keyColor = vec3(0.0, 1.0, 0.0); // Green
                        float dist = distance(videoColor, keyColor);
                        float alpha = smoothstep(u_videoChromaKey * 0.5, u_videoChromaKey, dist);
                        videoColor = mix(finalColor, videoColor, alpha);
                    }

                    // Log color sync values (via uniform updates in JS)
                    finalColor = mix(finalColor, videoColor, u_videoMix);
                }

                gl_FragColor = vec4(finalColor, color.a);
            }
        `;

        const vertexShader = `
            void main() {
                gl_Position = vec4(position, 1.0);
            }
        `;

        return new THREE.ShaderMaterial({
            vertexShader,
            fragmentShader: wrappedFragmentShader,
            uniforms: {
                iTime: { value: 0 },
                iResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
                iTimeDelta: { value: 0 },
                iFrame: { value: 0 },
                u_vibrance: { value: this.globalUniforms.u_vibrance },
                u_hue: { value: this.globalUniforms.u_hue },
                u_saturation: { value: this.globalUniforms.u_saturation },
                u_grayscale: { value: this.globalUniforms.u_grayscale },
                u_contrast: { value: this.globalUniforms.u_contrast },
                u_brightness: { value: this.globalUniforms.u_brightness },
                u_zoom: { value: this.globalUniforms.u_zoom },
                u_speed: { value: this.globalUniforms.u_speed },
                u_mirror: { value: this.globalUniforms.u_mirror },
                u_videoMix: { value: this.globalUniforms.u_videoMix },
                u_audioIntensity: { value: this.globalUniforms.u_audioIntensity },
                u_audioToHue: { value: this.globalUniforms.u_audioToHue },
                u_audioToSaturation: { value: this.globalUniforms.u_audioToSaturation },
                u_audioToBrightness: { value: this.globalUniforms.u_audioToBrightness },
                u_audioToZoom: { value: this.globalUniforms.u_audioToZoom },
                u_videoTexture: { value: null },
                u_hasVideo: { value: false },
                u_audioBass: { value: 0.0 },
                u_audioMid: { value: 0.0 },
                u_audioTreble: { value: 0.0 },
                u_videoInvert: { value: this.globalUniforms.u_videoInvert },
                u_videoBlur: { value: this.globalUniforms.u_videoBlur },
                u_videoPixelate: { value: this.globalUniforms.u_videoPixelate },
                u_videoRotation: { value: this.globalUniforms.u_videoRotation },
                u_videoKaleidoscope: { value: this.globalUniforms.u_videoKaleidoscope },
                u_videoChromaKey: { value: this.globalUniforms.u_videoChromaKey },
                u_videoEdge: { value: this.globalUniforms.u_videoEdge },
                u_videoColorShift: { value: this.globalUniforms.u_videoColorShift },
                u_distortionHorizontal: { value: this.globalUniforms.u_distortionHorizontal },
                u_distortionVertical: { value: this.globalUniforms.u_distortionVertical },
                u_distortionRadial: { value: this.globalUniforms.u_distortionRadial },
                u_screenSplit: { value: this.globalUniforms.u_screenSplit }
            }
        });
    }

    loadShader(shaderContent) {
        try {
            // Remove old mesh
            if (this.mesh) {
                this.scene.remove(this.mesh);
                if (this.material) this.material.dispose();
            }

            // Create new material with shader
            this.material = this.createShaderMaterial(shaderContent);

            // Create fullscreen quad
            const geometry = new THREE.PlaneGeometry(2, 2);
            this.mesh = new THREE.Mesh(geometry, this.material);
            this.scene.add(this.mesh);

            Logger.shader('Shader loaded successfully');
            return true;
        } catch (error) {
            Logger.shader('Error loading shader:', error);
            return false;
        }
    }

    updateGlobalParameter(param, value) {
        this.globalUniforms[`u_${param}`] = value;
        if (this.material && this.material.uniforms[`u_${param}`]) {
            this.material.uniforms[`u_${param}`].value = value;
        }
    }

    setVideoTexture(texture) {
        this.videoTexture = texture;
        if (this.material) {
            this.material.uniforms.u_videoTexture.value = texture;
            this.material.uniforms.u_hasVideo.value = texture !== null;
        }
    }

    setAudioData(audioDataGetter) {
        this.audioData = audioDataGetter;
    }

    getVideoAverageColor() {
        if (!this.videoTexture || !this.videoTexture.image || this.videoTexture.image.readyState !== 4) {
            return { r: 0, g: 0, b: 0, h: 0, s: 0, l: 0 };
        }

        // Create canvas for color sampling if not exists
        if (!this.videoColorSyncCanvas) {
            this.videoColorSyncCanvas = document.createElement('canvas');
            this.videoColorSyncCanvas.width = 16; // Small size for performance
            this.videoColorSyncCanvas.height = 16;
            this.videoColorSyncCtx = this.videoColorSyncCanvas.getContext('2d');
        }

        const ctx = this.videoColorSyncCtx;
        const video = this.videoTexture.image;

        // Draw scaled down video frame
        ctx.drawImage(video, 0, 0, 16, 16);

        // Get image data
        const imageData = ctx.getImageData(0, 0, 16, 16);
        const data = imageData.data;

        // Calculate average color
        let r = 0, g = 0, b = 0;
        const pixelCount = 16 * 16;

        for (let i = 0; i < data.length; i += 4) {
            r += data[i];
            g += data[i + 1];
            b += data[i + 2];
        }

        r = r / pixelCount / 255.0;
        g = g / pixelCount / 255.0;
        b = b / pixelCount / 255.0;

        // Convert to HSL
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const l = (max + min) / 2;
        let h = 0, s = 0;

        if (max !== min) {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

            if (max === r) {
                h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
            } else if (max === g) {
                h = ((b - r) / d + 2) / 6;
            } else {
                h = ((r - g) / d + 4) / 6;
            }
        }

        return { r, g, b, h: h * 360, s, l };
    }

    render() {
        if (!this.material) return;

        const deltaTime = this.clock.getDelta();
        const speed = this.globalUniforms.u_speed;

        // Update time with speed multiplier
        this.baseTime += deltaTime * speed;

        this.material.uniforms.iTime.value = this.baseTime;
        this.material.uniforms.iTimeDelta.value = deltaTime * speed;
        this.material.uniforms.iFrame.value++;

        // Update audio data if available
        if (this.audioData) {
            const data = this.audioData();
            this.material.uniforms.u_audioBass.value = data.bass * this.globalUniforms.u_audioIntensity;
            this.material.uniforms.u_audioMid.value = data.mid * this.globalUniforms.u_audioIntensity;
            this.material.uniforms.u_audioTreble.value = data.treble * this.globalUniforms.u_audioIntensity;
        }

        // Update video texture if available
        if (this.videoTexture && this.videoTexture.image && this.videoTexture.image.readyState === 4) {
            this.videoTexture.needsUpdate = true;

            // Color sync: Sample video color and log periodically
            const now = Date.now();
            if (now - this.lastColorSyncLog > this.colorSyncLogInterval) {
                const videoColor = this.getVideoAverageColor();
                const shaderHue = this.globalUniforms.u_hue;
                const shaderSat = this.globalUniforms.u_saturation;
                const shaderBright = this.globalUniforms.u_brightness;

                Logger.system(
                    `[COLOR SYNC] Video: RGB(${(videoColor.r * 255).toFixed(0)}, ${(videoColor.g * 255).toFixed(0)}, ${(videoColor.b * 255).toFixed(0)}) ` +
                    `HSL(${videoColor.h.toFixed(1)}°, ${(videoColor.s * 100).toFixed(1)}%, ${(videoColor.l * 100).toFixed(1)}%) | ` +
                    `Shader: Hue=${shaderHue.toFixed(1)}° Sat=${shaderSat.toFixed(2)} Bright=${shaderBright.toFixed(2)}`
                );

                this.lastColorSyncLog = now;
            }
        }

        this.renderer.render(this.scene, this.camera);
    }

    onResize() {
        const width = window.innerWidth;
        const height = window.innerHeight;

        this.renderer.setSize(width, height);

        if (this.material && this.material.uniforms.iResolution) {
            this.material.uniforms.iResolution.value.set(width, height);
        }

        Logger.system('Window resized:', { width, height });
    }
}

// ============================================
// Main Application
// ============================================
class ShaderMIDIApp {
    constructor() {
        this.shaderManager = new ShaderManager();
        this.renderer = new ShaderRenderer();
        this.midiController = null;
        this.videoManager = null;
        this.audioManager = null;
        this.infoVisible = true;
    }

    async init() {
        Logger.system('Initializing Shader MIDI Player...');

        // Load shaders
        const shadersLoaded = await this.shaderManager.loadShaderList();
        if (!shadersLoaded) {
            Logger.system('No shaders found!');
            return;
        }

        // Load initial shader
        this.loadCurrentShader();

        // Initialize MIDI
        this.midiController = new MIDIController(
            (action, data) => this.handleShaderChange(action, data),
            (param, value) => this.handleParameterChange(param, value)
        );
        await this.midiController.init();

        // Initialize Video Manager
        this.videoManager = new VideoInputManager((texture) => {
            this.renderer.setVideoTexture(texture);
            Logger.system('Video texture updated');
        });
        this.videoManager.init();

        // Initialize Audio Manager
        this.audioManager = new AudioInputManager((audioDataGetter) => {
            this.renderer.setAudioData(audioDataGetter);
            Logger.system('Audio data source updated');
        });
        this.audioManager.init();

        // Setup keyboard controls
        this.setupKeyboardControls();

        // Start render loop
        this.animate();

        Logger.system('Initialization complete!');
    }

    loadCurrentShader() {
        const shader = this.shaderManager.getCurrentShader();
        if (shader) {
            this.renderer.loadShader(shader.content);
            this.updateUI('current-shader', shader.name);
        }
    }

    handleShaderChange(action, data) {
        if (action === 'next') {
            this.shaderManager.nextShader();
        } else if (action === 'prev') {
            this.shaderManager.previousShader();
        } else if (action === 'index') {
            // Map MIDI note to shader index
            const maxShaders = this.shaderManager.shaders.length;
            const shaderIndex = Math.floor((data / 127) * maxShaders);
            this.shaderManager.setShaderByIndex(shaderIndex);
        }
        this.loadCurrentShader();
    }

    handleParameterChange(param, value) {
        this.renderer.updateGlobalParameter(param, value);
        Logger.system(`Parameter ${param} = ${value.toFixed(2)}`);

        // Speed synchronization for audio
        if (param === 'speed' && this.audioManager) {
            this.audioManager.setSpeed(value);
        }

        // Automatische Kamera-Aktivierung basierend auf audioToHue
        if (param === 'audioToHue') {
            this.handleAudioToHueChange(value);
        }
    }

    async handleAudioToHueChange(audioToHueValue) {
        // Schwellenwert für Kamera-Aktivierung (z.B. 0.48)
        const cameraThreshold = 0.48;
        const thresholdRange = 0.05; // Bereich um den Schwellenwert

        // Prüfe ob audioToHue im Bereich für Kamera-Aktivierung ist
        const isInCameraRange = Math.abs(audioToHueValue - cameraThreshold) < thresholdRange;

        if (isInCameraRange && this.videoManager) {
            // Aktiviere Kamera wenn noch nicht aktiv
            if (this.videoManager.currentSource === 'none' || this.videoManager.currentSource === 'file') {
                // Verwende erste verfügbare Kamera oder bereits ausgewählte
                let deviceToUse = this.videoManager.currentDeviceId;
                if (!deviceToUse && this.videoManager.availableDevices.length > 0) {
                    // Suche nach Logitech-Kamera, sonst erste verfügbare
                    const logitechDevice = this.videoManager.availableDevices.find(
                        d => d.label && d.label.toLowerCase().includes('logitech')
                    );
                    deviceToUse = logitechDevice ? logitechDevice.deviceId : this.videoManager.availableDevices[0].deviceId;
                }
                
                Logger.system(`AudioToHue ${audioToHueValue.toFixed(2)} → Aktiviere Kamera`);
                await this.videoManager.handleCameraChange(deviceToUse || 'default');
                // Update UI selector
                if (this.videoManager.cameraSelector && deviceToUse) {
                    this.videoManager.cameraSelector.value = deviceToUse;
                }
            }

            // Berechne videoMix basierend auf audioToHue
            // Je näher am Schwellenwert, desto stärker die Überblendung
            const distanceFromThreshold = Math.abs(audioToHueValue - cameraThreshold);
            const blendStrength = 1.0 - (distanceFromThreshold / thresholdRange);
            const videoMix = Math.max(0.0, Math.min(1.0, blendStrength));

            this.renderer.updateGlobalParameter('videoMix', videoMix);
            this.updateUI('video-mix-value', videoMix.toFixed(2));
            Logger.system(`Video Mix automatisch auf ${videoMix.toFixed(2)} gesetzt`);
        } else if (!isInCameraRange && this.videoManager && 
                   this.videoManager.currentSource !== 'none' && 
                   this.videoManager.currentSource !== 'file') {
            // Reduziere videoMix außerhalb des optimalen Bereichs
            const distanceFromThreshold = Math.abs(audioToHueValue - cameraThreshold);
            const blendStrength = Math.max(0.0, 1.0 - ((distanceFromThreshold - thresholdRange) / thresholdRange));
            const videoMix = Math.max(0.0, Math.min(1.0, blendStrength));
            
            this.renderer.updateGlobalParameter('videoMix', videoMix);
            this.updateUI('video-mix-value', videoMix.toFixed(2));
            
            // Deaktiviere Kamera nur wenn sehr weit entfernt
            if (distanceFromThreshold > thresholdRange * 1.5) {
                Logger.system(`AudioToHue ${audioToHueValue.toFixed(2)} → Deaktiviere Kamera`);
                await this.videoManager.handleCameraChange('none');
                this.renderer.updateGlobalParameter('videoMix', 0.0);
                this.updateUI('video-mix-value', '0.00');
                // Update UI selector
                if (this.videoManager.cameraSelector) {
                    this.videoManager.cameraSelector.value = 'none';
                }
            }
        }
    }

    setupKeyboardControls() {
        window.addEventListener('keydown', (e) => {
            switch(e.key.toLowerCase()) {
                case 'arrowright':
                case 'n':
                    this.handleShaderChange('next');
                    break;
                case 'arrowleft':
                case 'p':
                    this.handleShaderChange('prev');
                    break;
                case 'h':
                    this.toggleInfo();
                    break;
                case 'f':
                    this.toggleFullscreen();
                    break;
            }
        });

        Logger.system('Keyboard controls: Arrow keys/N/P = change shader, H = toggle info, F = fullscreen');
    }

    toggleInfo() {
        this.infoVisible = !this.infoVisible;
        const info = document.getElementById('info');
        if (info) {
            info.classList.toggle('hidden', !this.infoVisible);
        }
    }

    toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen();
        } else {
            document.exitFullscreen();
        }
    }

    updateUI(id, value) {
        const element = document.getElementById(id);
        if (element) element.textContent = value;
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        this.renderer.render();
    }
}

// ============================================
// Start the application
// ============================================
const app = new ShaderMIDIApp();
app.init();
