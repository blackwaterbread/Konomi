// Invalidate continuations already waiting on IPC when the user presses X.
let cancellationVersion = 0;

export function cancelBackgroundTaskContinuations(): void {
  cancellationVersion++;
}

export function backgroundTaskWasCancelled(): () => boolean {
  const version = cancellationVersion;
  return () => version !== cancellationVersion;
}
