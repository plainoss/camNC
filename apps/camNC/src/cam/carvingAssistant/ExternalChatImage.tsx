import { useEffect, useRef, useState } from 'react';
import { Button } from '@wbcnc/ui/components/button';
import { cn } from '@wbcnc/ui/lib/utils';
import { ClipboardCopy, ImageDown } from 'lucide-react';
import { externalImagePrompt, imageFromTransfer } from './externalImage';
import type { CarvingAssistantSession } from './useCarvingAssistant';

/**
 * No key needed: copy an art-direction prompt to any image chat, then drop, paste or choose the picture it makes. The
 * picture is traced on this device like a generated one.
 */
export function ExternalChatImage({ session }: { session: CarvingAssistantSession }) {
  const { request } = session;
  const [copied, setCopied] = useState(false);
  const [dropping, setDropping] = useState(false);
  // When the browser refuses clipboard access, the prompt is shown to copy by hand.
  const [manual, setManual] = useState('');
  // Coming back from another chat, ⌘V / Ctrl+V anywhere brings the image in; text pastes stay where they are.
  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      const image = imageFromTransfer(event.clipboardData);
      if (!image || session.generating) return;
      event.preventDefault();
      void request.importPng(image);
    };
    window.addEventListener('paste', paste);
    return () => window.removeEventListener('paste', paste);
  }, [request, session.generating]);
  const copyPrompt = async () => {
    const prompt = externalImagePrompt(request.prompt, request.style, session.detail);
    try {
      await navigator.clipboard.writeText(prompt);
      setManual('');
    } catch {
      setManual(prompt);
    }
    setCopied(true);
  };
  const pngInput = useRef<HTMLInputElement>(null);
  return (
    <>
      <div className="grid gap-1.5 rounded-md border p-2 text-xs">
        <span className="text-muted-foreground">Or make it in another chat, such as ChatGPT or Gemini:</span>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" className="flex-1" onClick={() => void copyPrompt()}>
            <ClipboardCopy /> {copied ? 'Prompt copied' : 'Copy prompt'}
          </Button>
          <button
            type="button"
            aria-label="Drop, paste or choose the image"
            className={cn(
              'flex flex-1 items-center justify-center gap-1 rounded-md border border-dashed px-2 text-muted-foreground',
              dropping && 'border-violet-500 bg-violet-500/10 text-foreground'
            )}
            disabled={session.generating}
            onClick={() => pngInput.current?.click()}
            onDragOver={event => {
              event.preventDefault();
              setDropping(true);
            }}
            onDragLeave={() => setDropping(false)}
            onDrop={event => {
              event.preventDefault();
              setDropping(false);
              const image = imageFromTransfer(event.dataTransfer);
              if (image) void request.importPng(image);
            }}>
            <ImageDown className="size-4" /> Drop or paste image
          </button>
        </div>
        {manual && (
          <textarea
            readOnly
            aria-label="Prompt to copy"
            className="rounded border bg-background p-1"
            rows={3}
            value={manual}
            onFocus={event => event.currentTarget.select()}
          />
        )}
        {copied && (
          <span className="text-muted-foreground">
            Paste it into the chat, then drop or paste the picture here. It is traced on this device.
          </span>
        )}
      </div>
      <input
        ref={pngInput}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        aria-label="Image to trace"
        hidden
        onChange={event => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void request.importPng(file);
        }}
      />
    </>
  );
}
