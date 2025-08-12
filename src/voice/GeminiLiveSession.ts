import { GoogleGenAI, Modality, Session } from '@google/genai';
import type { LiveServerMessage } from '@google/genai';
import type { VoiceBasedChannel, GuildMember } from 'discord.js';
import {
  joinVoiceChannel,
  VoiceConnectionStatus,
  entersState,
  createAudioPlayer,
  NoSubscriberBehavior,
  AudioPlayer,
  EndBehaviorType,
  createAudioResource,
  StreamType,
} from '@discordjs/voice';
import * as prism from 'prism-media';

type LiveCallbacks = {
  onTranscript?: (text: string) => void | Promise<void>;
  onError?: (err: any) => void | Promise<void>;
};

export class GeminiLiveSession {
  private connection: any;
  private player: AudioPlayer;
  private ai: GoogleGenAI;
  private session: Session | undefined;
  private audioBuffers: Buffer[] = [];
  private sentChunks = 0;
  private sentBytes = 0;
  private opusEncoder: any | undefined;
  private opusOut: any | undefined;

  constructor(
    private channel: VoiceBasedChannel,
    private requester: GuildMember,
    private googleApiKey: string,
    private model: string = 'models/gemini-live-2.5-flash-preview',
    private callbacks: LiveCallbacks = {}
  ) {
    this.player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
    this.ai = new GoogleGenAI({ apiKey: googleApiKey });
  }

  async start(): Promise<void> {
    // Join voice
    console.log('[Live] Joining', this.channel.id);
    this.connection = joinVoiceChannel({
      channelId: this.channel.id,
      guildId: this.channel.guild.id,
      adapterCreator: this.channel.guild.voiceAdapterCreator as any,
      selfDeaf: false,
      selfMute: false,
    });
    await entersState(this.connection, VoiceConnectionStatus.Ready, 15_000);
    try { this.connection.subscribe(this.player); } catch {}
    const receiver = this.connection.receiver;
    const userId = this.requester.id;

    // Setup Gemini Live session
    console.log('[Live] Connecting to Gemini Live');
    this.session = await this.ai.live.connect({
      model: this.model,
      callbacks: {
        onopen: () => { console.log('[Live] Session open'); },
        onmessage: async (message: LiveServerMessage) => {
          try {
            // Prefer raw audio frames from message.data; fallback to serverContent inlineData
            const anyMsg: any = message as any;
            let raw: Buffer | undefined;
            if (anyMsg?.data) {
              if (typeof anyMsg.data === 'string') {
                raw = Buffer.from(anyMsg.data, 'base64');
              } else if (anyMsg.data instanceof ArrayBuffer) {
                raw = Buffer.from(new Uint8Array(anyMsg.data as ArrayBuffer));
              } else if (Buffer.isBuffer(anyMsg.data)) {
                raw = anyMsg.data as Buffer;
              }
            }
            if (!raw) {
              const part = anyMsg?.serverContent?.modelTurn?.parts?.[0];
              if (part?.inlineData?.data) {
                raw = Buffer.from(part.inlineData.data, 'base64');
              }
            }

            if (raw && raw.length > 0) {
              // Model outputs 24kHz PCM16 mono; upsample to 48k for Discord Opus encoder
              const pcm48 = upsample24kTo48k(raw);
              console.log('[Live] Received audio bytes (24k):', raw.length, '→ upsampled 48k bytes:', pcm48.length);
              if (!this.opusEncoder) {
                const { PassThrough } = await import('stream');
                this.opusEncoder = new (prism as any).opus.Encoder({ rate: 48000, channels: 1, frameSize: 960 });
                this.opusOut = new PassThrough();
                this.opusEncoder.pipe(this.opusOut);
                const resource = createAudioResource(this.opusOut as any, { inputType: StreamType.Opus });
                this.player.play(resource);
              }
              this.opusEncoder.write(pcm48);
            }
            if ((anyMsg?.serverContent?.modelTurn?.parts?.[0]?.text)) {
              const txt = anyMsg.serverContent.modelTurn.parts[0].text;
              console.log('[Live] Model text:', txt);
              await this.callbacks.onTranscript?.(txt);
            }
          } catch (err) {
            console.warn('[Live] onmessage error', err);
            await this.callbacks.onError?.(err);
          }
        },
        onerror: async (e: any) => {
          console.warn('[Live] Session error', e);
          await this.callbacks.onError?.(e);
        },
        onclose: () => { console.log('[Live] Session closed'); },
      },
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } },
      },
    });

    // Prompt a short greeting via client content to trigger an initial audio reply
    try {
      await this.session?.sendClientContent({
        turns: [{ role: 'user', parts: [{ text: 'Please say hello to confirm audio output is working.' }] }],
      } as any);
    } catch (e) {
      console.warn('[Live] Greeting via client content failed', e);
    }

    // Keepalive: send short silence every 5s so session stays open until the user speaks
    const silence16k = Buffer.alloc(16000 * 2 * 1, 0); // 1 sec of 16kHz PCM16 mono
    const keepalive = setInterval(async () => {
      try {
        const s: any = this.session as any;
        if (!s?.sendRealtimeInput) return;
        await s.sendRealtimeInput({ media: { data: new Uint8Array(silence16k), mimeType: 'audio/pcm;rate=16000' } });
      } catch (err) {
        console.warn('[Live] keepalive send failed', err);
      }
    }, 5000);
    (keepalive as any).unref?.();

    let lastSpeech = Date.now();
    const idleCheck = setInterval(() => {
      if (Date.now() - lastSpeech > 2 * 60 * 1000) {
        console.log('[Live] Idle timeout, stopping');
        clearInterval(idleCheck);
        this.stop().catch(() => {});
      }
    }, 30_000);
    (idleCheck as any).unref?.();

    receiver.speaking.on('start', (uid: string) => {
      if (uid !== userId) return;
      console.log('[Live] Speaking start from user');
      lastSpeech = Date.now();
      const opusStream = receiver.subscribe(userId, { end: { behavior: EndBehaviorType.AfterSilence, duration: 1200 } });
      const decoder = new (prism as any).opus.Decoder({ frameSize: 960, channels: 1, rate: 48000 });
      const pcmStream: any = (opusStream as any).pipe(decoder);

      pcmStream.on('data', async (chunk: Buffer) => {
        try {
          if (!chunk || chunk.length === 0) return;
          this.sentChunks += 1;
          this.sentBytes += chunk.length;
          // Downsample 48k -> 16k mono
          const pcm16k = downsample48kTo16k(chunk);
          const s: any = this.session as any;
          if (s?.sendRealtimeInput) {
            await s.sendRealtimeInput({ media: { data: new Uint8Array(pcm16k), mimeType: 'audio/pcm;rate=16000' } });
          } else {
            await this.session?.sendClientContent({
              turns: [{ role: 'user', parts: [{ inlineData: { mimeType: 'audio/pcm; rate=16000', data: pcm16k.toString('base64') } }] }],
            } as any);
          }
        } catch (err) {
          console.warn('[Live] send audio error:', err);
          await this.callbacks.onError?.(err);
        }
      });

      pcmStream.once('end', async () => {
        console.log('[Live] Utterance ended');
        lastSpeech = Date.now();
        console.log('[Live] Sent chunks:', this.sentChunks, 'bytes:', this.sentBytes);
      });
    });
  }

  async stop(): Promise<void> {
    console.log('[Live] Stopping');
    try { await this.session?.close(); } catch {}
    try { this.opusEncoder?.end(); } catch {}
    try { this.player.stop(); } catch {}
    try { this.connection?.destroy(); } catch {}
  }
}

// Helpers
function downsample48kTo16k(pcm48: Buffer): Buffer {
  // 16-bit little-endian mono, factor 3
  const samplesView = new DataView(pcm48.buffer, pcm48.byteOffset || 0, pcm48.length);
  const out = new Int16Array(Math.floor((pcm48.length / 2) / 3));
  for (let j = 0, byteIndex = 0; j < out.length; j++, byteIndex += 6) {
    out[j] = samplesView.getInt16(byteIndex, true);
  }
  return Buffer.from(out.buffer);
}

function upsample24kTo48k(pcm24: Buffer): Buffer {
  // 16-bit little-endian mono, duplicate each sample
  const inView = new DataView(pcm24.buffer, pcm24.byteOffset || 0, pcm24.length);
  const out = new Int16Array(Math.floor(pcm24.length / 2) * 2);
  for (let i = 0, j = 0, byteIndex = 0; i < out.length; i += 2, j++, byteIndex += 2) {
    const s = inView.getInt16(byteIndex, true);
    out[i] = s;
    out[i + 1] = s;
  }
  return Buffer.from(out.buffer);
}


