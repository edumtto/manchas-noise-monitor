const NOISE_MESSAGE_DURATION = 4000; // 4 seconds
const VOLUME_SEGMENT_COUNT = 12;

const TRACKS = {
    'lofi-1': { name: 'Lo-Fi Chill', src: 'music/lofi-study-chill.mp3' },
    'lofi-2': { name: 'Lo-Fi Study Beats', src: 'music/lofi-study-beats.mp3' },
    'lofi-3': { name: 'Midnight Club', src: 'music/alex-morgan-lofi-midnight-club-568164.mp3' },
    'piano-1': { name: 'Soft Piano Reverie', src: 'music/piano-reverie.mp3' },
};

class NoiseMonitor {
    constructor() {
        this.audioContext = null;
        this.microphone = null;
        this.analyzer = null;
        this.isMonitoring = false;
        this.isQuiet = true;
        this.noiseStartTime = null;
        this.quietStartTime = null;
        this.totalQuietTime = 0;
        this.sensitivity = 90;

        this.timerMode = 'countup'; // 'countup' | 'countdown'
        this.countdownDurationMs = 10 * 60 * 1000;

        this.musicAudio = new Audio();
        this.musicAudio.loop = true;
        this.musicAudio.volume = 0.4;
        this.isMusicPlaying = false;

        this.mascot = document.getElementById('mascot');
        this.sleepAnimation = document.getElementById('sleepAnimation');
        this.fullscreenContainer = document.getElementById('fullscreenContainer');
        this.message = document.getElementById('message');
        this.startButton = document.getElementById('startButton');
        this.startButtonIcon = document.getElementById('startButtonIcon');
        this.startButtonText = document.getElementById('startButtonText');
        this.sensitivitySlider = document.getElementById('sensitivitySlider');
        this.sensitivityValue = document.getElementById('sensitivityValue');
        this.timerContainer = document.getElementById('timerContainer');
        this.timerLabel = document.getElementById('timerLabel');
        this.timerDisplay = document.getElementById('timerDisplay');
        this.volumeMeter = document.getElementById('volumeMeter');
        this.volumeStatusDot = document.getElementById('volumeStatusDot');
        this.trackSelect = document.getElementById('trackSelect');
        this.musicPlayButton = document.getElementById('musicPlayButton');
        this.musicVolumeSlider = document.getElementById('musicVolumeSlider');
        this.musicStatus = document.getElementById('musicStatus');
        this.timerVisibleToggle = document.getElementById('timerVisibleToggle');
        this.timerModeToggle = document.getElementById('timerModeToggle');
        this.timerModeLabel = document.getElementById('timerModeLabel');
        this.countdownDurationRow = document.getElementById('countdownDurationRow');
        this.countdownMinutes = document.getElementById('countdownMinutes');

        // Controls toggle elements
        this.controlsToggleBtn = document.getElementById('controlsToggleBtn');
        this.controlsCloseBtn = document.getElementById('controlsCloseBtn');
        this.controlsPanel = document.getElementById('controlsPanel');
        this.fullscreenToggleBtn = document.getElementById('fullscreenToggleBtn');
        this.fullscreenBtnText = document.getElementById('fullscreenBtnText');

        this.noisyMessages = [
            "Please, quiet! 🤫",
            "Shhhh! You woke me up! 🐾",
            "Too noisy! Please whisper! 🔇",
            "Let me sleep peacefully! 💤",
            "Quiet voices, please! 🍃",
            "Inside voices only! ✨"
        ];

        this.buildVolumeMeter();
        this.setupEventListeners();
        this.updateCountdownDurationUI();
        this.updateTimer();
    }

    buildVolumeMeter() {
        this.volumeSegments = [];
        this.volumeMeter.innerHTML = '';
        for (let i = 0; i < VOLUME_SEGMENT_COUNT; i++) {
            const seg = document.createElement('div');
            seg.className = 'volume-seg';
            this.volumeMeter.appendChild(seg);
            this.volumeSegments.push(seg);
        }
    }

    setupEventListeners() {
        // Start / Stop monitoring
        this.startButton.addEventListener('click', () => {
            if (this.isMonitoring) {
                this.stopMonitoring();
            } else {
                this.startMonitoring();
            }
        });

        // Controls drawer toggle & close
        if (this.controlsToggleBtn) {
            this.controlsToggleBtn.addEventListener('click', () => {
                this.toggleControls();
            });
        }

        if (this.controlsCloseBtn) {
            this.controlsCloseBtn.addEventListener('click', () => {
                this.closeControls();
            });
        }

        // Close controls when clicking outside on the background canvas
        document.addEventListener('click', (e) => {
            if (!this.controlsPanel || this.controlsPanel.classList.contains('collapsed')) return;
            const clickedInsidePanel = this.controlsPanel.contains(e.target);
            const clickedToggle = this.controlsToggleBtn && this.controlsToggleBtn.contains(e.target);
            if (!clickedInsidePanel && !clickedToggle) {
                this.closeControls();
            }
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            const activeEl = document.activeElement;
            const isInputFocused = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'SELECT' || activeEl.tagName === 'TEXTAREA');

            if (e.key === 'Escape') {
                this.closeControls();
            } else if (!isInputFocused) {
                if (e.key === 'c' || e.key === 'C' || e.key === 's' || e.key === 'S') {
                    e.preventDefault();
                    this.toggleControls();
                } else if (e.code === 'Space') {
                    e.preventDefault();
                    if (this.isMonitoring) {
                        this.stopMonitoring();
                    } else {
                        this.startMonitoring();
                    }
                } else if (e.key === 'f' || e.key === 'F') {
                    e.preventDefault();
                    this.toggleFullscreen();
                }
            }
        });

        // Fullscreen toggle button
        if (this.fullscreenToggleBtn) {
            this.fullscreenToggleBtn.addEventListener('click', () => {
                this.toggleFullscreen();
            });
            document.addEventListener('fullscreenchange', () => {
                if (this.fullscreenBtnText) {
                    this.fullscreenBtnText.textContent = document.fullscreenElement ? 'Exit Fullscreen' : 'Toggle Fullscreen';
                }
            });
        }

        // Sensitivity slider
        this.sensitivitySlider.addEventListener('input', (e) => {
            this.sensitivity = parseInt(e.target.value);
            this.sensitivityValue.textContent = this.sensitivity;
        });

        // Track selector
        this.trackSelect.addEventListener('change', (e) => {
            this.loadTrack(e.target.value);
        });

        // Music play / pause
        this.musicPlayButton.addEventListener('click', () => {
            this.toggleMusic();
        });

        // Music volume
        this.musicVolumeSlider.addEventListener('input', (e) => {
            this.musicAudio.volume = parseInt(e.target.value) / 100;
        });

        this.musicAudio.addEventListener('playing', () => {
            this.isMusicPlaying = true;
            this.musicPlayButton.classList.add('playing');
            this.musicPlayButton.textContent = '⏸';
            this.musicStatus.textContent = '';
        });

        this.musicAudio.addEventListener('pause', () => {
            this.isMusicPlaying = false;
            this.musicPlayButton.classList.remove('playing');
            this.musicPlayButton.textContent = '▶';
        });

        this.musicAudio.addEventListener('error', () => {
            this.isMusicPlaying = false;
            this.musicPlayButton.classList.remove('playing');
            this.musicPlayButton.textContent = '▶';
            if (this.musicAudio.src) {
                this.musicStatus.textContent = "Track unavailable in /music folder";
            }
        });

        // Timer visibility toggle
        this.timerVisibleToggle.addEventListener('change', (e) => {
            this.timerContainer.classList.toggle('hidden', !e.target.checked);
        });

        // Timer mode toggle (count up vs countdown)
        this.timerModeToggle.addEventListener('change', (e) => {
            this.timerMode = e.target.checked ? 'countdown' : 'countup';
            this.timerModeLabel.textContent = e.target.checked ? 'Counting down' : 'Counting up';
            this.timerLabel.textContent = e.target.checked ? 'Time Left' : 'Quiet Time';
            this.updateCountdownDurationUI();
            this.updateTimer();
        });

        // Countdown duration input
        this.countdownMinutes.addEventListener('input', (e) => {
            const minutes = Math.max(1, Math.min(60, parseInt(e.target.value) || 1));
            this.countdownDurationMs = minutes * 60 * 1000;
            this.updateTimer();
        });
    }

    toggleControls() {
        if (!this.controlsPanel) return;
        const isCollapsed = this.controlsPanel.classList.toggle('collapsed');
        if (this.controlsToggleBtn) {
            this.controlsToggleBtn.classList.toggle('active', !isCollapsed);
            this.controlsToggleBtn.setAttribute('aria-expanded', !isCollapsed);
        }
    }

    closeControls() {
        if (!this.controlsPanel) return;
        this.controlsPanel.classList.add('collapsed');
        if (this.controlsToggleBtn) {
            this.controlsToggleBtn.classList.remove('active');
            this.controlsToggleBtn.setAttribute('aria-expanded', 'false');
        }
    }

    openControls() {
        if (!this.controlsPanel) return;
        this.controlsPanel.classList.remove('collapsed');
        if (this.controlsToggleBtn) {
            this.controlsToggleBtn.classList.add('active');
            this.controlsToggleBtn.setAttribute('aria-expanded', 'true');
        }
    }

    toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {});
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen().catch(() => {});
            }
        }
    }

    loadTrack(trackId) {
        const track = TRACKS[trackId];
        this.musicStatus.textContent = '';

        if (!track) {
            this.musicAudio.pause();
            this.musicAudio.removeAttribute('src');
            this.musicPlayButton.disabled = true;
            return;
        }

        this.musicPlayButton.disabled = false;
        const wasPlaying = this.isMusicPlaying;
        this.musicAudio.src = track.src;
        if (wasPlaying) {
            this.musicAudio.play().catch(() => {});
        }
    }

    toggleMusic() {
        if (!this.musicAudio.src) return;

        if (this.musicAudio.paused) {
            this.musicAudio.play().catch(() => {});
        } else {
            this.musicAudio.pause();
        }
    }

    updateCountdownDurationUI() {
        this.countdownDurationRow.classList.toggle('hidden', this.timerMode !== 'countdown');
    }
    
    async startMonitoring() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.microphone = this.audioContext.createMediaStreamSource(stream);
            this.analyzer = this.audioContext.createAnalyser();
            
            this.analyzer.fftSize = 256;
            this.analyzer.smoothingTimeConstant = 0.8;
            this.microphone.connect(this.analyzer);
            
            this.isMonitoring = true;
            this.startButton.classList.add('stop');
            if (this.startButtonIcon) {
                this.startButtonIcon.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2"></rect></svg>`;
            }
            if (this.startButtonText) this.startButtonText.textContent = 'Stop';
            this.startButton.setAttribute('aria-label', 'Stop Quiet Time');
            this.fullscreenContainer.classList.remove('ghost');
            
            this.quietStartTime = Date.now();
            this.monitorNoise();
            this.sleepAnimation.style.opacity = 1;
            
        } catch (error) {
            console.error('Error accessing microphone:', error);
            alert('Could not access microphone. Please make sure you grant permission and try again.');
        }
    }
    
    stopMonitoring() {
        this.isMonitoring = false;
        if (this.audioContext) {
            this.audioContext.close();
        }
        this.startButton.classList.remove('stop');
        if (this.startButtonIcon) {
            this.startButtonIcon.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 20 12 6 21 6 3"></polygon></svg>`;
        }
        if (this.startButtonText) this.startButtonText.textContent = 'Start';
        this.startButton.setAttribute('aria-label', 'Start Quiet Time');
        this.fullscreenContainer.classList.add('ghost');
        this.resetToQuiet();
    }
    
    monitorNoise() {
        if (!this.isMonitoring) return;
        
        const dataArray = new Uint8Array(this.analyzer.frequencyBinCount);
        this.analyzer.getByteFrequencyData(dataArray);
        
        // Calculate average volume
        const average = dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length;
        const volumePercent = Math.min(100, (average / 255) * 100);

        // Check if noise level exceeds sensitivity threshold
        const threshold = 100 - this.sensitivity;
        const isCurrentlyNoisy = volumePercent > threshold;
        const noisyDuration = this.noiseStartTime ? (Date.now() - this.noiseStartTime) : 0;

        // Update volume meter + traffic-light status dot
        this.renderVolumeMeter(volumePercent, threshold, isCurrentlyNoisy);

        if (isCurrentlyNoisy && this.isQuiet) {
            this.setNoisy();
        } else if (!isCurrentlyNoisy && !this.isQuiet && noisyDuration > NOISE_MESSAGE_DURATION) {
            this.setQuiet();
        }
        
        this.updateTimer();
        requestAnimationFrame(() => this.monitorNoise());
    }
    
    renderVolumeMeter(volumePercent, threshold, isCurrentlyNoisy) {
        const activeCount = Math.round((volumePercent / 100) * VOLUME_SEGMENT_COUNT);
        this.volumeSegments.forEach((seg, i) => {
            seg.classList.toggle('active', i < activeCount);
        });

        let zone = 'green';
        if (isCurrentlyNoisy) {
            zone = 'red';
        } else if (volumePercent > threshold * 0.7) {
            zone = 'yellow';
        }
        this.volumeStatusDot.classList.remove('green', 'yellow', 'red');
        this.volumeStatusDot.classList.add(zone);
    }

    setNoisy() {
        this.isQuiet = false;
        this.mascot.className = 'mascot awake';
        this.mascot.src = 'awakening.png';
        this.fullscreenContainer.classList.add('noisy');
        this.message.textContent = this.getRandomMessage(this.noisyMessages);
        this.message.className = 'message';
        this.sleepAnimation.style.opacity = 0;
        
        // Reset timer when noise is detected
        this.totalQuietTime = 0;
        this.quietStartTime = null;
        this.noiseStartTime = Date.now();
    }
    
    setQuiet() {
        this.isQuiet = true;
        this.mascot.className = 'mascot sleeping';
        this.mascot.src = 'sleeping.png';
        this.fullscreenContainer.classList.remove('noisy');
        this.message.className = 'message quiet';
        this.sleepAnimation.style.opacity = 1;
        
        this.quietStartTime = Date.now();
        this.noiseStartTime = null;
    }
    
    resetToQuiet() {
        this.isQuiet = true;
        this.mascot.className = 'mascot sleeping';
        this.mascot.src = 'sleeping.png';
        this.fullscreenContainer.classList.remove('noisy');
        this.message.textContent = "Click 'Start' to begin!";
        this.message.className = 'message quiet';
        this.sleepAnimation.style.opacity = 0;
        this.volumeSegments.forEach(seg => seg.classList.remove('active'));
        this.volumeStatusDot.classList.remove('yellow', 'red');
        this.volumeStatusDot.classList.add('green');
        this.totalQuietTime = 0;
        this.quietStartTime = null;
        this.noiseStartTime = null;
    }
    
    getRandomMessage(messages) {
        return messages[Math.floor(Math.random() * messages.length)];
    }
    
    updateTimer() {
        let currentQuietTime = 0;
        if (this.quietStartTime && this.isQuiet) {
            currentQuietTime = Date.now() - this.quietStartTime;
        }

        let displayMs = currentQuietTime;
        let isComplete = false;
        if (this.timerMode === 'countdown') {
            displayMs = Math.max(0, this.countdownDurationMs - currentQuietTime);
            isComplete = currentQuietTime >= this.countdownDurationMs;
        }

        const minutes = Math.floor(displayMs / 60000);
        const seconds = Math.floor((displayMs % 60000) / 1000);

        this.timerDisplay.textContent =
            `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        this.timerDisplay.classList.toggle('complete', isComplete);

        if (this.isMonitoring) {
            setTimeout(() => this.updateTimer(), 1000);
        }
    }
}

// Initialize the noise monitor when the page loads
const monitor = new NoiseMonitor();