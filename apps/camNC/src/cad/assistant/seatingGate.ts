import type { CadDocument } from '@wbcnc/cad';
import { addedUnplannedFurniturePieces } from '@wbcnc/cad-script';
import type { AssistantRequirementCheck } from './requirements';
import type { AssistantMessage } from './provider';

/** The requests the construction patterns cover: a chair or a stool. A bench or a seat board alone isn't matched. */
const kSeatingRequest = /\b(?:chairs?|stools?)\b/i;
/** "not a chair", "no stool", "isn't a chair": the word names what the piece is not. */
const kNegatedSeating = /\b(?:not|no|isn't|without)\s+(?:an?\s+|the\s+)?(?:chairs?|stools?)\b/gi;

const asksForSeating = (text: string) => kSeatingRequest.test(text.replace(kNegatedSeating, ''));

/**
 * The user's requests still open in this conversation: those since the last proposal they applied. A chair built and
 * applied earlier doesn't hold a later "now add a shelf" to the seating rule.
 */
export function openRequests(messages: readonly AssistantMessage[]): string[] {
  const applied = messages.findLastIndex(message => message.proposalOutcome === 'applied');
  return messages
    .slice(applied + 1)
    .filter(message => message.role === 'user' && !message.event)
    .map(message => message.text);
}

/**
 * For a chair or stool request, every wooden piece the candidate adds must be a member of a construction plan, whose
 * joints, fit and seat fastening inspection then measures. A visually plausible assembly of loose pieces, open housings
 * or notched rails therefore can't become a proposal: the assistant has to build it from frameStool or panelChair, or
 * explain why they can't fit. Pieces already in the open design are the user's and are left alone.
 */
export function seatingConstructionCheck(
  base: CadDocument,
  document: CadDocument,
  requests: readonly string[]
): AssistantRequirementCheck | undefined {
  if (!requests.some(asksForSeating)) return undefined;
  const loose = addedUnplannedFurniturePieces(base, document);
  if (!loose.length) return undefined;
  return {
    requirement: 'seating construction',
    passed: false,
    expected: 'every new piece joined by a measured construction pattern',
    actual: loose.slice(0, 12).map(piece => piece.name),
    message:
      'A chair or stool is built from frameStool or panelChair, so its retained joints and fastened seat are measured. These new pieces belong to no construction plan. Rebuild them from a pattern, or explain the constraint that stops it, instead of offering them as a finished design.',
  };
}
