import { useRef, type RefObject } from 'react';
import type { AssistantImage } from './provider';
import { readAssistantImage } from './images';

/** Message box with the context it is sent with, reference images and Send/Stop. */
export function Composer({
  composer,
  text,
  onText,
  images,
  onImages,
  imagesSupported,
  readingImage,
  onReadingImage,
  context,
  running,
  canSend,
  onSend,
  onStop,
  onError,
}: {
  composer: RefObject<HTMLTextAreaElement | null>;
  text: string;
  onText: (text: string) => void;
  images: AssistantImage[];
  onImages: (update: (images: AssistantImage[]) => AssistantImage[]) => void;
  imagesSupported: boolean;
  readingImage: boolean;
  onReadingImage: (reading: boolean) => void;
  context: string;
  running: boolean;
  canSend: boolean;
  onSend: () => void;
  onStop: () => void;
  onError: (message: string) => void;
}) {
  const attachable = !running && !readingImage && imagesSupported && images.length < 3;
  const picker = useRef<HTMLInputElement>(null);
  return (
    <form
      className="cad-assistant-composer"
      onSubmit={event => {
        event.preventDefault();
        onSend();
      }}>
      <span className="cad-assistant-context" title="Sent with your message">
        {context}
      </span>
      <label>
        <span className="cad-assistant-sr">Message</span>
        <textarea
          ref={composer}
          placeholder="Describe your idea, or ask for a change…"
          value={text}
          onChange={event => onText(event.target.value)}
          aria-keyshortcuts="Control+Enter Meta+Enter"
          onKeyDown={event => {
            if (event.key !== 'Enter' || (!event.ctrlKey && !event.metaKey) || event.altKey || event.shiftKey) return;
            // IME confirmation and a held shortcut must not send partial or duplicate messages.
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            event.preventDefault();
            if (!event.repeat) event.currentTarget.form?.requestSubmit();
          }}
          disabled={running}
          rows={2}
        />
      </label>
      <input
        ref={picker}
        type="file"
        hidden
        aria-label="Reference image"
        accept="image/png,image/jpeg,image/webp,image/gif"
        disabled={!attachable}
        onChange={event => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;
          onReadingImage(true);
          void readAssistantImage(file)
            .then(image => onImages(previous => [...previous, image].slice(0, 3)))
            .catch(cause => onError(String(cause.message)))
            .finally(() => onReadingImage(false));
        }}
      />
      {!imagesSupported && <small>Enable image support in Connection to attach a reference.</small>}
      {images.map((image, index) => (
        <div key={index} className="cad-assistant-attachment">
          <img src={`data:${image.mediaType};base64,${image.data}`} alt={image.name} />
          <span>{image.name}</span>
          <button type="button" onClick={() => onImages(previous => previous.filter((_, at) => at !== index))}>
            Remove image
          </button>
        </div>
      ))}
      <div className="cad-assistant-composer-actions">
        <button
          type="button"
          className="cad-assistant-attach"
          aria-label="Add reference image"
          title={imagesSupported ? 'Add reference image (PNG, JPG, WebP or GIF, up to 3)' : 'Enable image support in Connection'}
          disabled={!attachable}
          onClick={() => picker.current?.click()}>
          <span aria-hidden="true">＋</span> Image
        </button>
        <small className="cad-assistant-shortcut">⌘ / Ctrl + Enter to send</small>
        {running ? (
          <button type="button" onClick={onStop}>
            Stop
          </button>
        ) : (
          <button type="submit" className="cad-assistant-primary" disabled={!canSend}>
            Send
          </button>
        )}
      </div>
    </form>
  );
}
