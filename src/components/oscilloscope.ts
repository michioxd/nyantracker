export class OscilloscopeRenderer {
    private readonly phases = new Float32Array(64);
    private readonly smoothedVolumes = new Float32Array(64);
    private readonly smoothedFrequencies = new Float32Array(64);
    private readonly smoothedWaveVariants = new Uint8Array(64);
    private readonly contexts = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>();

    render(
        canvas: HTMLCanvasElement,
        volume: number,
        frequency: number,
        instrument: number,
        channelIndex: number,
    ): void {
        let context = this.contexts.get(canvas);
        if (!context) {
            context = canvas.getContext("2d") ?? undefined;
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

        context.fillStyle = "#0c0c0c";
        context.fillRect(0, 0, canvas.width, canvas.height);

        context.beginPath();
        context.strokeStyle = "#4ade80";
        context.lineWidth = 1.5;

        const centerY = canvas.height / 2;
        if (volume <= 0.01) {
            this.smoothedVolumes[channelIndex % this.smoothedVolumes.length] = 0;
            context.moveTo(0, centerY);
            context.lineTo(canvas.width, centerY);
            context.stroke();
            return;
        }

        const step = 2;
        const phaseIndex = channelIndex % this.phases.length;
        const inputFrequency = frequency > 0 ? frequency : this.smoothedFrequencies[phaseIndex] || 220;
        const previousFrequency = this.smoothedFrequencies[phaseIndex] || inputFrequency;
        const normalizedFrequency = previousFrequency + (inputFrequency - previousFrequency) * 0.3;
        this.smoothedFrequencies[phaseIndex] = normalizedFrequency;

        const nextWaveVariant = instrument % 4;
        const previousWaveVariant = this.smoothedWaveVariants[phaseIndex];
        const waveVariant = instrument > 0 ? nextWaveVariant : previousWaveVariant;
        this.smoothedWaveVariants[phaseIndex] = waveVariant;

        const previousVolume = this.smoothedVolumes[phaseIndex];
        const smoothedVolume = previousVolume + (volume - previousVolume) * 0.35;
        this.smoothedVolumes[phaseIndex] = smoothedVolume;

        const visualFrequency = (normalizedFrequency / 440) * 0.15;

        this.phases[phaseIndex] -= normalizedFrequency * 0.0005;
        const phase = this.phases[phaseIndex];

        for (let x = 0; x <= canvas.width; x += step) {
            const t = x * visualFrequency + phase;

            let wave = 0;
            switch (waveVariant) {
                case 0:
                    wave = Math.sin(t);
                    break;
                case 1:
                    wave = (t % (Math.PI * 2)) / Math.PI - 1;
                    break;
                case 2:
                    wave = Math.sin(t) > 0 ? 0.8 : -0.8;
                    break;
                default:
                    wave = Math.abs((t % (Math.PI * 2)) / Math.PI - 1) * 2 - 1;
                    break;
            }

            let noise = 0;
            if (normalizedFrequency < 150) {
                noise = Math.sin(t * 0.37 + phaseIndex * 1.618) * 0.18;
            }
            wave = wave * 0.6 + noise;

            const y = centerY + wave * smoothedVolume * canvas.height * 0.4;

            if (x === 0) {
                context.moveTo(x, y);
            } else {
                context.lineTo(x, y);
            }
        }

        context.stroke();
    }
}
