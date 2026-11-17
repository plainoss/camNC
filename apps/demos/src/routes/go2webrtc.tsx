import { zodResolver } from '@hookform/resolvers/zod';
import { createFileRoute } from '@tanstack/react-router';
import { CodecName, connect } from '@wbcnc/go2webrtc/client';
import { createClient } from '@wbcnc/go2webrtc/trystero';
import { generatePassword } from '@wbcnc/go2webrtc/url-helpers';
import { Button } from '@wbcnc/ui/components/button';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@wbcnc/ui/components/form';
import { Input } from '@wbcnc/ui/components/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@wbcnc/ui/components/select';
import { toast } from '@wbcnc/ui/components/sonner';
import { useQRCode } from 'next-qrcode';
import { RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

export const Route = createFileRoute('/go2webrtc')({
  component: RouteComponent,
});

const SERVE_URL_TRYSTERO = 'https://cam.camnc.app/webrtc-custom';
const WEBTORRENT_PREFIX = 'webtorrent:?';
const TRYSTERO_PREFIX = 'webrtc+custom://?';

type ParsedValues = { accessToken: string };

function parseConnectionString(raw: string): ParsedValues | null {
  let paramsString = '';

  if (raw.startsWith(WEBTORRENT_PREFIX)) {
    paramsString = raw.slice(WEBTORRENT_PREFIX.length);
  } else if (raw.startsWith(TRYSTERO_PREFIX)) {
    paramsString = raw.slice(TRYSTERO_PREFIX.length);
  } else {
    return null;
  }

  try {
    const params = new URLSearchParams(paramsString);
    const accessToken = params.get('accessToken') || params.get('share');
    return accessToken ? { accessToken } : null;
  } catch {
    return null;
  }
}

const connectionStringSchema = z.string().refine(v => parseConnectionString(v) !== null, {
  message: 'Invalid format. Expected: [prefix]?accessToken=...',
});

const formSchema = z.object({
  method: z.enum(['webtorrent', 'webrtc+custom']).optional(),
  // .default("webrtc+custom"),
  connectionString: connectionStringSchema,
  preferredCodec: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

function useWebRTCStreaming(videoRef: RefObject<HTMLVideoElement | null>) {
  const disconnectRef = useRef<() => Promise<void>>(undefined);
  const [codecInfo, setCodecInfo] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      disconnectRef.current?.();
    };
  }, []);

  const connectStream = useCallback(
    async (values: ParsedValues, method: FormValues['method'], preferredCodec?: string) => {
      console.log(`connecting using ${method}`, values);

      await disconnectRef.current?.();
      disconnectRef.current = undefined;
      setCodecInfo(null);

      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }

      const handleStream = (stream: MediaStream) => {
        if (videoRef.current) {
          const vid = videoRef.current;
          vid.srcObject = stream;
          vid.play().catch(e => console.error('Video play failed:', e));

          const videoTrack = stream.getVideoTracks()[0];
          videoTrack?.addEventListener('unmute', () => {
            const settings = videoTrack.getSettings();
            console.log('video track settings', settings);
          });
        }
      };

      if (method === 'webtorrent') {
        try {
          const { stream } = await connect({
            share: values.accessToken,
            pwd: 'pwd',
            onStatusUpdate(update) {
              toast.info('Status', {
                description: update,
                duration: update === 'connected' ? 3000 : Infinity,
                id: 'status-toast',
              });
            },
            onCodecInfo(codec) {
              setCodecInfo(codec);
            },
            preferredCodec: preferredCodec as CodecName | undefined,
          });
          handleStream(stream);
        } catch (error) {
          console.error('webtorrent connection error', error);
          toast.error('Connection Failed', { description: String(error) });
        }
      } else {
        /* webrtc+custom */
        try {
          const client = createClient({
            accessToken: values.accessToken,
            onStateChange: state => {
              toast.info('Status', {
                description: `Trystero: ${state}`,
                duration: state === 'streaming' ? 3000 : Infinity,
                id: 'status-toast',
              });
            },
          });

          disconnectRef.current = client.disconnect;

          const { stream } = await client.connect();
          handleStream(stream);
          setCodecInfo('');
        } catch (error) {
          console.error('trystero connection error', error);
          toast.error('Connection Failed', { description: String(error) });
        }
      }
    },
    [videoRef]
  );

  return { connectStream, codecInfo };
}

/* ------------------------------------------------------------------ */

function genRandomTrystero() {
  return `${TRYSTERO_PREFIX}${new URLSearchParams({ accessToken: generatePassword(16) }).toString()}`;
}

function getDefaultConnectionString() {
  if (typeof window === 'undefined') return ''; // SSR guard
  let connectionString = (localStorage as any).go2webrtcConnectionString;
  if (!connectionString || (!connectionString.startsWith(WEBTORRENT_PREFIX) && !connectionString.startsWith(TRYSTERO_PREFIX))) {
    connectionString = genRandomTrystero();
    (localStorage as any).go2webrtcConnectionString = connectionString;
  }
  return connectionString;
}

/** QR code that opens the phone page serving the camera for this webrtc+custom connection string. */
export function ConnectionQR({ connectionString }: { connectionString: string }) {
  const parsed = parseConnectionString(connectionString);
  const { SVG } = useQRCode();
  if (!parsed) return null;

  const params = new URLSearchParams({ accessToken: parsed.accessToken });
  const url = `${SERVE_URL_TRYSTERO}?${params.toString()}`;
  return <SVG text={url} />;
}

function useVideoResolution(videoRef: RefObject<HTMLVideoElement | null>) {
  const [videoResolution, setVideoResolution] = useState({
    width: 0,
    height: 0,
  });

  useEffect(() => {
    if (!videoRef.current) return;

    const update = () => {
      if (videoRef.current) {
        setVideoResolution({
          width: videoRef.current.videoWidth,
          height: videoRef.current.videoHeight,
        });
      }
    };

    update();
    const video = videoRef.current;
    video.addEventListener('loadedmetadata', update);
    const id = setInterval(update, 1000);

    return () => {
      video.removeEventListener('loadedmetadata', update);
      clearInterval(id);
    };
  }, [videoRef]);

  return videoResolution;
}

export function ConnectForm({
  onConnect,
}: {
  onConnect: (values: ParsedValues, method: FormValues['method'], preferredCodec?: string) => void;
}) {
  const [defaultConnectionString] = useState(getDefaultConnectionString);
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      connectionString: defaultConnectionString,
      method: defaultConnectionString.startsWith(WEBTORRENT_PREFIX) ? 'webtorrent' : 'webrtc+custom',
    },
  });

  const currentMethod = form.watch('method');

  const isTrystero = currentMethod !== 'webtorrent';

  function onSubmit(values: FormValues) {
    (localStorage as any).go2webrtcConnectionString = values.connectionString;
    const parsed = parseConnectionString(values.connectionString);
    if (parsed) {
      onConnect(parsed, values.method, values.preferredCodec === 'auto' ? undefined : values.preferredCodec);
    }
  }

  const placeholder = isTrystero ? 'webrtc+custom://?accessToken=...' : 'webtorrent:?share=...&pwd=...';

  const description = isTrystero ? 'Paste the full webrtc+custom connection string.' : 'Paste the full webtorrent connection string.';

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 max-w-sm">
        <FormField
          control={form.control}
          name="method"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Connection Method</FormLabel>
              <FormControl>
                <Select
                  value={field.value}
                  onValueChange={(value: string) => {
                    field.onChange(value);
                    const current = form.getValues('connectionString');
                    const parsed = parseConnectionString(current);
                    if (parsed) {
                      const newPrefix = value === 'webtorrent' ? WEBTORRENT_PREFIX : TRYSTERO_PREFIX;
                      const params = new URLSearchParams(parsed).toString();
                      form.setValue('connectionString', `${newPrefix}${params}`);
                    } else {
                      form.setValue('connectionString', '');
                    }
                  }}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a method" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="webtorrent">WebTorrent</SelectItem>
                    <SelectItem value="webrtc+custom">WebRTC Custom</SelectItem>
                  </SelectContent>
                </Select>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="connectionString"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Connection String</FormLabel>
              <FormControl>
                <Input placeholder={placeholder} {...field} />
              </FormControl>
              <FormDescription>{description}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="preferredCodec"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Preferred Codec</FormLabel>
              <FormControl>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <SelectTrigger>
                    <SelectValue placeholder="Codec (Optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto</SelectItem>
                    <SelectItem value="H264">H264</SelectItem>
                    <SelectItem value="VP8">VP8</SelectItem>
                    <SelectItem value="VP9">VP9</SelectItem>
                    <SelectItem value="AV1">AV1</SelectItem>
                  </SelectContent>
                </Select>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex gap-2">
          <Button type="submit">Connect</Button>
          {isTrystero && (
            <Button variant="secondary" type="button" onClick={() => form.setValue('connectionString', genRandomTrystero())}>
              Random
            </Button>
          )}
        </div>

        {isTrystero && <ConnectionQR connectionString={form.watch('connectionString') || ''} />}
      </form>
    </Form>
  );
}

function RouteComponent() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isOverlayVisible, setIsOverlayVisible] = useState(true);
  const videoResolution = useVideoResolution(videoRef);

  const { connectStream, codecInfo } = useWebRTCStreaming(videoRef);

  return (
    <div className="relative min-h-screen overflow-hidden">
      {isOverlayVisible && (
        <div className="relative z-10 p-4 md:p-8 bg-background/80 rounded-lg shadow-md max-w-xl mx-auto mt-4 md:mt-8">
          <Button variant="ghost" size="sm" className="absolute top-2 right-2 px-2 py-1 h-auto" onClick={() => setIsOverlayVisible(false)}>
            Hide
          </Button>
          <div className="space-y-6">
            <h1 className="text-2xl font-semibold">Go2RTC WebRTC Demo</h1>
            <ConnectForm onConnect={connectStream} />
          </div>
        </div>
      )}

      <div className="absolute top-0 left-0 z-20 text-xs text-muted-foreground bg-background/50 rounded-br-lg p-2 flex flex-col items-start">
        <span>
          {videoResolution.width}x{videoResolution.height}
        </span>
        {codecInfo && <span>Codec: {codecInfo}</span>}
      </div>

      <div
        className={`fixed inset-0 z-0 ${!isOverlayVisible ? 'cursor-pointer' : ''}`}
        onClick={() => !isOverlayVisible && setIsOverlayVisible(true)}>
        <video ref={videoRef} controls playsInline muted autoPlay className="w-screen h-screen object-contain bg-black" />
      </div>
    </div>
  );
}
