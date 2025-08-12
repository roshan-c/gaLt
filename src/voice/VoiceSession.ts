import {
  joinVoiceChannel,
  VoiceConnectionStatus,
  entersState,
  createAudioPlayer,
  NoSubscriberBehavior,
  EndBehaviorType,
} from '@discordjs/voice';
import type { VoiceBasedChannel, GuildMember } from 'discord.js';
import { Readable } from 'stream';
import * as nacl from 'tweetnacl';
import { transcribeAudioWithGemini } from '../utils/GeminiTranscription';
import * as prism from 'prism-media';

// Simple PCM->WAV wrapper
function pcmToWav(pcm: Buffer, channels = 2, sampleRate = 48000, bitsPerSample = 16): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * bitsPerSample / 8, 28);
  header.writeUInt16LE(channels * bitsPerSample / 8, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export class VoiceSession {
  private connection: any;
  private player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
  private stopRequested = false;
  private onTranscript?: (text: string) => Promise<void> | void;
  
  constructor(
    private channel: VoiceBasedChannel,
    private requester: GuildMember,
    private googleApiKey: string,
    onTranscript?: (text: string) => Promise<void> | void
  ) {
    this.onTranscript = onTranscript;
  }

  async start(): Promise<void> {
    this.connection = joinVoiceChannel({
      channelId: this.channel.id,
      guildId: this.channel.guild.id,
      adapterCreator: this.channel.guild.voiceAdapterCreator as any,
      selfDeaf: false,
      selfMute: false,
    });
    await entersState(this.connection, VoiceConnectionStatus.Ready, 15_000);

    // Subscribe to incoming audio
    const receiver = this.connection.receiver;
    const userId = this.requester.id;
    // End after ~1.5s of silence or after hard timeout
    const opusStream = receiver.subscribe(userId, { end: { behavior: EndBehaviorType.AfterSilence, duration: 1500 } });
    const decoder = new (prism as any).opus.Decoder({ frameSize: 960, channels: 2, rate: 48000 });
    const pcmChunks: Buffer[] = [];
    const pcmStream: Readable = (opusStream as any).pipe(decoder);
    pcmStream.on('data', (chunk: Buffer) => {
      pcmChunks.push(chunk);
    });

    const finalize = async () => {
      if (this.stopRequested) return;
      this.stopRequested = true;
      try {
        const pcm = Buffer.concat(pcmChunks);
        if (pcm.length === 0) {
          await this.onTranscript?.('');
        } else {
          const wav = pcmToWav(pcm);
          const text = await transcribeAudioWithGemini(wav, this.googleApiKey);
          await this.onTranscript?.(text);
        }
      } catch (err) {
        console.error('Voice transcription failed:', err);
        try { await this.onTranscript?.(''); } catch {}
      } finally {
        try { this.connection?.destroy(); } catch {}
      }
    };

    pcmStream.once('end', finalize);
    // Safety timeout (10s)
    setTimeout(finalize, 10_000).unref?.();
  }

  async stop(): Promise<void> {
    this.stopRequested = true;
    try { this.player.stop(); } catch {}
    try { this.connection?.destroy(); } catch {}
  }
}


