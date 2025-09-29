class NoiseMonitor {
    constructor() {
        this.audioContext = null;
        this.microphone = null;
        this.analyzer = null;
        this.isMonitoring = false;
        this.isQuiet = true;
        this.quietStartTime = null;
        this.totalQuietTime = 0;
        this.sensitivity = 30;
        
        this.mascot = document.getElementById('mascot');
        this.fullscreenContainer = document.getElementById('fullscreenContainer');
        this.message = document.getElementById('message');
        this.startButton = document.getElementById('startButton');
        this.sensitivitySlider = document.getElementById('sensitivitySlider');
        this.sensitivityValue = document.getElementById('sensitivityValue');
        this.timerDisplay = document.getElementById('timerDisplay');
        this.volumeBar = document.getElementById('volumeBar');
        
        // this.quietMessages = [
        //     "😴 Zzz... So peaceful and quiet!",
        //     "🌙 Sweet dreams in our quiet forest...",
        //     "🍃 Perfect silence! Keep it up!",
        //     "✨ Sleeping soundly in nature...",
        //     "🦋 So calm and peaceful!"
        // ];
        
        this.noisyMessages = [
            "😱 Please, quiet! 🤫",
            "🐻 Shhhh! You woke me up!",
            "😴 Too noisy! Please whisper!",
            "🌙 Let me sleep peacefully!",
            "🤫 Quiet voices, please!",
            "😮 Inside voices only!"
        ];
        
        this.setupEventListeners();
        this.updateTimer();
    }
    
    setupEventListeners() {
        this.startButton.addEventListener('click', () => {
            if (this.isMonitoring) {
                this.stopMonitoring();
            } else {
                this.startMonitoring();
            }
        });
        
        this.sensitivitySlider.addEventListener('input', (e) => {
            this.sensitivity = parseInt(e.target.value);
            this.sensitivityValue.textContent = this.sensitivity;
        });
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
            this.startButton.textContent = '⏹️';
            this.startButton.classList.add('stop');
            
            this.quietStartTime = Date.now();
            this.monitorNoise();
            
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
        this.startButton.textContent = '▶️';
        this.startButton.classList.remove('stop');
        this.resetToQuiet();
    }
    
    monitorNoise() {
        if (!this.isMonitoring) return;
        
        const dataArray = new Uint8Array(this.analyzer.frequencyBinCount);
        this.analyzer.getByteFrequencyData(dataArray);
        
        // Calculate average volume
        const average = dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length;
        const volumePercent = Math.min(100, (average / 255) * 100);
        
        // Update volume indicator
        this.volumeBar.style.width = volumePercent + '%';
        
        // Check if noise level exceeds sensitivity threshold
        const threshold = ((100 - this.sensitivity) / 100) * 100;
        const isCurrentlyNoisy = volumePercent > threshold;
        
        if (isCurrentlyNoisy && this.isQuiet) {
            this.setNoisy();
        } else if (!isCurrentlyNoisy && !this.isQuiet) {
            this.setQuiet();
        }
        
        this.updateTimer();
        requestAnimationFrame(() => this.monitorNoise());
    }
    
    setNoisy() {
        this.isQuiet = false;
        // this.mascot.textContent = '😱';
        this.mascot.className = 'mascot awake';
        this.mascot.attributes.scr
        this.fullscreenContainer.classList.add('noisy');
        this.message.textContent = this.getRandomMessage(this.noisyMessages);
        this.message.className = 'message noisy';
        
        // Reset timer when noise is detected
        this.totalQuietTime = 0;
        this.quietStartTime = null;
    }
    
    setQuiet() {
        this.isQuiet = true;
        this.mascot.className = 'mascot sleeping';
        this.fullscreenContainer.classList.remove('noisy');
        // this.message.textContent = this.getRandomMessage(this.quietMessages);
        this.message.className = 'message quiet';
        
        this.quietStartTime = Date.now();
    }
    
    resetToQuiet() {
        this.isQuiet = true;
        this.mascot.className = 'mascot sleeping';
        this.fullscreenContainer.classList.remove('noisy');
        this.message.textContent = "▶️";
        this.message.className = 'message quiet';
        this.volumeBar.style.width = '0%';
        this.totalQuietTime = 0;
        this.quietStartTime = null;
    }
    
    getRandomMessage(messages) {
        return messages[Math.floor(Math.random() * messages.length)];
    }
    
    updateTimer() {
        let currentQuietTime = 0;
        if (this.quietStartTime && this.isQuiet) {
            currentQuietTime = Date.now() - this.quietStartTime;
        }
        
        const minutes = Math.floor(currentQuietTime / 60000);
        const seconds = Math.floor((currentQuietTime % 60000) / 1000);
        
        this.timerDisplay.textContent = 
            `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        
        if (this.isMonitoring) {
            setTimeout(() => this.updateTimer(), 1000);
        }
    }
}

// Initialize the noise monitor when the page loads
const monitor = new NoiseMonitor();