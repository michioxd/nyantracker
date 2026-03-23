export class OscilloscopeRenderer {
    private readonly phases = new Float32Array(64);
    private readonly smoothedVolumes = new Float32Array(64);
    private readonly smoothedFrequencies = new Float32Array(64);
    private readonly smoothedWaveVariants = new Uint8Array(64);
    private readonly smoothedPcmMixes = new Float32Array(64);
    private readonly contexts = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>();
    private readonly bufferLength = 1024;
    private readonly dataArray = new Uint8Array(1024);

    render(
        canvas: HTMLCanvasElement,
        volume: number,
        frequency: number,
        instrument: number,
        isPcm: boolean,
        channelIndex: number,
        lineColor: string,
        backgroundColor: string,
    ): void {
        let context = this.contexts.get(canvas);
        if (!context) {
            context = canvas.getContext("2d", { alpha: false }) ?? undefined;
            if (context) {
                this.contexts.set(canvas, context);
            }
        }
        if (!context) {
            return;
        }

        if (canvas.width !== canvas.clientWidth) {
            canvas.width = canvas.clientWidth;
        }
        if (canvas.height !== canvas.clientHeight) {
            canvas.height = canvas.clientHeight;
        }

        context.fillStyle = backgroundColor;
        context.fillRect(0, 0, canvas.width, canvas.height);

        context.beginPath();
        context.strokeStyle = lineColor;
        context.lineWidth = 1.5;

        const centerY = canvas.height / 2;
        const phaseIndex = channelIndex % this.phases.length;

        if (volume <= 0.01) {
            this.smoothedVolumes[phaseIndex] = 0;
            context.moveTo(0, centerY);
            context.lineTo(canvas.width, centerY);
            context.stroke();
            return;
        }

        const inputFrequency = frequency > 0 ? frequency : this.smoothedFrequencies[phaseIndex] || 220;
        const previousFrequency = this.smoothedFrequencies[phaseIndex] || inputFrequency;
        const normalizedFrequency = previousFrequency + (inputFrequency - previousFrequency) * 0.3;
        this.smoothedFrequencies[phaseIndex] = normalizedFrequency;

        const nextWaveVariant = instrument % 4;
        const previousWaveVariant = this.smoothedWaveVariants[phaseIndex];
        const waveVariant = instrument > 0 ? nextWaveVariant : previousWaveVariant;
        this.smoothedWaveVariants[phaseIndex] = waveVariant;

        const previousPcmMix = this.smoothedPcmMixes[phaseIndex];
        const pcmMixTarget = isPcm ? 1 : 0;
        const pcmMix = previousPcmMix + (pcmMixTarget - previousPcmMix) * 0.2;
        this.smoothedPcmMixes[phaseIndex] = pcmMix;

        const previousVolume = this.smoothedVolumes[phaseIndex];
        const smoothedVolume = previousVolume + (volume - previousVolume) * 0.35;
        this.smoothedVolumes[phaseIndex] = smoothedVolume;

        const visualFrequency = (normalizedFrequency / 440) * 0.15;

        this.phases[phaseIndex] -= normalizedFrequency * 0.0005;
        const phase = this.phases[phaseIndex];

        for (let i = 0; i < this.bufferLength; i++) {
            const t = i * visualFrequency + phase;

            let modT = t % (Math.PI * 2);
            if (modT < 0) {
                modT += Math.PI * 2;
            }

            let chipWave = 0;
            switch (waveVariant) {
                case 0:
                    chipWave = Math.sin(t);
                    break;
                case 1:
                    chipWave = modT / Math.PI - 1;
                    break;
                case 2:
                    chipWave = Math.sin(t) > 0 ? 0.8 : -0.8;
                    break;
                default:
                    chipWave = Math.abs(modT / Math.PI - 1) * 2 - 1;
                    break;
            }

            const pcmSeed = instrument * 0.173 + (phaseIndex + 1) * 0.619;
            const pcmWave = Math.tanh(
                Math.sin(t + pcmSeed) * 0.72 +
                    Math.sin(t * (2.03 + (instrument % 5) * 0.11) + pcmSeed * 1.7) * 0.24 +
                    Math.sin(t * (3.91 + (phaseIndex % 4) * 0.07) - pcmSeed * 0.9) * 0.15 +
                    Math.sin(t * (6.2 + normalizedFrequency * 0.0015) + pcmSeed * 2.4) * 0.08,
            );

            let wave = chipWave * (1 - pcmMix) + pcmWave * pcmMix;

            let noise = 0;
            if (pcmMix > 0.5) {
                noise = Math.sin(t * 0.37 + phaseIndex * 1.618) * 0.08 + Math.sin(t * 1.91 + pcmSeed) * 0.04;
            } else if (normalizedFrequency < 150) {
                noise = Math.sin(t * 0.37 + phaseIndex * 1.618) * 0.18;
            }
            wave = wave * 0.6 + noise;

            const byteValue = 128 + wave * smoothedVolume * 127;
            this.dataArray[i] = Math.max(0, Math.min(255, byteValue));
        }

        const sliceWidth = (canvas.width * 1.0) / this.bufferLength;
        let x = 0;

        for (let i = 0; i < this.bufferLength; i++) {
            const v = this.dataArray[i] / 128.0;
            const y = (v * canvas.height) / 2;

            if (i === 0) {
                context.moveTo(x, y);
            } else {
                context.lineTo(x, y);
            }

            x += sliceWidth;
        }

        context.lineTo(canvas.width, canvas.height / 2);
        context.stroke();
    }

    reset(channelCount: number): void {
        const count = Math.min(channelCount, this.phases.length);
        for (let index = 0; index < count; index += 1) {
            this.phases[index] = 0;
            this.smoothedVolumes[index] = 0;
            this.smoothedFrequencies[index] = 0;
            this.smoothedWaveVariants[index] = 0;
            this.smoothedPcmMixes[index] = 0;
        }
    }
}
