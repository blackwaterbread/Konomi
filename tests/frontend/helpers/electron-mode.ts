let electronMode = false;

export function setElectronMode(value: boolean): void {
  electronMode = value;
}

export function resetElectronMode(): void {
  electronMode = false;
}

export function isElectronMode(): boolean {
  return electronMode;
}

export function withElectronMode<T>(fn: () => T): T {
  const previous = electronMode;
  electronMode = true;
  try {
    return fn();
  } finally {
    electronMode = previous;
  }
}
