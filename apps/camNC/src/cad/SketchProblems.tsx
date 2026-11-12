/**
 * What blocks finishing the sketch, or, while an outline is still open, that the sketch is in progress. With nothing
 * drawn at all there's no sketch in progress yet: the editor's own hint says to draw a part (#934).
 */
export function SketchProblems({
  problems,
  inProgress,
  nothingDrawn,
}: {
  problems: string[];
  inProgress: boolean;
  nothingDrawn?: boolean;
}) {
  if (!problems.length || (inProgress && nothingDrawn)) return null;
  return (
    <div className={`cad-problems${inProgress ? ' cad-sketch-progress' : ''}`} role={inProgress ? undefined : 'alert'}>
      <strong>{inProgress ? 'Sketch in progress' : 'Finish is blocked'}</strong>
      {inProgress ? (
        <p>Keep drawing to close the outline. Your sketch is saved as a draft.</p>
      ) : (
        <ul>
          {problems.map((problem, i) => (
            <li key={i}>{problem}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
